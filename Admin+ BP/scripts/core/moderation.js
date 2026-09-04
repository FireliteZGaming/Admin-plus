import { world, system, InputPermissionCategory } from "@minecraft/server"
import { Table } from "./storage.js"
import { formatDuration } from "./util.js"
import { isVanished } from "./vanish.js"

// Moderation state: bans, mutes, and per-player flags (frozen, TPA closed).
//
// All of it is keyed by player id and stored in world tables, so a ban survives
// a rejoin, a name change, and a world reload. Bans are ENFORCED ON JOIN — there
// is no way to refuse a connection outright from script, so the player joins and
// is kicked immediately with the reason.

const bans = new Table("bans", {})
const mutes = new Table("mutes", {})
const flags = new Table("playerFlags", {})

const idOf = p => typeof p === "string" ? p : p?.id

/** A ban/mute record is live if it has no expiry, or its expiry is in the future. */
function active(record) {
    if (!record) return false
    if (!record.until) return true
    return record.until > Date.now()
}

// ---------------------------------------------------------------------- bans

export function banRecord(playerOrId) {
    const record = bans.get(idOf(playerOrId))
    if (!active(record)) return undefined
    return record
}

export function isBanned(playerOrId) { return !!banRecord(playerOrId) }

/**
 * Ban a player, and try to remove them from the world.
 *
 * The two halves are separate on purpose, and the return says which succeeded.
 * The RECORD is the ban — it is ours, it persists, and installModeration kicks
 * the player again on every rejoin. The kick is only how the current session
 * ends, and it can legitimately fail: nothing can remove the WORLD HOST, who is
 * the server. Reporting "banned" when somebody is still standing in front of
 * you is how a moderation tool loses trust, so callers get told.
 *
 * @param {number} durationMs 0 for permanent
 * @returns {{ok: boolean, kicked: boolean, record: object}}
 */
export function ban(target, durationMs, reason, by) {
    bans.set(target.id, {
        name: target.name,
        reason: reason || "No reason given",
        by: by?.name ?? "console",
        at: Date.now(),
        until: durationMs > 0 ? Date.now() + durationMs : 0
    })
    const record = bans.get(target.id)
    const kicked = kick(target, banMessage(record))
    if (!kicked) {
        console.warn(`[Admin+] ${target.name} is banned but could not be removed from the world (the host cannot be kicked)`)
    }
    return { ok: true, kicked, record }
}

export function unban(playerId) { bans.delete(playerId) }

export function banList() {
    return bans.entries()
        .filter(([, record]) => active(record))
        .map(([id, record]) => ({ id, ...record }))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** Drop expired records so the list does not grow forever. */
export function pruneExpired() {
    let changed = false
    for (const [id, record] of bans.entries()) {
        if (!active(record)) { delete bans.data[id]; changed = true }
    }
    for (const [id, record] of mutes.entries()) {
        if (!active(record)) { delete mutes.data[id]; changed = true }
    }
    if (changed) { bans.flush(); mutes.flush() }
}

export function banMessage(record) {
    const left = record.until ? `Expires in ${formatDuration(record.until - Date.now())}` : "Permanent"
    return `You are banned: ${record.reason}\n${left}`
}

// --------------------------------------------------------------------- kicks

/** Kick by running the vanilla command — script has no direct kick API. */
/**
 * Disconnect a player with a message.
 *
 * Player.kick() FIRST, and the vanilla /kick command only as a fallback. The
 * two are not equivalent:
 *
 *   * /kick is the operator command. On a local or LAN world it can leave the
 *     player unable to rejoin until the world is relaunched, and it flatly
 *     refuses to touch the host. Neither is what "kick" is supposed to mean —
 *     a kick is "leave and come back", a ban is the one that lasts.
 *   * /kick is also a command LINE, so the reason has to survive quoting, and a
 *     line break in it truncates the command. The script method takes a plain
 *     string, so ban messages keep their formatting instead of being mangled
 *     into one line.
 *
 * Bans do not rely on this either way: the ban list is ours, and a banned
 * player is kicked again by installModeration the moment they rejoin. Kicking
 * is only how the session ends.
 */
export function kick(target, reason) {
    const text = String(reason ?? "Kicked")

    if (typeof target?.kick === "function") {
        try {
            const result = target.kick(text)
            // It may hand back a promise; a rejection there would otherwise be
            // an unhandled one rather than a log line.
            if (result && typeof result.then === "function") {
                result.then(undefined, e => console.error(`[Admin+] kick failed for ${target.name}: ${e}`))
            }
            return true
        } catch (e) {
            console.error(`[Admin+] Player.kick failed for ${target.name}: ${e}`)
        }
    }

    // There is NO fallback to the /kick command, on purpose. On a local world
    // /kick does not merely disconnect somebody — it locks them out until the
    // HOST restarts the world, which is a punishment nobody chose and the
    // person who ran it cannot undo. A kick that quietly failed is a smaller
    // problem than a kick that bans somebody from their friend's world for the
    // evening, so this reports the failure and stops.
    return false
}

// --------------------------------------------------------------------- mutes

export function muteRecord(playerOrId) {
    const record = mutes.get(idOf(playerOrId))
    if (!active(record)) return undefined
    return record
}

export function isMuted(playerOrId) { return !!muteRecord(playerOrId) }

export function mute(target, durationMs, reason, by) {
    mutes.set(target.id, {
        name: target.name,
        reason: reason || "No reason given",
        by: by?.name ?? "console",
        at: Date.now(),
        until: durationMs > 0 ? Date.now() + durationMs : 0
    })
}

export function unmute(playerId) { mutes.delete(playerId) }

// --------------------------------------------------------------------- flags

function flagsFor(playerOrId) { return flags.get(idOf(playerOrId)) ?? {} }

export function getFlag(playerOrId, key, fallback = false) {
    const value = flagsFor(playerOrId)[key]
    return value === undefined ? fallback : value
}

export function setFlag(playerOrId, key, value) {
    const id = idOf(playerOrId)
    flags.set(id, { ...flagsFor(id), [key]: value })
    return value
}

/**
 * Freeze locks movement and camera. Both are restored on unfreeze and re-applied
 * on join, since input permissions reset with the session.
 */
export function setFrozen(target, frozen) {
    setFlag(target, "frozen", frozen)
    applyFrozen(target)
    return frozen
}

/**
 * Lock or release a player's controls.
 *
 * The method was renamed: PlayerInputPermissions.setEnabled became
 * setPermissionCategory. Calling the old one threw "not a function" on every
 * join and every freeze, which the catch below swallowed into a warning — so
 * freeze looked like it worked and did nothing at all. Both names are tried,
 * newest first, and a runtime with neither is reported once rather than on
 * every player.
 */
let inputWarned = false

export function applyFrozen(target) {
    const frozen = getFlag(target, "frozen", false)
    const permissions = target?.inputPermissions
    if (!permissions) return false

    const set = typeof permissions.setPermissionCategory === "function"
        ? (category, enabled) => permissions.setPermissionCategory(category, enabled)
        : typeof permissions.setEnabled === "function"
            ? (category, enabled) => permissions.setEnabled(category, enabled)
            : undefined

    if (!set) {
        if (!inputWarned) {
            inputWarned = true
            console.warn("[Admin+] this runtime exposes no way to lock player input — freeze will not hold anyone still")
        }
        return false
    }

    try {
        set(InputPermissionCategory.Movement, !frozen)
        set(InputPermissionCategory.Camera, !frozen)
        return true
    } catch (e) {
        console.warn(`[Admin+] could not set input permissions for ${target.name}: ${e}`)
        return false
    }
}

export function isFrozen(playerOrId) { return getFlag(playerOrId, "frozen", false) }

/** TPA closed = other players cannot send them teleport requests. */
export function tpaClosed(playerOrId) { return getFlag(playerOrId, "tpaClosed", false) }
export function setTpaClosed(playerOrId, closed) { return setFlag(playerOrId, "tpaClosed", closed) }

// ------------------------------------------------------------------ join gate

/** Wire the ban gate + frozen re-apply. Called once at boot. */
export function installModeration() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        system.run(() => {
            pruneExpired()
            const record = banRecord(player)
            if (record) {
                kick(player, banMessage(record))
                return
            }
            applyFrozen(player)
        })
    })
}

/** Human-readable state line for the panel. */
export function statusLine(playerOrId) {
    const parts = []
    const banned = banRecord(playerOrId)
    if (banned) parts.push(`§cbanned (${banned.until ? formatDuration(banned.until - Date.now()) + " left" : "permanent"})`)
    const muted = muteRecord(playerOrId)
    if (muted) parts.push(`§emuted (${muted.until ? formatDuration(muted.until - Date.now()) + " left" : "permanent"})`)
    if (isFrozen(playerOrId)) parts.push("§bfrozen")
    if (tpaClosed(playerOrId)) parts.push("§7TPA closed")
    if (isVanished(playerOrId)) parts.push("§8vanished")
    return parts.length ? parts.join("§7, ") : "§7clear"
}
