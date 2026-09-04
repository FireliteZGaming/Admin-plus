import { world, system, ItemStack, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff, canActOn, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { enter, exit, inStaffMode, needsRebuild, staffModeList } from "../core/staffmode.js"
import { isVanished, vanish, unvanish } from "../core/vanish.js"
import { isFrozen, setFrozen } from "../core/moderation.js"
import { worldToken } from "../core/banhammer.js"
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
// WHY TOOLS AT ALL, when every one of these already has a command or a panel
// button: because the panel makes you pick a player off a list, and in the
// moment that matters you are already looking at them. A tool turns "who was
// that" into pointing at them.
//
// The tools are signed the same way the Ban Hammer is — vanilla items with lore
// carrying this world's serial, which players cannot set. A stick somebody
// renamed on an anvil does nothing. See core/banhammer.js for why lore and not
// the name.

const SIGIL = "§8Admin+ staff tool"

/**
 * Left-click and right-click are DIFFERENT EVENTS on a player, and that is what
 * decides which tools can exist:
 *
 *   entityHitEntity          left-click a player   (the Ban Hammer uses it)
 *   playerInteractWithEntity right-click a player
 *   playerInteractWithBlock  right-click a block
 *   itemUse                  right-click, nothing in particular
 *
 * All four are stable in @minecraft/server 2.x — checked against the API
 * reference on 2026-09-04, not assumed. `on` says which event a tool answers.
 */
const TOOLS = [
    {
        key: "teleport", slot: 0, on: "use",
        id: "minecraft:compass", name: "§b§lTeleport",
        blurb: "§7Use it to jump to a random player."
    },
    {
        key: "freeze", slot: 1, on: "player",
        id: "minecraft:packed_ice", name: "§b§lFreeze",
        blurb: "§7Right-click a player to freeze or release them."
    },
    {
        key: "examine", slot: 2, on: "player",
        id: "minecraft:book", name: "§e§lExamine",
        blurb: "§7Right-click a player to read their inventory."
    },
    {
        key: "punish", slot: 3, on: "player",
        id: "minecraft:blaze_rod", name: "§c§lPunish",
        blurb: "§7Right-click a player for everything you can do to them."
    },
    {
        key: "inspect", slot: 4, on: "block",
        id: "minecraft:stick", name: "§a§lInspect",
        blurb: "§7Right-click a block to read its type and states."
    },
    {
        key: "leave", slot: 8, on: "use",
        id: "minecraft:clock", name: "§7§lLeave staff mode",
        blurb: "§7Use it to get your things back."
    }
]

/** We vanished them, so we are the ones who should un-vanish them. Somebody who
 *  was ALREADY vanished when they entered stays vanished on the way out. */
const vanishedByUs = new Set()

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

function mainhandOf(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container
            ?.getItem(player.selectedSlotIndex ?? 0)
    } catch { return undefined }
}

// ------------------------------------------------------------------ the toggle

function startStaffMode(player) {
    const tools = TOOLS.map(def => ({ slot: def.slot, stack: makeTool(def) }))
    const result = enter(player, tools)
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
    info(player, "§8Point the tools at somebody. §7/mm§8 again gives everything back.")
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

// ---------------------------------------------------------------- the wiring

export function installStaffMode() {
    const after = world.afterEvents

    // Right-click a player: freeze, examine, punish.
    if (after?.playerInteractWithEntity?.subscribe) {
        after.playerInteractWithEntity.subscribe(event => {
            const player = event.player
            const target = event.target
            if (!player || !target || target.typeId !== "minecraft:player") return
            if (!inStaffMode(player)) return

            const tool = toolFor(event.itemStack ?? mainhandOf(player))
            if (!tool || tool.on !== "player") return

            system.run(() => {
                if (tool.key === "freeze") return useFreeze(player, target)
                if (tool.key === "examine") {
                    if (!has(player, "admin.invsee")) return err(player, "You can't view inventories.")
                    return invseeScreen(player, target, () => { })
                }
                if (tool.key === "punish") {
                    return openActionsFor(player, target.id, target.name, () => { })
                }
            })
        })
    } else {
        console.warn("[Admin+] playerInteractWithEntity unavailable — staff tools that point at a player will not fire")
    }

    // Right-click a block: the inspector.
    if (after?.playerInteractWithBlock?.subscribe) {
        after.playerInteractWithBlock.subscribe(event => {
            const player = event.player
            if (!player || !inStaffMode(player)) return
            const tool = toolFor(event.itemStack ?? mainhandOf(player))
            if (!tool || tool.on !== "block") return
            system.run(() => useInspect(player, event.block))
        })
    } else {
        console.warn("[Admin+] playerInteractWithBlock unavailable — the Inspect tool will not fire")
    }

    // Right-click nothing in particular: teleport, and leave.
    if (after?.itemUse?.subscribe) {
        after.itemUse.subscribe(event => {
            const player = event.source
            if (!player || !inStaffMode(player)) return
            const tool = toolFor(event.itemStack)
            if (!tool || tool.on !== "use") return
            system.run(() => {
                if (tool.key === "teleport") return useTeleport(player)
                if (tool.key === "leave") return stopStaffMode(player)
            })
        })
    } else {
        console.warn("[Admin+] itemUse unavailable — the Teleport and Leave tools will not fire")
    }

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
export { staffModeList, TOOLS, makeTool, toolFor }
