import { world, system, ItemStack, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff, canActOn, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { enter, exit, inStaffMode, needsRebuild, staffModeList } from "../core/staffmode.js"
import { isVanished, vanish, unvanish } from "../core/vanish.js"
import { isFrozen, setFrozen } from "../core/moderation.js"
import { worldToken, makeBanHammer, HAMMER_NAME } from "../core/banhammer.js"
import { announceJoin, announceLeave } from "./presence.js"
import { invseeScreen } from "./invsee.js"
import { openActionsFor } from "./actions.js"

// /mm — staff mode.
//
// One toggle: your inventory goes away, a tool bar takes its place, you vanish.
// /mm again puts it all back. core/staffmode.js holds the stow-and-restore half
// and the reasoning about not losing anybody's items; this file is the command,
// the tools, and what each one does when you point it at something.
//
// HOW THE TOOLS FIRE, and why they were rebuilt at 1.18.0
// -------------------------------------------------------
// The first version bound each tool to the event that matched what it did:
// right-click a player -> playerInteractWithEntity, right-click a block ->
// playerInteractWithBlock. Both events exist and both are stable, which is
// what the API reference says and what I checked before writing it.
//
// In game, neither fired. The two tools bound to `itemUse` — the compass and
// the clock — worked perfectly, and the four bound to the interact events did
// nothing at all. Right-clicking a PLAYER appears not to raise an interact
// event, because a player is not an interactable entity the way a villager is.
//
// So every tool now hangs off `itemUse`, the event that demonstrably fires, and
// finds its target by RAY CAST from where the staff member is looking:
// getEntitiesFromViewDirection and getBlockFromViewDirection, both stable.
// That is better than the original anyway — it works at range, so freezing
// somebody no longer means walking into them.
//
// The block-interact event is still subscribed as a SECOND path, because a
// right-click consumed by a chest or a door may never reach itemUse at all, and
// those are exactly the blocks worth inspecting. Whichever arrives first wins;
// the other is dropped by a short debounce.
//
// The Ban Hammer stays on entityHitEntity — LEFT-click — which is confirmed
// working in game and always was.

const SIGIL = "§8Admin+ staff tool"

/** How far a tool reaches. Entities get more room than blocks because you are
 *  usually looking at somebody across a room, not standing on them. */
const REACH_ENTITY = 14
const REACH_BLOCK = 8

/**
 * `aim` says what the tool needs before it can do anything:
 *   player  ray cast for a player, and complain politely if there is none
 *   block   ray cast for a block
 *   none    it just goes
 *   hit     it is not an itemUse tool at all — the Ban Hammer, on left-click
 */
const TOOLS = [
    {
        key: "teleport", slot: 0, aim: "none",
        id: "minecraft:compass", name: "§b§lTeleport",
        blurb: "§7Use it to jump to a random player."
    },
    {
        key: "freeze", slot: 1, aim: "player",
        id: "minecraft:packed_ice", name: "§b§lFreeze",
        blurb: "§7Look at a player and use it to freeze or release them."
    },
    {
        key: "examine", slot: 2, aim: "player",
        id: "minecraft:book", name: "§e§lExamine",
        blurb: "§7Look at a player and use it to read their inventory."
    },
    {
        key: "punish", slot: 3, aim: "player",
        id: "minecraft:blaze_rod", name: "§c§lPunish",
        blurb: "§7Look at a player and use it for everything you can do to them."
    },
    {
        key: "inspect", slot: 4, aim: "block",
        id: "minecraft:stick", name: "§a§lInspect",
        blurb: "§7Look at a block and use it to read its type and states."
    },
    {
        key: "leave", slot: 8, aim: "none",
        id: "minecraft:clock", name: "§7§lLeave staff mode",
        blurb: "§7Use it to get your things back."
    }
]

/** The Ban Hammer's slot in the bar. It is not in TOOLS because it is not an
 *  itemUse tool — it fires on a swing, and it is minted by core/banhammer.js
 *  with its own signature, which the hammer's own check knows how to read. */
const HAMMER_SLOT = 5

/** We vanished them, so we are the ones who should un-vanish them. Somebody who
 *  was ALREADY vanished when they entered stays vanished on the way out. */
const vanishedByUs = new Set()

/** Last inspect per player, so the two paths into it cannot double-report. */
const lastInspect = new Map()
const INSPECT_GAP = 250

function makeTool(def) {
    const stack = new ItemStack(def.id, 1)
    stack.nameTag = def.name
    stack.setLore([def.blurb, `${SIGIL} · #${worldToken()}`])
    return stack
}

/** Is this the tool this world issued, and which one? */
function toolFor(stack) {
    if (!stack?.typeId) return undefined
    let lore = []
    try { lore = stack.getLore() ?? [] } catch { return undefined }
    if (!lore.some(line => String(line).includes(`#${worldToken()}`))) return undefined
    return TOOLS.find(def => def.id === stack.typeId && def.name === stack.nameTag)
}

/**
 * The bar itself, from one yes/no. Split from barFor so the hammer rule can be
 * tested without standing up a rank ladder.
 *
 * The Ban Hammer is no longer a Dev-screen curio. It rides along with staff
 * mode, and only for somebody allowed to ban permanently — which is exactly
 * what the hammer does, so the permission and the tool now say the same thing.
 */
export function toolBar(withHammer) {
    const bar = TOOLS.map(def => ({ slot: def.slot, stack: makeTool(def) }))
    if (withHammer) bar.push({ slot: HAMMER_SLOT, stack: makeBanHammer() })
    return bar
}

/** Everything that goes in the bar, for this particular staff member. */
export function barFor(player) {
    return toolBar(has(player, "admin.banperm"))
}

function mainhandOf(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container
            ?.getItem(player.selectedSlotIndex ?? 0)
    } catch { return undefined }
}

// -------------------------------------------------------------------- aiming

/** The player they are looking at, if any. */
function lookedAtPlayer(player) {
    let hits = []
    try {
        hits = player.getEntitiesFromViewDirection({ maxDistance: REACH_ENTITY }) ?? []
    } catch { return undefined }
    for (const hit of hits) {
        const entity = hit?.entity ?? hit
        if (!entity || entity.id === player.id) continue
        if (entity.typeId !== "minecraft:player") continue
        return entity
    }
    return undefined
}

/** The block they are looking at, if any. */
function lookedAtBlock(player) {
    try {
        return player.getBlockFromViewDirection({ maxDistance: REACH_BLOCK })?.block
    } catch { return undefined }
}

// ------------------------------------------------------------------ the toggle

function startStaffMode(player) {
    const result = enter(player, barFor(player))
    if (!result.ok) return err(player, result.reason)

    if (!isVanished(player)) {
        const vanished = vanish(player)
        if (vanished?.ok !== false) {
            vanishedByUs.add(player.id)
            // Same line a real disconnect prints, from the same helper, which is
            // what makes vanishing read as leaving.
            announceLeave(displayName(player))
        }
    }

    record(player, "admin.staffmode", player, `on · stowed ${result.stowed} stack(s)`)
    ok(player, "§7Staff mode on. Your things are put away.")
    info(player, "§8Look at somebody and use the tool. §7/mm§8 again gives everything back.")
}

function stopStaffMode(player) {
    const rebuilt = needsRebuild(player)
    const result = exit(player)
    if (!result.ok) return err(player, result.reason)

    if (vanishedByUs.has(player.id)) {
        vanishedByUs.delete(player.id)
        unvanish(player)
        refreshNameTag(player)
        announceJoin(player)
    }

    record(player, "admin.staffmode", player,
        `off · restored ${result.restored} stack(s)${result.lossless ? "" : " from the saved copy"}`)
    ok(player, "§7Staff mode off. You have your things back.")

    // Never quietly hand back a reconstruction. If the world reloaded while
    // they were in staff mode the originals are gone, and the difference shows
    // up in shulker boxes and written books — things the script API cannot read.
    if (!result.lossless || rebuilt) {
        info(player, "§eThat was rebuilt from the saved copy, because the world reloaded while you were in staff mode.")
        info(player, "§8Names, lore, enchantments and damage came back. Container contents and book pages did not.")
    }
}

command({
    name: "mm",
    description: "Staff mode — /mm toggles your tools and your inventory",
    perm: "admin.staffmode",
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const targets = selected?.length ? selected : [player]
        if (targets.length > 1) return err(player, "Pick one player.")

        const target = targets[0]
        if (target.id !== player.id) {
            if (!canActOn(player, target)) return err(player, `${displayName(target)} outranks you.`)
            // Taking somebody OUT is a rescue — somebody stuck in staff mode
            // with their inventory in storage. Putting somebody else IN is not
            // a thing: their items would be stowed under their own name with
            // no way for them to know.
            if (!inStaffMode(target)) {
                return err(player, `${displayName(target)} isn't in staff mode. You can take somebody out of it, not put them in.`)
            }
            stopStaffMode(target)
            return ok(player, `Took §f${displayName(target)}§a out of staff mode.`)
        }

        return inStaffMode(player) ? stopStaffMode(player) : startStaffMode(player)
    }
})

// ------------------------------------------------------------------ the tools

function useTeleport(player) {
    const candidates = world.getAllPlayers()
        .filter(other => other.id !== player.id && !isStaff(other))
    if (!candidates.length) return info(player, "§7Nobody to jump to.")
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    try {
        player.teleport(target.location, { dimension: target.dimension })
        info(player, `§7Jumped to §f${displayName(target)}§7.`)
    } catch (e) {
        err(player, `Couldn't teleport: ${e}`)
    }
}

function useFreeze(player, target) {
    if (!has(player, "admin.freeze")) return err(player, "You can't freeze.")
    if (!canActOn(player, target)) return err(player, `${displayName(target)} outranks you.`)
    const frozen = !isFrozen(target)
    setFrozen(target, frozen)
    record(player, frozen ? "mod.freeze" : "mod.unfreeze", target, "staff mode tool")
    ok(player, `${displayName(target)}§a is ${frozen ? "§bfrozen" : "§afree"}§a.`)
    info(target, frozen ? "§bYou've been frozen by staff." : "§aYou can move again.")
}

function useInspect(player, block) {
    const now = Date.now()
    if (now - (lastInspect.get(player.id) ?? 0) < INSPECT_GAP) return
    lastInspect.set(player.id, now)

    if (!block?.typeId) return info(player, "§7Nothing there.")
    let states = {}
    try { states = block.permutation?.getAllStates?.() ?? {} } catch { states = {} }
    const entries = Object.entries(states)

    info(player, `§8── §f${block.typeId}§8 ──`)
    info(player, `§7at §f${Math.floor(block.x)} ${Math.floor(block.y)} ${Math.floor(block.z)}`)
    if (!entries.length) return info(player, "§8no block states")
    for (const [name, value] of entries) {
        info(player, `§8· §7${name}§8 = §f${value}`)
    }
}

/** One tool, fired. Exported so a test can drive it without an event. */
export function runTool(player, tool) {
    if (!tool || tool.aim === "hit") return

    if (tool.aim === "player") {
        const target = lookedAtPlayer(player)
        if (!target) return info(player, "§7Look at a player and use it again.")
        if (tool.key === "freeze") return useFreeze(player, target)
        if (tool.key === "examine") {
            if (!has(player, "admin.invsee")) return err(player, "You can't view inventories.")
            return invseeScreen(player, target, () => { })
        }
        if (tool.key === "punish") {
            return openActionsFor(player, target.id, target.name, () => { })
        }
        return
    }

    if (tool.aim === "block") {
        const block = lookedAtBlock(player)
        if (!block) return info(player, "§7Look at a block and use it again.")
        return useInspect(player, block)
    }

    if (tool.key === "teleport") return useTeleport(player)
    if (tool.key === "leave") return stopStaffMode(player)
}

// ---------------------------------------------------------------- the wiring

export function installStaffMode() {
    const after = world.afterEvents

    // The one event confirmed to fire in game. Everything hangs off it.
    if (after?.itemUse?.subscribe) {
        after.itemUse.subscribe(event => {
            const player = event.source
            if (!player || !inStaffMode(player)) return
            const tool = toolFor(event.itemStack ?? mainhandOf(player))
            if (!tool) return
            system.run(() => runTool(player, tool))
        })
    } else {
        console.warn("[Admin+] itemUse unavailable — no staff tool will fire")
    }

    // Second path for the inspector only. A right-click that a chest or a door
    // consumes may never reach itemUse, and those are the blocks most worth
    // reading. useInspect debounces, so whichever path arrives first wins.
    if (after?.playerInteractWithBlock?.subscribe) {
        after.playerInteractWithBlock.subscribe(event => {
            const player = event.player
            if (!player || !inStaffMode(player)) return
            const tool = toolFor(event.itemStack ?? mainhandOf(player))
            if (tool?.aim !== "block") return
            system.run(() => useInspect(player, event.block))
        })
    }

    // playerInteractWithEntity is deliberately NOT subscribed. It is stable and
    // it exists, and right-clicking a player does not raise it — confirmed in
    // game at 1.17.0, where every tool bound to it did nothing. The ray cast
    // above replaced it.

    // Somebody who left while in staff mode comes back holding TOOLS, with
    // their real inventory sitting in storage. Give it back immediately — a
    // staff member should never have to know the feature failed to close.
    if (after?.playerSpawn?.subscribe) {
        after.playerSpawn.subscribe(event => {
            if (!event.initialSpawn || !event.player) return
            if (!inStaffMode(event.player)) return
            system.runTimeout(() => {
                info(event.player, "§7You left while in staff mode — putting your things back.")
                stopStaffMode(event.player)
            }, 20)
        })
    }

    return true
}

// Exported for the tests: the signature check is the thing standing between a
// staff tool and any player who owns an anvil, so it gets tested like the Ban
// Hammer's does.
export { staffModeList, TOOLS, makeTool, toolFor, HAMMER_SLOT, HAMMER_NAME, REACH_ENTITY, REACH_BLOCK }
