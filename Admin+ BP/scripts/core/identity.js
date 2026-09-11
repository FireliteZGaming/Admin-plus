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

/**
 * Formatting codes, and why a display name is not allowed to carry them loose.
 *
 * `§` plus one character is Minecraft's formatting escape. In BEDROCK a colour
 * code does not clear the style codes — only `§r` does — so `§k` in a nickname
 * obfuscates everything printed after it, `§l` bolds the rest of the line, and
 * neither stops at the end of the name. Every Admin+ message is a coloured
 * sentence with a name in the middle of it, so one nickname could scramble the
 * whole line:
 *
 *     [Admin+] §f§kSteve§a was muted for 10m by Alex
 *              ^^ from here on, everything is obfuscated
 *
 * The split is by AUDIENCE, not by caller:
 *
 *   displayName()  what Admin+ says in its OWN sentences — always plain. That
 *                  is 100-odd call sites, and they are fixed by this function
 *                  rather than by remembering at each one, which is the same
 *                  reason nameTokens exists a few lines down.
 *   nameTokens()   the templated lines — chat, the nametag, join and leave.
 *                  A template author put the colours there deliberately, so a
 *                  coloured nickname still renders; it just cannot escape,
 *                  because the token ends with `§r`.
 */
const FORMAT_CODE = /§./g

/** Drop every formatting code, leaving the letters. */
export function stripCodes(text) {
    return String(text ?? "").replace(FORMAT_CODE, "")
}

/**
 * End a styled name so it cannot bleed into what follows.
 *
 * `§r` only where a code was actually used: appending it to every plain
 * gamertag would reset the colour the template just set, so a name that styles
 * nothing changes nothing.
 */
export function terminate(text) {
    const raw = String(text ?? "")
    return raw.includes("§") ? `${raw}§r` : raw
}

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
    // A nickname that is ONLY formatting codes renders as nothing at all — an
    // invisible player in every list, chat line and nametag, which is a hiding
    // place rather than a name. Treated as clearing it, the same as blank.
    if (!trimmed || !stripCodes(trimmed).trim()) {
        nicknames.delete(id)
        return undefined
    }
    nicknames.set(id, trimmed)
    return trimmed
}

/**
 * What this player should be called: nickname if set, real name otherwise,
 * and PLAIN either way — see the note on FORMAT_CODE above. This is the name
 * Admin+ drops into its own sentences, and a sentence is not the place for a
 * name that can bold the rest of it.
 *
 * The styled form is not lost; it is what the templates get, through
 * nameTokens, and what the nametag above their head shows.
 */
export function displayName(player) {
    if (!player) return ""
    return stripCodes(getNickname(player) ?? player.name)
}

/** The nickname exactly as it was written, codes and all. */
export function styledName(playerOrId, fallback) {
    return getNickname(playerOrId) ?? fallback ?? ""
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
        return {
            NAME: stripCodes(playerOrName),
            NICKNAME: terminate(nickname || playerOrName)
        }
    }
    const real = playerOrName?.name ?? ""
    return {
        NAME: stripCodes(real),
        NICKNAME: terminate(styledName(playerOrName, real) || real)
    }
}

