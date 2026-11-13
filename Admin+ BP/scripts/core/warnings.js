import { Table } from "./storage.js"
import { setting } from "./settings.js"
import { CONFIG } from "../config.js"

// Warnings.
//
// The step below a mute: it does nothing to the player except tell them, and
// leave a mark somebody can count later. That counting is the whole feature —
// "third warning this week" is the sentence staff actually want to be able to
// say, and a chat message nobody logs cannot produce it.
//
// Kept apart from the audit log on purpose. The log records what STAFF did, and
// is read by staff; a warning is addressed to the PLAYER and they are entitled
// to read their own. Same event, two audiences, two different retention rules —
// folding them together would mean either showing players the staff log or
// hiding their own warnings from them.
//
// Shape:  { [playerId]: { name, entries: [{ id, at, by, byId, reason, note }] } }

const warnings = new Table("warnings", {})

/** Reasons offered in the picker. "Other" is last and always present. */
export const WARN_REASONS = [
    "Chat behaviour",
    "Harassment",
    "Spam",
    "Griefing",
    "Cheating",
    "Ignoring staff",
    "Other"
]

const idOf = p => typeof p === "string" ? p : p?.id
const nameOf = p => typeof p === "string" ? "" : (p?.name ?? "")

function cap() {
    const limit = Number(CONFIG.limits?.logEntries)
    return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 50
}

function recordFor(playerOrId) {
    const id = idOf(playerOrId)
    return warnings.get(id) ?? { name: nameOf(playerOrId), entries: [] }
}

/**
 * How long an ordinary warning stays on a record.
 *
 * 48 hours by default. A warning is a nudge with a memory, not a mark for life:
 * somebody who was told off for spamming on Tuesday should not still be one
 * step from a ban on Friday. Nothing enforces good behaviour like knowing the
 * slate genuinely clears.
 *
 * 0 turns expiry off entirely, for a server that wants a permanent record.
 */
function expireAfter() {
    const hours = Number(setting("warnings.expire"))
    return Number.isFinite(hours) && hours > 0 ? hours * 3600000 : 0
}

/**
 * Is this warning still on the record?
 *
 * **Severe ones never expire.** That is the whole reason the flag exists: the
 * things worth remembering past the week are exactly the things somebody chose
 * to mark, and a timer that forgot them would make the flag meaningless. An
 * entry written before severity existed has no flag, so it expires like any
 * ordinary one — which is the forgiving reading, and the right default for a
 * record nobody marked.
 */
export function warningLive(entry, now = Date.now()) {
    if (!entry) return false
    if (entry.severe) return true
    const window = expireAfter()
    if (!window) return true
    return now - (entry.at ?? 0) < window
}

/** Every warning still standing against a player, newest first. */
export function warningsFor(playerOrId, now = Date.now()) {
    const entries = recordFor(playerOrId).entries
    if (!Array.isArray(entries)) return []
    return entries
        .filter(entry => warningLive(entry, now))
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/**
 * Every warning ever, expired ones included.
 *
 * Staff reading a record should be able to see that somebody has been warned
 * four times this month even though none of them count any more — "clean now"
 * and "never warned" are different facts, and only one of them is reassuring.
 */
export function warningHistory(playerOrId) {
    const entries = recordFor(playerOrId).entries
    return Array.isArray(entries) ? [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : []
}

export function warningCount(playerOrId) { return warningsFor(playerOrId).length }

/** One warning, by its id. */
export function getWarning(playerOrId, warningId) {
    return warningsFor(playerOrId).find(w => w.id === warningId)
}

/**
 * Add a warning.
 * @returns {{ok: true, entry: object, total: number} | {ok: false, reason: string}}
 */
// A counter, not a random number: two warnings in the same millisecond could
// share an id, and taking one back then removed both. Same fix as reports.
let sequence = 0

export function addWarning(actor, target, reason, note = "", options = {}) {
    const targetId = idOf(target)
    if (!targetId) return { ok: false, reason: "No such player." }
    if (idOf(actor) === targetId) return { ok: false, reason: "You can't warn yourself." }

    const text = String(reason ?? "").trim()
    if (!text) return { ok: false, reason: "A warning needs a reason." }

    const entry = {
        id: `w${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        by: actor?.name ?? "console",
        byId: idOf(actor),
        reason: text.slice(0, 120),
        note: String(note ?? "").trim().slice(0, 200),
        // Only stored when true, so an ordinary warning stays the small object
        // it was and old records read identically.
        ...(options.severe ? { severe: true } : {})
    }

    const held = recordFor(target)
    const entries = [entry, ...(Array.isArray(held.entries) ? held.entries : [])].slice(0, cap())
    warnings.set(targetId, {
        name: nameOf(target) || held.name || "",
        entries
    })
    return { ok: true, entry, total: entries.length }
}

/** Remove one warning. Returns the entry that went, or undefined. */
export function removeWarning(playerOrId, warningId) {
    const id = idOf(playerOrId)
    const held = recordFor(playerOrId)
    const entries = Array.isArray(held.entries) ? held.entries : []
    const found = entries.find(w => w.id === warningId)
    if (!found) return undefined
    warnings.set(id, { name: held.name, entries: entries.filter(w => w.id !== warningId) })
    return found
}

/** Wipe someone's slate. Returns how many went. */
export function clearWarnings(playerOrId) {
    const id = idOf(playerOrId)
    const gone = warningCount(playerOrId)
    if (!gone) return 0
    warnings.set(id, { name: recordFor(playerOrId).name, entries: [] })
    return gone
}

/** Everyone the warning list has heard of, for the offline picker. */
export function warnedPlayers() {
    return warnings.entries()
        .filter(([, rec]) => (rec?.entries ?? []).length)
        .map(([id, rec]) => ({ id, name: rec.name || id, count: rec.entries.length }))
        .sort((a, b) => b.count - a.count)
}

/** One line for a player-info screen. */
export function warningLine(playerOrId) {
    const n = warningCount(playerOrId)
    if (!n) return "§7none"
    return `§e${n}§7 · last: §f${warningsFor(playerOrId)[0].reason}`
}
