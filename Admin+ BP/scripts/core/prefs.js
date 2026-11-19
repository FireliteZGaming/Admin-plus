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
    "tpa.popup": {
        value: true,
        label: "Teleport request pop-ups",
        help: "Show teleport requests on your screen with Accept and Refuse, not only in chat.",
        off: "doesn't get pop-ups for teleport requests.",
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

// ---------------------------------------------------------------- looks
// Personalization's own switches (2.12.4, Beta): how a player looks, turned
// on and off by the player once their rank allows it. The user, 2026-11-13:
// "in personalization, there's obviously 'settings' and you can toggle these
// on and off, for name it'll be Name Effects as a toggle. If it's off you
// won't be able to see a way to change it until you turn it on. And this
// toggle is basicly like if you wanted to turn it on and off yourself, the
// rank settings give you the permission to do so."
//
// Kept apart from PREFS on purpose. Those are about being reachable and all
// start ON; these are about looks and start OFF, and "My settings" doesn't
// list them: Personalization ▸ Settings does. The same honesty rule holds:
// every switch names the file that reads it, and a test checks.

const looks = new Table("looks", {})

export const LOOKS = {
    "name.effects": {
        value: false,
        label: "Name effects",
        help: "Colours that move along your name, above your head and in chat.",
        // The rank switch that lets a player turn this on (core/ranks.js).
        needs: "personalize.nameeffect",
        readBy: "core/ranks.js"
    }
}

/** This player's own answer for a look switch, or its default (off). */
export function look(playerOrId, key) {
    const stored = looks.get(idOf(playerOrId))?.[key]
    if (stored === undefined) return LOOKS[key]?.value ?? false
    return stored === true || stored === "true"
}

/** Turn a look switch on or off. Only differences from the default are stored. */
export function setLook(playerOrId, key, on) {
    if (!(key in LOOKS)) return false
    const id = idOf(playerOrId)
    if (!id) return false
    const held = { ...(looks.get(id) ?? {}) }
    if (!!on === !!LOOKS[key].value) delete held[key]
    else held[key] = !!on
    if (Object.keys(held).length) looks.set(id, held)
    else looks.delete(id)
    return true
}
