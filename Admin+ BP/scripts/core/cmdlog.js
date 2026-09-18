import { Table } from "./storage.js"
import { setting, flag } from "./settings.js"

// What was TYPED, kept so staff can read it back.
//
// Three logs, three questions, and they are separate on purpose:
//
//   core/logs.js     who did what TO somebody      — bans, grants, config
//   core/chatlog.js  what was said                 — chat lines and signs
//   core/cmdlog.js   what was typed                — every command, this file
//
// A SEPARATE TABLE, for the reason chatlog.js gives about chat: commands
// outrun staff actions by orders of magnitude. `/warps`, `/online` and `/info`
// are typed constantly by ordinary players, and sharing the audit log's ring
// buffer would push every ban and mute out of Recent within minutes — the
// audit trail destroyed by the very thing meant to support it.
//
// **Everything is recorded, including commands that were refused.** A refusal
// is often the more interesting line: somebody working down the command list
// trying what sticks looks exactly like this, and nothing else in the pack
// would show it. Refusals are marked rather than filtered, so a reader can see
// the attempt and the outcome in one place.
//
// WHAT WAS TYPED, not what was executed. `/a:kill @e[type=cow]` is stored as
// the player wrote it, not as the eleven commands it became — a log of what
// somebody did should read like the thing they did. The expansion is an
// implementation detail of core/execute.js and belongs to the audit log.
//
// Arguments are captured BEFORE selector resolution, while a picker slot is
// still the text that was chosen. After resolution that slot holds entity
// objects, which stringify to nothing a person can read.

const CMD_KEY = "cmdLog"

const log = new Table(CMD_KEY, { lines: [] })

function lines() {
    const stored = log.get("lines")
    return Array.isArray(stored) ? stored : []
}

/** How many lines to keep. Commands are high-volume, so this earns its own cap. */
function cap() {
    const raw = Number(setting("logs.commandCap"))
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 1000) : 300
}

let sequence = 0

/**
 * Render one parsed argument as the text a person would recognise.
 *
 * The engine hands back primitives for most slots and, for a picker slot,
 * the gamertag that was picked. Anything else — a location, an entity that
 * slipped through — is reduced to something printable rather than `[object
 * Object]`, which is the single most common way a log line becomes useless.
 */
function renderArg(value) {
    if (value === undefined || value === null || value === "") return undefined
    if (Array.isArray(value)) {
        const names = value.map(v => v?.name ?? v?.typeId ?? "?").filter(Boolean)
        return names.length ? names.join(" ") : undefined
    }
    if (typeof value === "object") {
        if (typeof value.x === "number" && typeof value.y === "number") {
            return `${Math.round(value.x)} ${Math.round(value.y)} ${Math.round(value.z ?? 0)}`
        }
        return value.name ?? value.typeId ?? undefined
    }
    return String(value)
}

/**
 * Record one command.
 *
 * `refused` carries the reason when the command never ran, and is left
 * undefined when it did. Storing the reason rather than a bare flag means the
 * log can say *why* — "no permission" and "nothing matched that name" are
 * different stories about the same player.
 */
export function noteCommand(player, name, args, refused) {
    if (!flag("logs.commands")) return undefined

    const rendered = (Array.isArray(args) ? args : [])
        .map(renderArg)
        .filter(a => a !== undefined)

    const entry = {
        id: `x${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        who: player?.id,
        name: player?.name ?? "?",
        cmd: String(name ?? "?"),
        args: rendered.length ? rendered.join(" ") : undefined,
        refused: refused ? String(refused) : undefined
    }
    log.set("lines", [entry, ...lines()].slice(0, cap()))
    return entry
}

/**
 * Attach what a command actually BECAME to the entry just written for it.
 *
 * The `/a:` passthroughs expand before they run — `/a:kill @e[type=cow]` goes
 * out as a tagged selector, and `@a` becomes one execution per player. That
 * expansion is worth keeping and is not worth a second log entry: the same
 * command appearing twice is the confusion this reorganisation exists to end.
 *
 * Matches the newest entry from this player that has no expansion recorded
 * yet. The funnel in core/registry.js writes that entry immediately before
 * scheduling the handler, so within one tick there is exactly one candidate.
 */
export function noteExecuted(player, executed) {
    if (!flag("logs.commands")) return undefined
    const text = String(executed ?? "").trim()
    if (!text || !player?.id) return undefined

    const all = lines()
    const i = all.findIndex(line => line.who === player.id && line.ran === undefined)
    if (i === -1) return undefined
    // `/kill @e[...]` and `kill @e[...]` reach here from different routes; one
    // leading slash, always, or the log reads as two different things.
    all[i] = { ...all[i], ran: text.startsWith("/") ? text : `/${text}` }
    log.set("lines", all)
    return all[i]
}

/** The line as a reader sees it: `/mute Herobrine 10m`. */
export function commandText(entry) {
    return `/${entry.cmd}${entry.args ? ` ${entry.args}` : ""}`
}

/** Newest first. */
export function recentCommands(limit = 100) { return lines().slice(0, limit) }

/** Everything one player typed, newest first. */
export function commandsBy(playerId, limit = 100) {
    return lines().filter(line => line.who === playerId).slice(0, limit)
}

/**
 * Lines matching `text`, case-insensitively, over the command, its arguments
 * and who typed it — the three things somebody arrives knowing.
 */
export function searchCommands(text, limit = 100) {
    const needle = String(text ?? "").trim().toLowerCase()
    if (!needle) return []
    return lines()
        .filter(line => line.cmd.toLowerCase().includes(needle)
            || (line.args ?? "").toLowerCase().includes(needle)
            || line.name.toLowerCase().includes(needle))
        .slice(0, limit)
}

/** Only the ones that were turned away. */
export function refusedCommands(limit = 100) {
    return lines().filter(line => line.refused).slice(0, limit)
}

export function commandLogSize() { return lines().length }

export function clearCommandLog() { log.set("lines", []) }

/** Tests only. */
export function __resetCommandLog() { sequence = 0; log.set("lines", []) }
