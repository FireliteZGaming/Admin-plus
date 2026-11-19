import { system } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { cooldownFor, isStaff, valueFor } from "./ranks.js"
import { setting, flag } from "./settings.js"
import { err, info } from "./util.js"
import { mark } from "./back.js"
import { isFrozen } from "./moderation.js"

// One teleport pipeline, shared by warps, spawn, TPA and /back.
//
// Warmup exists so a player cannot escape a fight by warping; it is cancelled if
// they move. Cooldown exists so warping is not a free movement system. Staff skip
// both — they teleport as a tool, not as a perk — unless the exemption is turned
// off in < Code >.

const pending = new Map()   // playerId -> { runner, until, from }
const lastUsed = new Map()  // playerId -> timestamp

function warmupTicks() {
    const value = Number(setting("teleport.warmup"))
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 20) : CONFIG.teleport.warmupTicks
}

function exemptFromWait(player) {
    return CONFIG.teleport.staffInstant && isStaff(player)
}

/**
 * Seconds of cooldown for this player.
 *
 * `key` names the RANK_VALUES entry governing this particular action. Warps,
 * spawn, TPA and /back share `tpCooldown` because they are one movement budget;
 * `/home` has its own, because a home is somewhere you go to stop playing for a
 * minute rather than a way across the map, and a server that wants a long warp
 * cooldown does not usually want people stranded away from bed.
 */
function cooldownSeconds(player, key) {
    if (key && key !== "tpCooldown") return Number(valueFor(player, key) ?? 0)
    const fallback = Number(setting("teleport.cooldown"))
    return cooldownFor(player, Number.isFinite(fallback) ? fallback : 0)
}

/**
 * Seconds left on this player's cooldown, or 0.
 *
 * Timers are kept PER ACTION, so waiting on `/home` does not also block a warp.
 * They were one timer while there was one cooldown; splitting the lengths
 * without splitting the timers would have made the shorter one pointless.
 */
export function cooldownLeft(player, key = "tpCooldown") {
    const seconds = cooldownSeconds(player, key)
    if (!seconds) return 0
    const since = Date.now() - (lastUsed.get(player.id)?.[key] ?? 0)
    const left = seconds * 1000 - since
    return left > 0 ? Math.ceil(left / 1000) : 0
}

export function markUsed(player, key = "tpCooldown") {
    const mine = lastUsed.get(player.id) ?? {}
    mine[key] = Date.now()
    lastUsed.set(player.id, mine)
}

export function cancelTeleport(player, reason) {
    const job = pending.get(player.id)
    if (!job) return false
    system.clearRun(job.runner)
    pending.delete(player.id)
    if (reason) info(player, reason)
    return true
}

export function isTeleporting(player) { return pending.has(player.id) }

/**
 * Run `action` after the warmup, unless the player moves or is on cooldown.
 * @param {string} label what they are warping to, for the messages
 */
export function queueTeleport(player, label, action, key = "tpCooldown") {
    // Freeze holds against every way out: /spawn, /home, /back, /rtp, /warp and
    // /tpa all come through here. Before 2.10.1 none of them checked it.
    if (isFrozen(player)) {
        err(player, "You're frozen, so you can't teleport.")
        return false
    }
    const waiting = cooldownLeft(player, key)
    if (waiting > 0) {
        err(player, `Wait §f${waiting}s§c before teleporting again.`)
        return false
    }

    // A second request replaces the first rather than racing it.
    cancelTeleport(player)

    const ticks = exemptFromWait(player) ? 0 : warmupTicks()
    if (ticks <= 0) {
        // Where they were, for /back. Laid at the moment the teleport commits
        // rather than when it was asked for, so a warmup somebody walks out of
        // leaves no mark behind.
        mark(player)
        markUsed(player, key)
        action()
        return true
    }

    const from = player.location
    info(player, `Teleporting to §f${label}§7 in §f${Math.round(ticks / 20)}s§7. Don't move.`)

    const runner = system.runInterval(() => {
        const job = pending.get(player.id)
        if (!job) return

        if (flag("teleport.cancelOnMove") && moved(player, from)) {
            cancelTeleport(player, "§cTeleport cancelled because you moved.")
            showBar(player, "§cTeleport cancelled. You moved.")
            return
        }
        if (Date.now() < job.until) {
            // The countdown on the action bar (2.12.13), once a second. The
            // chat line said the wait once and then scrolled away.
            const left = Math.ceil((job.until - Date.now()) / 1000)
            if (left !== job.shown) {
                job.shown = left
                showBar(player, `§7Teleporting to §f${label}§7 in §f${left}§7... Don't move.`)
            }
            return
        }
        if (isFrozen(player)) {
            cancelTeleport(player, "§cTeleport cancelled because you were frozen.")
            return
        }

        cancelTeleport(player)
        mark(player)
        markUsed(player, key)
        try {
            action()
        } catch (e) {
            err(player, `Teleport failed: ${e}`)
        }
    }, 4)

    pending.set(player.id, { runner, until: Date.now() + ticks * 50, from })
    return true
}

/** The action bar is a nicety: a player who just left must not break the teleport. */
function showBar(player, text) {
    try { player.onScreenDisplay.setActionBar(text) } catch { /* nobody to show */ }
}

function moved(player, from) {
    try {
        const now = player.location
        return Math.abs(now.x - from.x) > 0.6
            || Math.abs(now.y - from.y) > 0.6
            || Math.abs(now.z - from.z) > 0.6
    } catch {
        return true   // player left — treat as moved so the job clears
    }
}
