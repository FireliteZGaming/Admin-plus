import { Table } from "./storage.js"
import { setting, flag } from "./settings.js"

// What people said, kept so staff can read it back.
//
// The audit log answers "who did what TO somebody". This answers "what was
// actually said", which is the other half of nearly every moderation decision:
// somebody reports an argument twenty minutes after it happened, and without
// this the only honest answer is "I wasn't there."
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

/**
 * Record one line of chat.
 *
 * Stores the PLAIN text. The formatted line carries colour codes, rank prefixes
 * and a channel label, none of which is what was typed — and a log that shows
 * the decoration rather than the words is harder to read at exactly the moment
 * somebody needs it.
 */
export function noteChat(sender, message, channel) {
    if (!flag("logs.chat")) return undefined
    const text = String(message ?? "").trim()
    if (!text) return undefined

    const entry = {
        id: `c${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        who: sender?.id,
        name: sender?.name ?? "?",
        channel: String(channel?.display ?? "").replace(/§./g, "") || undefined,
        text
    }
    log.set("lines", [entry, ...lines()].slice(0, cap()))
    return entry
}

/** Newest first. */
export function recentChat(limit = 100) { return lines().slice(0, limit) }

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
            || line.name.toLowerCase().includes(needle))
        .slice(0, limit)
}

export function chatLogSize() { return lines().length }

export function clearChatLog() { log.set("lines", []) }

/** Tests only. */
export function __resetChatLog() { sequence = 0; log.set("lines", []) }
