import { Table } from "./storage.js"

// The allowlist: when it is on, only listed people may join.
//
// The opposite of the ban list, and worth having for the opposite reason. A ban
// list answers "who have we thrown out", which is reactive — somebody has to
// misbehave first. An allowlist answers "who is invited", which is what you
// actually want the evening you and four friends are building something and a
// Realm link has been passed around more widely than you meant.
//
// Kept BY NAME rather than by player id, because the whole point is inviting
// somebody who has never been here. Ids only exist for people who have already
// joined, which is exactly the case the feature is not for.

const KEY = "allowlist"

const store = new Table(KEY, { enabled: false, names: {} })

function names() {
    const held = store.get("names")
    return (held && typeof held === "object") ? held : {}
}

const key = name => String(name ?? "").trim().toLowerCase()

export function isEnabled() { return !!store.get("enabled") }

export function setEnabled(on) {
    store.set("enabled", !!on)
    return isEnabled()
}

/** @returns {boolean} true when it was actually added */
export function addName(name, by) {
    const id = key(name)
    if (!id) return false
    const held = names()
    if (held[id]) return false
    held[id] = { name: String(name).trim(), by: by?.name ?? "console", at: Date.now() }
    store.set("names", held)
    return true
}

/** @returns {boolean} true when something was removed */
export function removeName(name) {
    const id = key(name)
    const held = names()
    if (!held[id]) return false
    delete held[id]
    store.set("names", held)
    return true
}

export function listNames() {
    return Object.values(names()).sort((a, b) => a.name.localeCompare(b.name))
}

export function isAllowed(name) {
    return !!names()[key(name)]
}

export function count() { return Object.keys(names()).length }

// ---------------------------------------------------------------- maintenance
//
// The other reason to shut the door, and a different question from the guest
// list. The guest list is about WHO is invited and is meant to last; maintenance
// is about WHEN, applies to everybody at once, and is meant to be temporary.
// One gate, two rules, because "may this person come in" is one question.

export function inMaintenance() { return !!store.get("maintenance") }

export function maintenanceReason() {
    return String(store.get("maintenanceReason") || "The server is down for maintenance.")
}

export function setMaintenance(on, reason) {
    store.set("maintenance", !!on)
    const text = String(reason ?? "").trim()
    if (text) store.set("maintenanceReason", text.slice(0, 120))
    return inMaintenance()
}

/**
 * May this player be here?
 *
 * Staff and config owners are never turned away, by either rule. Locking the
 * person who administers the world out of it — because they forgot to add their
 * own name, or because they switched on maintenance to do the maintenance — is
 * the obvious way for this to go wrong and the one thing it must not do.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function doorCheck(player, { staff = false, owner = false } = {}) {
    if (staff || owner) return { ok: true }
    if (inMaintenance()) return { ok: false, reason: maintenanceReason() }
    if (isEnabled() && !isAllowed(player?.name)) {
        return { ok: false, reason: "This world is invite only." }
    }
    return { ok: true }
}

/** Boolean form, for callers that only need yes or no. */
export function admits(player, who) { return doorCheck(player, who).ok }
