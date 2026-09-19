import { valueFor } from "./ranks.js"

// Who has to wait, and how long.
//
// **In memory on purpose.** A cooldown exists to stop somebody using a thing
// ten times in ten seconds; it has no business surviving a restart, and
// persisting it would mean a world reload could leave people waiting on a
// timer set by a session that no longer exists. Leaving the server resets it,
// which is the behaviour every server plugin doing this has, and nobody has
// ever filed a bug about.
//
// Keyed by player ID rather than name: a gamertag can change, and a cooldown
// that a rename clears is a cooldown that can be dodged.

/** @type {Map<string, Map<string, number>>} id -> action -> when it expires */
const until = new Map()

/**
 * Seconds still to wait on `action`, or 0 if they may go now.
 *
 * Reads the length from the player's RANK each time rather than storing it at
 * the moment the cooldown was set. If an owner shortens a rank's cooldown, or
 * promotes somebody, the change should apply to the wait they are already in —
 * otherwise a promotion leaves the old rank's penalty running.
 */
export function remaining(player, action) {
    const mine = until.get(player?.id)
    const ends = mine?.get(action)
    if (!ends) return 0
    const left = Math.ceil((ends - Date.now()) / 1000)
    if (left <= 0) { mine.delete(action); return 0 }
    return left
}

/**
 * Start the wait for `action`, using the length this player's rank carries.
 *
 * `key` is the RANK_VALUES entry holding the length; `action` is what is being
 * waited on. They are usually the same idea but not the same string, because
 * several actions can share one length — warps, spawn and TPA all wait on
 * `tpCooldown` while keeping separate timers, so using a warp does not block a
 * teleport request.
 */
export function start(player, action, key) {
    const seconds = Number(valueFor(player, key) ?? 0)
    if (!Number.isFinite(seconds) || seconds <= 0) return 0
    if (!until.has(player.id)) until.set(player.id, new Map())
    until.get(player.id).set(action, Date.now() + seconds * 1000)
    return seconds
}

/** Drop every timer for one person — used when they leave, so the map cannot grow forever. */
export function forget(playerId) {
    until.delete(playerId)
}

/** How it reads when somebody has to wait. Seconds, then minutes past 60. */
export function waitLine(seconds) {
    if (seconds >= 60) {
        const mins = Math.floor(seconds / 60)
        const rest = seconds % 60
        return rest ? `${mins}m ${rest}s` : `${mins}m`
    }
    return `${seconds}s`
}

/** Tests only. */
export function __resetCooldowns() { until.clear() }
