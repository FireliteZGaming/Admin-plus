import { system } from "@minecraft/server"
import { CONFIG } from "../config.js"
import { cooldownFor, isStaff } from "./ranks.js"
import { setting, flag } from "./settings.js"
import { err, info } from "./util.js"

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

/** Seconds of cooldown for this player: their rank's value, else the default. */
function cooldownSeconds(player) {
    const fallback = Number(setting("teleport.cooldown"))
    return cooldownFor(player, Number.isFinite(fallback) ? fallback : 0)
}

/** Seconds left on this player's cooldown, or 0. */
export function cooldownLeft(player) {
    const seconds = cooldownSeconds(player)
    if (!seconds) return 0
    const since = Date.now() - (lastUsed.get(player.id) ?? 0)
    const left = seconds * 1000 - since
    return left > 0 ? Math.ceil(left / 1000) : 0
}

export function markUsed(player) { lastUsed.set(player.id, Date.now()) }

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
export function queueTeleport(player, label, action) {
    const waiting = cooldownLeft(player)
    if (waiting > 0) {
        err(player, `Wait §f${waiting}s§c before teleporting again.`)
        return false
    }

    // A second request replaces the first rather than racing it.
    cancelTeleport(player)

    const ticks = exemptFromWait(player) ? 0 : warmupTicks()
    if (ticks <= 0) {
        markUsed(player)
        action()
        return true
    }

    const from = player.location
    info(player, `Teleporting to §f${label}§7 in §f${Math.round(ticks / 20)}s§7 — don't move.`)

    const runner = system.runInterval(() => {
        const job = pending.get(player.id)
        if (!job) return

        if (flag("teleport.cancelOnMove") && moved(player, from)) {
            cancelTeleport(player, "§cTeleport cancelled — you moved.")
            return
        }
        if (Date.now() < job.until) return

        cancelTeleport(player)
        markUsed(player)
        try {
            action()
        } catch (e) {
            err(player, `Teleport failed: ${e}`)
        }
    }, 4)

    pending.set(player.id, { runner, until: Date.now() + ticks * 50, from })
    return true
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
