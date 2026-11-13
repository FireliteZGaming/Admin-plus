import { Table } from "./storage.js"
import { CONFIG } from "../config.js"
import { STYLES, paint } from "./nametag.js"
import { flag } from "./settings.js"

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

/**
 * Each player's own name font (core/fonts.js), set in Players ▸ a player ▸
 * Basics beside their display name. Stored apart from the nickname, so the
 * nickname stays exactly what was typed.
 */
const nameFonts = new Table("nameFonts", {})

export function getNameFont(playerOrId) {
    return nameFonts.get(idOf(playerOrId)) || "normal"
}

export function setNameFont(playerOrId, fontId) {
    const id = idOf(playerOrId)
    if (!fontId || fontId === "normal") nameFonts.delete(id)
    else nameFonts.set(id, String(fontId))
}

/**
 * Each player's own name colours (2.12.0), set in /menu ▸ Personalization: up
 * to four colour codes, kept as their letters. core/ranks.js decides whether
 * they show (the rank's Name colour switch and the Beta pack setting).
 */
const nameColours = new Table("nameColours", {})
const COLOUR_LETTER = /^[0-9a-jmnpqstuv]$/

export function getNameColours(playerOrId) {
    const raw = nameColours.get(idOf(playerOrId))
    return Array.isArray(raw) ? raw.map(c => String(c).toLowerCase()).filter(c => COLOUR_LETTER.test(c)).slice(0, 4) : []
}

/** Save up to four colours; none clears them. Returns what was kept. */
export function setNameColours(playerOrId, codes) {
    const id = idOf(playerOrId)
    const list = (codes ?? []).map(c => String(c).toLowerCase()).filter(c => COLOUR_LETTER.test(c)).slice(0, 4)
    if (!list.length) nameColours.delete(id)
    else nameColours.set(id, list)
    return list
}

/**
 * How a name is dressed before a template draws it: the font. core/ranks.js
 * registers this, because a rank can give its players a name font and only
 * ranks.js knows who holds what; identity.js cannot import ranks.js without a
 * cycle.
 */
let decorateName = (player, text) => text
export function setNameDecorator(fn) {
    decorateName = typeof fn === "function" ? fn : (player, text) => text
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
    // Follows the same order as styledName and then flattens it: a nickname
    // first, the creator's own name next, the gamertag last. It has to follow,
    // because this already followed a NICKNAME — leaving the creator default
    // out would have meant Admin+'s own sentences saying FireliteZGaming while
    // every other surface said Firelite, which is the split this set out to fix.
    //
    // Stripped, like everything else here. `{NAME}` is still the gamertag, and
    // that is what a ban and the audit log use.
    return stripCodes(getNickname(player) ?? creatorStill(player) ?? player.name)
}

/**
 * The creator's own name, already coloured, or undefined for everyone else.
 *
 * **This is the "no matter what" part.** The nametag is drawn by core/ranks.js
 * and animates; every OTHER surface — chat, join and leave lines, private
 * messages, broadcasts, the greeting — comes through `nameTokens` below, and
 * until 2.7.6 none of them knew about this, so the creator appeared as
 * `Firelite` above their head and `FireliteZGaming` in the chat line under it.
 *
 * Those surfaces print once and are never redrawn, so they get the STILL rather
 * than the animation — which is exactly the string that was asked for, since
 * frame 0 of the molten ramp is `§mF§4i§nr§ce§6l§pi§gt§ee`.
 *
 * Built here from the ramp rather than pasted as a literal. A hardcoded copy
 * would drift silently the day the ramp is touched, and then the name above
 * their head and the name in chat would be two different colourings of the same
 * word — which is the bug this function exists to remove, reintroduced in a
 * subtler place.
 *
 * `matchesCreator` takes a NAME, not a player, so a leave line built from a
 * stored gamertag resolves the same way a live player does.
 */
function matchesCreator(name) {
    return String(name ?? "").toLowerCase()
        === String(CONFIG.creator?.gamertag ?? "").toLowerCase()
}

export function creatorStill(nameOrPlayer) {
    // The same switch the nametag obeys. Without it here the feature was only
    // half-switchable: turning it off restored the gamertag above their head
    // and left it replaced in every chat line, which is a worse state than
    // either setting.
    if (!flag("creator.identity")) return undefined
    const name = typeof nameOrPlayer === "string" ? nameOrPlayer : nameOrPlayer?.name
    if (!matchesCreator(name)) return undefined
    const ramp = STYLES[CONFIG.creator?.style]?.ramp
    const text = CONFIG.creator?.name ?? name
    return ramp ? paint(text, ramp, 0) : text
}

/**
 * What to call them: their nickname, else the creator's own name, else what
 * they were born with.
 *
 * The order is the whole rule. A nickname they set beats the default — that is
 * what "unless they replace my nametag" meant — and clearing it falls through
 * to HERE rather than to the gamertag.
 */
export function styledName(playerOrId, fallback) {
    const nick = getNickname(playerOrId)
    if (nick !== undefined) return nick
    return creatorStill(fallback) ?? fallback ?? ""
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
        // The string branch is for somebody who is no longer here to ask — the
        // LEAVE line is built from a stored gamertag, because the Player object
        // is gone by the time it prints. It has to resolve the creator's name
        // the same way, or they would join as one name and leave as another.
        return {
            NAME: stripCodes(playerOrName),
            NICKNAME: terminate(nickname || creatorStill(playerOrName) || playerOrName)
        }
    }
    const real = playerOrName?.name ?? ""
    return {
        NAME: stripCodes(real),
        // In their name font, if they or their rank have one.
        NICKNAME: terminate(decorateName(playerOrName, styledName(playerOrName, real) || real))
    }
}

