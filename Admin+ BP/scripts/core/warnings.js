import { Table } from "./storage.js"
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

/** Every warning against a player, newest first. */
export function warningsFor(playerOrId) {
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
export function addWarning(actor, target, reason, note = "") {
    const targetId = idOf(target)
    if (!targetId) return { ok: false, reason: "No such player." }
    if (idOf(actor) === targetId) return { ok: false, reason: "You can't warn yourself." }

    const text = String(reason ?? "").trim()
    if (!text) return { ok: false, reason: "A warning needs a reason." }

    const entry = {
        id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
        at: Date.now(),
        by: actor?.name ?? "console",
        byId: idOf(actor),
        reason: text.slice(0, 120),
        note: String(note ?? "").trim().slice(0, 200)
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
