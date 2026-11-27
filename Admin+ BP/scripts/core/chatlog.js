import { Table } from "./storage.js"
import { setting, flag } from "./settings.js"

// What people said, kept so staff can read it back.
//
// The audit log answers "who did what TO somebody". This answers "what was
// actually said", which is the other half of nearly every moderation decision:
// somebody reports an argument twenty minutes after it happened, and without
// this the only honest answer is "I wasn't there."
//
// **Chat here means everything a player put in front of other players**: what
// they typed, and what they wrote on a sign. Signs used to be filed as audit
// actions, which is why they turned up under Recent between a ban and a rank
// grant. `kind: "sign"` marks them; everything else is spoken.
//
// A SEPARATE TABLE, not entries in the audit log. Chat outruns staff actions by
// orders of magnitude, so sharing a ring buffer would push every ban and mute
// out of Recent within minutes — the audit trail would be destroyed by the very
// thing meant to support it.
//
// PRIVATE MESSAGES ARE NOT IN HERE, and that is a boundary rather than an
// oversight. This hangs off postToChannel, the funnel for the CHANNEL system —
// public chat, staff chat, whatever channels a world defines. /pm and private
// chat send straight to the players involved and never pass through it, so they
// cannot be logged by accident. Players can also switch those off entirely in
// their own settings, and a log that quietly kept them anyway would make that
// preference a lie.
//
// `/sudo` DOES land here, because it goes through the same funnel — which is
// exactly right. A line somebody was made to say is the line most worth having
// a record of, and core/audit.js separately records who did the sudoing.

const CHAT_KEY = "chatLog"

const log = new Table(CHAT_KEY, { lines: [] })

function lines() {
    const stored = log.get("lines")
    return Array.isArray(stored) ? stored : []
}

/** How many lines to keep. Chat is high-volume, so this earns its own cap. */
function cap() {
    const raw = Number(setting("logs.chatCap"))
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 1000) : 200
}

let sequence = 0

/** Chat Moderation's note on an entry: `mod` (what it did) and `unsent`, nothing else. */
function noteOf(extra) {
    const out = {}
    if (extra?.mod) out.mod = String(extra.mod)
    if (extra?.unsent) out.unsent = true
    return out
}

/**
 * Record one line of chat.
 *
 * Stores the PLAIN text. The formatted line carries colour codes, rank prefixes
 * and a channel label, none of which is what was typed — and a log that shows
 * the decoration rather than the words is harder to read at exactly the moment
 * somebody needs it.
 */
export function noteChat(sender, message, channel, extra) {
    if (!flag("logs.chat")) return undefined
    const text = String(message ?? "").trim()
    if (!text) return undefined

    const entry = {
        id: `c${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        who: sender?.id,
        name: sender?.name ?? "?",
        channel: String(channel?.display ?? "").replace(/§./g, "") || undefined,
        // The ID as well as the display name, because who may READ a line back
        // is decided by which room it was said in — and a display name is a
        // label an owner can rename, while the id is what canUse() answers on.
        channelId: channel?.id,
        text,
        // 3.1.4: what Chat Moderation did with it ("held for staff:
        // harassment 85"), and `unsent` for a line that never reached the room
        // (held, cancelled, or the player was kicked). The user: these "should
        // also be logged in logs (chat)".
        ...noteOf(extra)
    }
    log.set("lines", [entry, ...lines()].slice(0, cap()))
    return entry
}

/**
 * Record what somebody wrote on a sign.
 *
 * **A sign is chat.** It was filed as an audit ACTION until 2.6.6, which put
 * it under Recent next to bans and grants while the Chat screen — reading this
 * table — could not see it at all. The two halves of "what did people say
 * here" lived in different stores on different screens. They are one thing,
 * and a reader looking for words somebody wrote should find them in one place.
 *
 * `where` is kept off the line itself and shown on the detail view: a
 * coordinate in the middle of a sentence is noise until the moment you need
 * it, and then you open the entry.
 *
 * Low-volume next to chat, so it shares chat's cap without crowding it — a
 * busy world produces thousands of messages for every sign.
 */
export function noteSign(player, text, where, previous, extra) {
    // A sign Chat Moderation cleared is kept even with the sign log off:
    // what automod did is the record staff need.
    if (!flag("logs.signs") && !extra?.mod) return undefined
    const written = String(text ?? "").trim()
    if (!written) return undefined

    const entry = {
        id: `s${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        who: player?.id,
        name: player?.name ?? "?",
        kind: "sign",
        where: where ? String(where) : undefined,
        // What it said before, when this was an edit. The reason to keep a sign
        // log at all is usually that somebody changed one into something else.
        was: previous ? String(previous) : undefined,
        text: written,
        ...noteOf(extra)
    }
    log.set("lines", [entry, ...lines()].slice(0, cap()))
    return entry
}

/** Newest first. */
export function recentChat(limit = 100) { return lines().slice(0, limit) }

/** Only what people wrote on signs, newest first. */
export function recentSigns(limit = 100) {
    return lines().filter(line => line.kind === "sign").slice(0, limit)
}

/** Only spoken chat, newest first — signs excluded. */
export function recentSpoken(limit = 100) {
    return lines().filter(line => line.kind !== "sign").slice(0, limit)
}

/** Everything one player said, newest first. */
export function chatBy(playerId, limit = 100) {
    return lines().filter(line => line.who === playerId).slice(0, limit)
}

/** Lines containing `text`, case-insensitively. */
export function searchChat(text, limit = 100) {
    const needle = String(text ?? "").trim().toLowerCase()
    if (!needle) return []
    return lines()
        .filter(line => line.text.toLowerCase().includes(needle)
            || line.name.toLowerCase().includes(needle)
            // What a sign USED to say is searchable too — "it said X before
            // somebody changed it" is the usual reason to come looking.
            || (line.was ?? "").toLowerCase().includes(needle))
        .slice(0, limit)
}

export function chatLogSize() { return lines().length }

export function clearChatLog() { log.set("lines", []) }

/** Tests only. */
export function __resetChatLog() { sequence = 0; log.set("lines", []) }
