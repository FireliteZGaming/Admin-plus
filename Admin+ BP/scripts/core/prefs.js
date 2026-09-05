import { Table } from "./storage.js"

// Per-player preferences — the first thing in this pack a MEMBER owns.
//
// Everything else stored about a player is something staff did TO them: a ban,
// a mute, a warning, a rank. This is the opposite, and that difference is the
// whole reason it is a separate table rather than another field on the holder
// record: `setRanks` rewrites that record wholesale, so a preference living
// there would be erased by any ordinary rank edit. (Exactly the trap the
// staff-mode vanish flag fell into, found by playtest.)
//
// THE RULE THAT KEEPS THIS HONEST: a preference exists only if some feature
// actually reads it. A settings screen full of switches that change nothing is
// worse than no screen — the player believes they turned something off. Every
// key below names the file that honours it, and a test asserts that file
// mentions it.

const store = new Table("prefs", {})

/**
 * The switches, their defaults, and who reads them.
 *
 * Defaults are all ON, deliberately. A member who has never opened the menu
 * should be reachable exactly as they are today — turning something off is an
 * act, not the starting state.
 */
export const PREFS = {
    "tpa.accept": {
        value: true,
        label: "Teleport requests",
        help: "Let people ask to teleport to you, or ask you to come to them.",
        off: "isn't accepting teleport requests.",
        readBy: "features/tpa.js"
    },
    "prchat.accept": {
        value: true,
        label: "Private chat invites",
        help: "Let people open a private two-person chat with you.",
        off: "isn't accepting private chat invites.",
        readBy: "features/privatechat.js"
    },
    "pm.accept": {
        value: true,
        label: "Private messages",
        help: "Let people send you private messages. Staff can always reach you.",
        off: "isn't accepting private messages.",
        readBy: "features/privatechat.js"
    }
}

const idOf = p => typeof p === "string" ? p : p?.id

/** What this player has chosen, or the shipped default. */
export function pref(playerOrId, key) {
    const stored = store.get(idOf(playerOrId))?.[key]
    if (stored === undefined) return PREFS[key]?.value ?? true
    return stored === true || stored === "true"
}

/**
 * Change one switch.
 *
 * Only DIFFERENCES from the default are stored, so a player who never touches
 * the screen occupies nothing, and changing a shipped default later reaches
 * everybody who never disagreed with it.
 */
export function setPref(playerOrId, key, on) {
    if (!(key in PREFS)) return false
    const id = idOf(playerOrId)
    if (!id) return false

    const held = { ...(store.get(id) ?? {}) }
    if (!!on === !!PREFS[key].value) delete held[key]
    else held[key] = !!on

    if (Object.keys(held).length) store.set(id, held)
    else store.delete(id)
    return true
}

/** Every switch with this player's answer, for the settings screen. */
export function prefsOf(playerOrId) {
    return Object.entries(PREFS).map(([key, spec]) => ({
        key, ...spec, on: pref(playerOrId, key)
    }))
}

/** How many they have changed from the shipped answer. */
export function changedCount(playerOrId) {
    return Object.keys(store.get(idOf(playerOrId)) ?? {}).length
}

/** Testing seam. */
export function __resetPrefs(playerOrId) { store.delete(idOf(playerOrId)) }
