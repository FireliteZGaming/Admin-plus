import { world, system, ItemStack, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff, canActOn, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { enter, exit, inStaffMode, needsRebuild, staffModeList, markVanished, vanishedByStaffMode } from "../core/staffmode.js"
import { isVanished, vanish, unvanish } from "../core/vanish.js"
import { worldToken, makeBanHammer, HAMMER_NAME } from "../core/banhammer.js"
import { announceJoin, announceLeave } from "./presence.js"

// /mm — staff mode.
//
// One toggle: your inventory goes away, a tool bar takes its place, you vanish.
// /mm again puts it all back. core/staffmode.js holds the stow-and-restore half
// and the reasoning about not losing anybody's items; this file is the command
// and the bar.
//
// THE BAR IS DELIBERATELY SHORT. It carried six tools at 1.18.0 — freeze,
// examine, punish and a block inspector alongside these — each finding its
// target by ray cast. They were cut at 1.23.0 because every one of them already
// had a command and a panel button, and a tool that duplicates a button is a
// tool somebody has to learn twice. What is left is the set that has no
// equivalent anywhere else:
//
//   Ban Hammer   a swing that bans, and only for people allowed to ban forever
//   Leave        get your things back without typing
//   Teleport     jump to somebody without picking them off a list
//
// The Ban Hammer is the reason staff mode exists at all now. The rest of the
// moderation surface is in /admin, where it reads better.

const SIGIL = "§8Admin+ staff tool"

/** `aim: "none"` — these act on use, with nothing to point at. */
const TOOLS = [
    {
        key: "teleport", slot: 0, aim: "none",
        id: "minecraft:compass", name: "§b§lTeleport",
        blurb: "§7Use it to jump to a random player."
    },
    {
        key: "leave", slot: 8, aim: "none",
        id: "minecraft:clock", name: "§7§lLeave staff mode",
        blurb: "§7Use it to get your things back."
    }
]

/** The Ban Hammer's slot. Not in TOOLS: it fires on a SWING, not on use, and
 *  core/banhammer.js mints it with its own signature that its own check reads. */
const HAMMER_SLOT = 4

/* We vanished them, so we un-vanish them; somebody who was ALREADY vanished
 * when they entered stays vanished on the way out.
 *
 * That fact used to live in a Set here. A world reload emptied it, so the
 * restore on the way back never un-vanished anybody -- you came back invisible,
 * on night vision, and still flagged. It lives in the staff-mode record now,
 * which is storage, which is the only thing a reload does not take with it.
 * See markVanished() in core/staffmode.js. */

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
 * The bar, from one yes/no. Split from barFor so the hammer rule can be tested
 * without standing up a rank ladder.
 *
 * The Ban Hammer rides with staff mode and only for somebody allowed to ban
 * permanently — which is exactly what the hammer does, so the permission and
 * the tool say the same thing.
 */
export function toolBar(withHammer) {
    const bar = TOOLS.map(def => ({ slot: def.slot, stack: makeTool(def) }))
    if (withHammer) bar.push({ slot: HAMMER_SLOT, stack: makeBanHammer() })
    return bar
}

export function barFor(player) {
    return toolBar(has(player, "admin.banperm"))
}

function mainhandOf(player) {
    try {
        return player.getComponent("minecraft:inventory")?.container
            ?.getItem(player.selectedSlotIndex ?? 0)
    } catch { return undefined }
}

// ------------------------------------------------------------------ the toggle

function startStaffMode(player) {
    const result = enter(player, barFor(player))
    if (!result.ok) return err(player, result.reason)

    if (!isVanished(player)) {
        const vanished = vanish(player)
        if (vanished?.ok !== false) {
            markVanished(player, true)
            // The same line a real disconnect prints, from the same helper,
            // which is what makes vanishing read as leaving.
            announceLeave(displayName(player))
        }
    }

    record(player, "admin.staffmode", player, `on · stowed ${result.stowed} stack(s)`)
    ok(player, "§7Staff mode on. Your things are put away.")
    info(player, "§8/mm again gives everything back.")
}

function stopStaffMode(player) {
    const rebuilt = needsRebuild(player)
    // Both of these read the stored record, so both have to be asked BEFORE
    // exit() deletes it.
    const weVanished = vanishedByStaffMode(player)
    const result = exit(player)
    if (!result.ok) return err(player, result.reason)

    if (weVanished) {
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
            // a thing: their items would be stowed under their own name with no
            // way for them to know.
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

/** One tool, fired. Exported so a test can drive it without an event. */
export function runTool(player, tool) {
    if (!tool) return
    if (tool.key === "teleport") return useTeleport(player)
    if (tool.key === "leave") return stopStaffMode(player)
}

// ---------------------------------------------------------------- the wiring

export function installStaffMode() {
    const after = world.afterEvents

    // itemUse is the one event confirmed to fire in game. The interact events
    // exist and are stable and simply never arrived — right-clicking a PLAYER
    // does not raise one, because a player is not an interactable entity the
    // way a villager is. Both remaining tools act on use, so nothing else is
    // subscribed any more.
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

// Exported for the tests: the signature check is what stands between a staff
// tool and anybody who owns an anvil, so it is tested like the hammer's is.
export { staffModeList, TOOLS, makeTool, toolFor, HAMMER_SLOT, HAMMER_NAME }
