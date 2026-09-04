import { world, system, InputPermissionCategory } from "@minecraft/server"
import { Table } from "./storage.js"
import { setting } from "./settings.js"
import { formatDuration } from "./util.js"
import { isVanished } from "./vanish.js"

// Moderation state: bans, mutes, and per-player flags (frozen, TPA closed).
//
// All of it is keyed by player id and stored in world tables, so a ban survives
// a rejoin, a name change, and a world reload.
//
// HOW A BAN IS ENFORCED.
//
// Bedrock's script API cannot refuse a connection. A Java ban list rejects the
// login, which is why a Java ban never has to kick anybody — the player simply
// never arrives. Here they always arrive, so a ban is: record it, disconnect
// them, and disconnect them again every time they come back.
//
// Removing them is `kick()` below, which tries three routes in order and says
// which one worked. What each route IS was settled by reading four shipped
// addons rather than the documentation, which does not list `Player.kick()` at
// all — every one of them reaches the same `/kick` command in the end, and the
// only thing that varies is who issues it.
//
// `Player.kick()` hands back a **CommandResult** carrying `successCount`, the
// same shape `runCommand` returns. That return type is the evidence that it is
// /kick underneath, and it inherits everything /kick does, lockouts included.
//
// So the honest thing is not to pretend otherwise but to REPORT truthfully.
// `successCount === 0` means the command ran and removed nobody. This file used
// to return `kicked: true` on the strength of the method merely existing and
// not throwing — a value it never measured. It measures it now.

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

// ------------------------------------------------------------- ban length

/**
 * The ban screen's length control is ONE slider, and the last notch is
 * permanent.
 *
 * Three text boxes for minutes/hours/days is the obvious design and it is the
 * wrong one: it asks for arithmetic at the exact moment somebody is annoyed,
 * and it lets you type 999 in a box meant for hours. A slider cannot express a
 * length that does not exist, so the only lengths are the ones we chose.
 *
 * Permanent lives at the far end of the same slider rather than in a separate
 * control, because it IS the longest length — a second widget would let you set
 * "3 days" and "permanent" at the same time and then have to pick a winner.
 *
 * Bedrock sliders render the raw number and nothing else. There is no way to
 * label the last notch, so the FIELD label carries it and every place that
 * shows a chosen length uses banLengthLabel().
 */
export const BAN_MAX_DAYS = 7
export const PERMANENT_NOTCH = BAN_MAX_DAYS + 1

/** Highest notch the slider offers: 8 when permanent bans are allowed, else 7. */
export function banSliderMax(allowPermanent) {
    return allowPermanent ? PERMANENT_NOTCH : BAN_MAX_DAYS
}

/**
 * Slider notch -> milliseconds, in the same units `ban()` takes.
 * The permanent notch returns 0, which is what ban() already means by forever.
 */
export function banLengthMs(notch, allowPermanent = true) {
    const max = banSliderMax(allowPermanent)
    const value = Math.min(Math.max(Math.round(Number(notch) || 1), 1), max)
    if (allowPermanent && value === PERMANENT_NOTCH) return 0
    return value * 864e5
}

/** What to call that length in a confirmation, a log line or a chat message. */
export function banLengthLabel(notch, allowPermanent = true) {
    const ms = banLengthMs(notch, allowPermanent)
    if (ms === 0) return "permanent"
    return formatDuration(ms)
}

/** The dropdown, in the order a ban screen should offer them. Other is last. */
export const BAN_REASONS = [
    "Griefing",
    "Cheating",
    "Harassment",
    "Chat behaviour",
    "Advertising",
    "Ban evasion",
    "Other"
]

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
export async function ban(target, durationMs, reason, by) {
    // The RECORD lands first and synchronously. It is the ban; the disconnect
    // is only how this session ends, and installModeration acts again on every
    // rejoin whether or not the kick worked.
    bans.set(target.id, {
        name: target.name,
        reason: reason || "No reason given",
        by: by?.name ?? "console",
        at: Date.now(),
        until: durationMs > 0 ? Date.now() + durationMs : 0
    })
    const record = bans.get(target.id)
    const kicked = await kick(target, banMessage(record))
    if (!kicked) {
        console.warn(`[Admin+] ${target.name} is banned but was not removed from the world`)
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

/**
 * Disconnect a player with a message.
 *
 * WHAT IS ACTUALLY KNOWN, corrected 2026-09-04 after a report from the world:
 *
 *   * `Player.kick()` is NOT in the scripting reference. Neither Microsoft's
 *     Player page nor the community mirror lists it among the class methods.
 *   * It nevertheless EXISTS at runtime — the content log has a ban hammer
 *     swing recorded as "banned and removed", and that branch is only reached
 *     when `target.kick` was callable and did not throw.
 *   * Nothing anywhere says it behaves differently from the `/kick` COMMAND.
 *
 * That last line used to read the other way round. This file claimed the two
 * were "not equivalent" and that the script method avoided the local-world
 * lockout. That was an ASSUMPTION written up as a finding, and the world says
 * otherwise: a ban left somebody unable to get back in until the world was
 * relaunched, which is the /kick symptom exactly. Undocumented almost
 * certainly means it is the same disconnect with a script-shaped door.
 *
 * There is no third option. Bedrock's script API cannot refuse a connection —
 * that is the thing a Java ban list does and the reason a Java ban never has
 * to kick anybody. On Bedrock the player always joins first, so every ban is a
 * kick-on-join, and every ban therefore inherits whatever /kick does.
 *
 * Bans do not depend on the disconnect landing: the ban list is ours, and
 * installModeration acts again on every rejoin. Kicking is only how the current
 * session ends, and `ban()` reports whether it worked rather than assuming.
 */
/**
 * The three ways a Bedrock addon can remove somebody, tried in order.
 *
 * There is no fourth. Four packs were read to establish that — Minecraft
 * Essentials, its Soulbound edit, SafeGuard and AdminUtils — plus every one of
 * the 46 installed packs that imports @minecraft/server. Not one of them uses
 * anything but `kick`, and none of them can: `@minecraft/server-admin` is the
 * only module with a real disconnect and it exists on dedicated servers alone.
 * So the only variable left is WHO issues the command, and these are the three
 * answers anybody ships.
 *
 * SELF is first because it is the only one that changes the relationship rather
 * than the syntax. The player runs `kick @s` on themselves, so as far as the
 * command is concerned the executor and the target are the same person — no
 * operator is removing anybody. That is the shape SafeGuard uses, and it is the
 * candidate for why an admin-issued kick locks somebody out until the world is
 * relaunched while SafeGuard's does not.
 *
 * API is second: `Player.kick()`, undocumented, returning a CommandResult that
 * gives away that it runs /kick underneath. It is what this pack used alone,
 * and the route confirmed to leave a player locked out after an unban.
 *
 * SERVER is last and is the bluntest: the dimension runs the command at
 * operator level against a name. Closest to somebody typing /kick, so most
 * likely to carry whatever /kick does — which is why nothing tries it until
 * the other two have actually failed.
 */
const KICK_ROUTES = [
    {
        id: "self",
        available: t => typeof t?.runCommand === "function",
        // No quotes around the reason: /kick takes the rest of the line as a
        // message. SafeGuard passes real newlines through here and they render.
        run: (t, text) => t.runCommand(`kick @s ${text}`)
    },
    {
        id: "api",
        available: t => typeof t?.kick === "function",
        run: (t, text) => t.kick(text)
    },
    {
        id: "server",
        available: t => !!t?.name,
        run: (t, text) => (t.dimension ?? world.getDimension("overworld"))
            .runCommand(`kick "${t.name}" ${text}`)
    }
]

/**
 * Remove a player, and say honestly whether it happened.
 *
 * A route "worked" only if it did not throw AND did not come back with
 * successCount 0 — that second case is how a refusal actually arrives: no
 * throw, no rejection, just a count of nobody. Reporting success on the
 * strength of a method merely existing is the bug this replaced.
 */
export async function kick(target, reason) {
    const text = String(reason ?? "Kicked")
    if (!target) return false

    const tried = []
    for (const route of KICK_ROUTES) {
        if (!route.available(target)) { tried.push(`${route.id}: unavailable`); continue }
        try {
            const result = await route.run(target, text)
            if (result && typeof result.successCount === "number" && result.successCount === 0) {
                tried.push(`${route.id}: removed nobody`)
                continue
            }
            // Which route did it is the whole point of the next playtest, so it
            // is logged even on success.
            console.log(`[Admin+] kick: ${target.name} removed via "${route.id}"`
                + (tried.length ? ` — after ${tried.join(", ")}` : ""))
            return true
        } catch (e) {
            tried.push(`${route.id}: ${String(e).replace(/^Error: /, "").slice(0, 70)}`)
        }
    }

    console.warn(`[Admin+] kick: ${target.name} was NOT removed. Tried — ${tried.join(" | ")}`)
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
        system.run(async () => {
            pruneExpired()
            const record = banRecord(player)
            if (record) {
                const removed = await kick(player, banMessage(record))
                // A banned player still standing here is worth a log line, not
                // silence — it is the difference between "the ban works" and
                // "the ban is recorded and doing nothing visible".
                if (!removed) {
                    console.warn(`[Admin+] ${player.name} rejoined while banned and could not be removed`)
                }
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
