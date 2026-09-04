import { world, system } from "@minecraft/server"
import { has, canActOn } from "./ranks.js"
import { render, flag } from "./settings.js"
import { displayName } from "./identity.js"

// "[Admin: Kicked Member]" — said in chat, to the people entitled to know.
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
    "mod.invsee.destroy",
    "admin.vanish",             // vanish tells staff itself, in its own words
    "admin.unvanish",
    // Staff mode is done to yourself, not to anybody — the actor and the target
    // are the same person, so the audience rule leaves nobody to tell. It also
    // vanishes you, and that already speaks.
    "admin.staffmode",
    // Same shape: you switch your OWN developer mode, nobody else's.
    "dev.mode",
    // Logged, not spoken. Staff walk to people constantly, and moving YOURSELF
    // is not something done to the other player — mod.bring, which moves them,
    // is announced. The distinction is the same one the audience rule makes:
    // the line exists for the person it happened to.
    "mod.tpTo"
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
 * What each action SAYS: one short past-tense sentence, written the way the
 * game's own operator feedback reads — "Set Alex's game mode to Creative" —
 * rather than a description of the machinery underneath.
 *
 * This replaced a single generic template, "X used <verb> on Y", filled in from
 * the log's dotted action name. Building every sentence out of one shape made
 * all of them longer than the fact they carried, and some of them false: vanish
 * is something you do, not something you do TO a person, so a staff member
 * hiding produced "Admin used vanish on Admin". The detail string is left out
 * on purpose — reasons and durations belong in the log, which is where staff
 * read them; anyone who wants them in chat can add {DETAIL} to format.command.
 */
const PHRASES = {
    "mod.ban": t => `Banned ${t}`,
    "mod.unban": t => `Unbanned ${t}`,
    "mod.kick": t => `Kicked ${t}`,
    "mod.mute": t => `Muted ${t}`,
    "mod.unmute": t => `Unmuted ${t}`,
    "mod.warn": t => `Warned ${t}`,
    "mod.unwarn": t => `Took a warning off ${t}`,
    "troll.smite": t => `Smote ${t}`,
    "mod.freeze": t => `Froze ${t}`,
    "mod.unfreeze": t => `Unfroze ${t}`,
    "mod.tpaClose": t => `Closed ${t}'s TPA`,
    "mod.tpaOpen": t => `Opened ${t}'s TPA`,
    "mod.invsee": t => `Opened ${t}'s inventory`,
    "mod.gamemode": (t, d) => `Set ${t}'s game mode to ${d}`,
    "mod.bring": t => `Brought ${t}`,
    "name.set": (t, d) => `Renamed ${t} to ${d}`,
    "name.clear": t => `Cleared ${t}'s display name`,
    "rank.grant": (t, d) => `Gave ${t} ${d}`,
    "rank.revoke": (t, d) => `Took ${d} from ${t}`,
    "rank.set": (t, d) => `Set ${t} to ${d}`,
    // The one line that names the tool rather than the effect. Sudo's whole
    // point is that the room cannot tell it happened, so the sentence the few
    // people cleared to read it get has to say outright what it was.
    "player.sudo": t => `Used sudo on ${t}`
}

/**
 * Acting on yourself, where naming yourself twice would read badly.
 *
 * The game says "Set own game mode to Creative" for exactly this case, and a
 * staff member flipping their own mode is the commonest line this system will
 * ever print — worth the four lines it costs to have it read right.
 */
const SELF_PHRASES = {
    "mod.gamemode": (_t, d) => `Set own game mode to ${d}`
}

/** The sentence, without the surrounding format. */
export function phraseFor(action, targetName, detail, self) {
    const build = (self && SELF_PHRASES[action]) || PHRASES[action]
    if (build) return build(targetName, String(detail ?? ""))
    return `Used ${verbOf(action)} on ${targetName}`
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

/**
 * Build the line without sending it.
 *
 * {COMMAND} is still filled in even though the shipped format no longer uses
 * it: a world that customised format.command before this change has that older
 * string stored, and dropping the token would leave it printing "{COMMAND}".
 */
export function lineFor(actor, target, action, detail) {
    const name = displayName(target)
    const self = !!(actor && target && actor.id && actor.id === target.id)
    return render("format.command", {
        NAME: displayName(actor),
        ACTION: phraseFor(action, name, detail, self),
        COMMAND: verbOf(action),
        TARGET: name,
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

export { NARROW, SILENT, PHRASES }
