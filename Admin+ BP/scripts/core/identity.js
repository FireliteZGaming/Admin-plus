import { Table } from "./storage.js"

// Display names.
//
// A nickname overrides the player's account name everywhere Admin+ renders them:
// the nametag above their head and (once chat formatting is live) chat. Clearing
// it falls straight back to the real name — there is no separate "reset" state to
// get stuck in.
//
// Deliberately kept free of any rank import so ranks.js can render nametags
// without a circular dependency.

export const NICK_MAX = 30

const nicknames = new Table("nicknames", {})

function idOf(playerOrId) {
    return typeof playerOrId === "string" ? playerOrId : playerOrId?.id
}

/** The raw nickname, or undefined when they use their real name. */
export function getNickname(playerOrId) {
    const nick = nicknames.get(idOf(playerOrId))
    return nick || undefined
}

/**
 * Set or clear a nickname. Empty / whitespace clears it.
 * @returns {string|undefined} the stored nickname, or undefined if cleared
 */
export function setNickname(playerOrId, value) {
    const id = idOf(playerOrId)
    // Strip control characters before the length cap: a line break in a display
    // name would break the nametag layout and any command it is interpolated into.
    const trimmed = String(value ?? "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, NICK_MAX)
    if (!trimmed) {
        nicknames.delete(id)
        return undefined
    }
    nicknames.set(id, trimmed)
    return trimmed
}

/** What this player should be called: nickname if set, real name otherwise. */
export function displayName(player) {
    if (!player) return ""
    return getNickname(player) ?? player.name
}

/** True when they are wearing a nickname rather than their account name. */
export function hasNickname(playerOrId) { return getNickname(playerOrId) !== undefined }

