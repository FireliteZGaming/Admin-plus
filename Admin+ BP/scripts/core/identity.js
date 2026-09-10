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

/**
 * The two name tokens a format string can use, always BOTH, so a template gets
 * to choose rather than the code choosing for it.
 *
 *   {NAME}      the real gamertag, always. The thing you ban, look up in the
 *               audit log, or hand to another admin.
 *   {NICKNAME}  what they are calling themselves — the nickname if they have
 *               one, and the gamertag if they do not.
 *
 * `{NICKNAME}` falls back rather than rendering empty on purpose: these strings
 * are edited by hand in Settings, and a token that silently disappears leaves a
 * chat line reading "  joined the game" with nobody in it. Falling back means a
 * template can use `{NICKNAME}` alone and always say something.
 *
 * Every site that fills a name token goes through here. There are nine of them
 * — chat, the nametag, join, leave, /me, both directions of PM, broadcast and
 * the staff action notice — and the reason they share one function is that
 * `{NAME}` used to mean the DISPLAY name in some and never got a second
 * meaning anywhere. One helper is what stops that drifting apart again.
 *
 * @param playerOrName a Player, or a bare name when the player object is gone
 * @param nickname     only with a bare name, when the nickname is known separately
 */
export function nameTokens(playerOrName, nickname) {
    if (typeof playerOrName === "string") {
        return { NAME: playerOrName, NICKNAME: nickname || playerOrName }
    }
    const real = playerOrName?.name ?? ""
    return { NAME: real, NICKNAME: displayName(playerOrName) || real }
}

