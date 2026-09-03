import { world, system } from "@minecraft/server"
import { has, canActOn } from "./ranks.js"
import { render, flag } from "./settings.js"
import { displayName } from "./identity.js"

// "Admin used kick on Member" — said in chat, to the people entitled to know.
//
// This hangs off record() in core/logs.js rather than off each command, which
// means it cannot drift: every staff action already writes a log entry, so
// every staff action gets its line, and a command added later is covered the
// day it starts logging. The panel's Kick button and /kick produce the same
// sentence, because they are the same act.
//
// WHO SEES IT is the whole design. It goes to staff who outrank the TARGET —
// so the person it happened to never reads it, and neither does anyone below
// them. "Higher ranks" is measured against the affected player, not against the
// staff member who acted, because the question being answered is "who is
// entitled to know what was done to this person".

/**
 * Actions whose audience is narrower than "any staff above the target".
 *
 * Sudo is the one that matters: it puts words in somebody's mouth, and a line
 * saying so is only safe among people senior enough to have done it themselves.
 * Anyone else reading "X used sudo on Y" can simply tell Y.
 */
const NARROW = {
    "player.sudo": "admin.sudo"
}

/** Never announced — either noise, or already reported through another door. */
const SILENT = new Set([
    "report.filed",             // reports already ping staff on their own
    "report.handled",
    "mod.invsee.take",          // the invsee OPEN is the event; per-item is spam
    "mod.invsee.destroy"
])

/** Actions whose stripped name would read badly. */
const VERBS = {
    "rank.grant": "grant rank",
    "rank.revoke": "revoke rank",
    "rank.set": "set ranks",
    "mod.tpaClose": "close TPA",
    "mod.tpaOpen": "open TPA",
    "mod.invsee": "invsee",
    "player.sudo": "sudo"
}

/** "mod.kick" -> "kick". The branch prefix is for filtering logs, not for reading. */
export function verbOf(action) {
    if (VERBS[action]) return VERBS[action]
    const parts = String(action ?? "").split(".")
    return parts.length > 1 ? parts.slice(1).join(".") : (parts[0] || "act")
}

/**
 * Who is told. Exported so it can be tested against the real rule rather than
 * a restatement of it.
 */
export function audienceFor(actor, target, action) {
    if (!flag("audit.announce")) return []
    if (!actor || !target || SILENT.has(action)) return []

    const node = NARROW[action]
    const out = []
    for (const viewer of world.getAllPlayers()) {
        if (viewer.id === actor.id) continue        // they already got told
        if (viewer.id === target.id) continue       // never the person it happened to
        if (node ? !has(viewer, node) : !has(viewer, "admin.panel")) continue
        if (!canActOn(viewer, target)) continue     // must outrank the target
        out.push(viewer)
    }
    return out
}

/** Build the line without sending it. */
export function lineFor(actor, target, action, detail) {
    return render("format.command", {
        NAME: displayName(actor),
        COMMAND: verbOf(action),
        TARGET: displayName(target),
        DETAIL: String(detail ?? "")
    })
}

/**
 * Announce one staff action. Called from record(); nothing else should need to.
 * @returns {number} how many people were told
 */
export function announce(actor, action, target, detail) {
    const audience = audienceFor(actor, target, action)
    if (!audience.length) return 0

    const line = lineFor(actor, target, action, detail)
    // Deferred: record() is called from inside event handlers, and sending a
    // message is not something to do while one is still being dispatched.
    system.run(() => {
        for (const viewer of audience) {
            try { viewer.sendMessage(line) } catch { /* left mid-tick */ }
        }
    })
    return audience.length
}

export { NARROW, SILENT }
