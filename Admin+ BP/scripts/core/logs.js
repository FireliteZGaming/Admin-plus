import { Table } from "./storage.js"
import { CONFIG } from "../config.js"
import { announce } from "./audit.js"

// The audit log.
//
// Every entry records BOTH sides — who did it and who it happened to — because
// the two questions staff actually ask are "what was done to this player" (an
// appeal) and "what has this staff member been doing" (an audit). A flat
// chronological feed answers neither without scrolling.
//
// Reversible entries carry the PRIOR STATE, not a reverse instruction. Undoing
// a demotion by re-adding the rank that was removed is wrong the moment
// something else changed in between; restoring the exact list they held is not.

const LOG_KEY = "auditLog"

const log = new Table(LOG_KEY, { entries: [] })

function entries() {
    const list = log.get("entries")
    return Array.isArray(list) ? list : []
}

function cap() {
    const limit = Number(CONFIG.limits.logEntries)
    return Number.isFinite(limit) && limit > 0 ? limit : 300
}

let sequence = 0

/**
 * Record something a staff member did.
 * @param {object} actor the player who acted
 * @param {string} action dotted, e.g. "mod.ban" — the branch is filterable
 * @param {{id?: string, name?: string}|undefined} target who it happened to
 * @param {string} detail one short human string
 * @param {object|undefined} undo prior state, when this can be reversed
 */
export function record(actor, action, target, detail, undo) {
    const entry = {
        id: `l${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        seq: sequence,
        actor: actor ? { id: actor.id, name: actor.name } : { name: "console" },
        action,
        target: target ? { id: target.id, name: target.name } : undefined,
        detail: String(detail ?? ""),
        undo,
        undone: undefined
    }

    // Ring buffer: oldest out first, so a long-running realm cannot grow this
    // without bound.
    const list = [entry, ...entries()].slice(0, cap())
    log.set("entries", list)

    // Say it out loud, to the people entitled to hear it. Hanging this off the
    // log rather than off each command is what keeps the two consistent: if it
    // was worth recording, it is the same event worth announcing, and a command
    // added later is covered the day it starts logging.
    try { announce(actor, action, target, detail) } catch { /* never break the log */ }

    return entry
}

export function recent(limit = 100) { return entries().slice(0, limit) }

export function getEntry(id) { return entries().find(e => e.id === id) }

/** What was done TO this player — the appeal view. */
export function about(playerId) {
    return entries().filter(e => e.target?.id === playerId)
}

/** What this player DID — the audit view. */
export function by(playerId) {
    return entries().filter(e => e.actor?.id === playerId)
}

/** Everything under a dotted branch: "mod" matches "mod.ban". */
export function branch(prefix) {
    return entries().filter(e => e.action === prefix || e.action.startsWith(prefix + "."))
}

export function search(text) {
    const needle = String(text ?? "").trim().toLowerCase()
    if (!needle) return []
    return entries().filter(e =>
        (e.actor?.name ?? "").toLowerCase().includes(needle)
        || (e.target?.name ?? "").toLowerCase().includes(needle)
        || e.detail.toLowerCase().includes(needle)
        || e.action.toLowerCase().includes(needle))
}

/** Everyone the log has seen, for the player picker. */
export function people() {
    const seen = new Map()
    for (const entry of entries()) {
        for (const side of [entry.actor, entry.target]) {
            if (side?.id && !seen.has(side.id)) seen.set(side.id, side)
        }
    }
    return [...seen.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

export function canUndo(entry) {
    return !!entry?.undo && !entry.undone
}

/** Mark an entry as reversed. The actual reversal lives with the feature. */
export function markUndone(entry, player) {
    const list = entries()
    const found = list.find(e => e.id === entry.id)
    if (!found || found.undone) return false
    found.undone = { by: player?.name ?? "console", at: Date.now() }
    log.set("entries", list)
    return true
}

export function clear() { log.set("entries", []) }

export function size() { return entries().length }

/** Short label for a list row. */
export function summarise(entry) {
    const verb = entry.action.split(".").pop().toUpperCase()
    const who = entry.target?.name ? ` §f${entry.target.name}` : ""
    return `§8${verb}${who}`
}
