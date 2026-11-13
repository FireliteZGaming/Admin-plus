import { world, system } from "@minecraft/server"
import { has, canActOn, canSeeActionsOf } from "./ranks.js"
import { render, flag } from "./settings.js"
import { displayName, nameTokens } from "./identity.js"

// "[Admin: Kicked Member]" — said in chat, to the people entitled to know.
//
// This hangs off record() in core/logs.js rather than off each command, which
// means it cannot drift: every staff action already writes a log entry, so
// every staff action gets its line, and a command added later is covered the
// day it starts logging. The panel's Kick button and /kick produce the same
// sentence, because they are the same act.
//
// WHO SEES IT is the whole design, and it is TWO rank lines, not one.
//
//   above the TARGET     who is entitled to know what was done to this person.
//                        So the person it happened to never reads it, and
//                        neither does anyone below them.
//   not below the ACTOR  you do not get to watch your seniors work.
//
// Only the first line existed at first, and the missing second one leaked:
// a moderator sat reading an operator opening a third player's ender chest,
// because the moderator did outrank that third player and nothing anywhere
// looked at who was doing it. Reported from a live world.
//
// The two lines are deliberately different strengths. ACTING on somebody needs
// rank strictly above them, so two peers cannot punish each other. SEEING an
// action only needs to be level, because peers reviewing each other's
// moderation is the entire point of having an audit trail.
//
// The honest consequence, and it is a real one: the top of the ladder answers
// to nobody. An owner acting on a moderator is announced to no one at all,
// because every remaining candidate is below them. The action is still written
// to the LOG — this rule governs the chat line, not the record.

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
    // Claiming and giving up ground is done to the LAND, not to a person —
    // there is no target for the audience rule to tell. It is also something
    // ordinary players do constantly on a survival server, so announcing it
    // would turn staff chat into a land registry. Logged, not spoken.
    "claim.created",
    "claim.removed",
    "mod.invsee.take",          // the invsee OPEN is the event; per-item is spam
    "mod.invsee.destroy",
    "mod.enderchest.take",      // same rule for the ender chest screen
    "admin.vanish",             // vanish tells staff itself, in its own words
    "admin.unvanish",
    // Staff mode is done to yourself, not to anybody — the actor and the target
    // are the same person, so the audience rule leaves nobody to tell. It also
    // vanishes you, and that already speaks.
    "admin.staffmode",
    // Same shape: you switch your OWN developer mode, nobody else's.
    "dev.mode",
    // Taking an item from /items is done to yourself. Logged so there is a
    // record of who armed themselves; nobody else needs a chat line about it.
    "admin.items",
    // The Knockback stick is a repeatable physical prank — announcing every hit
    // would flood staff chat. Logged, not spoken.
    "admin.knockback",
    // Logged, not spoken. Staff walk to people constantly, and moving YOURSELF
    // is not something done to the other player — mod.bring, which moves them,
    // is announced. The distinction is the same one the audience rule makes:
    // the line exists for the person it happened to.
    "mod.tpTo",
    // **The held-chat decisions, and this one is load-bearing rather than
    // tidy.** The screen's whole design is that the sender is never told their
    // message was withheld — a troll who cannot see which words were stopped
    // has nothing to iterate against. An audit line saying "X denied your
    // message" would hand them exactly that, and undo the feature from inside.
    // Approving is the same: the message simply appears, as if it always had.
    "chat.approve",
    "chat.deny",
    "chat.denyAll"
])

/** Actions whose stripped name would read badly. */
const VERBS = {
    "rank.grant": "grant rank",
    "rank.revoke": "revoke rank",
    "rank.set": "set ranks",
    "mod.tpaClose": "close TPA",
    "mod.tpaOpen": "open TPA",
    "mod.invsee": "invsee",
    "mod.enderchest": "enderchest",
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
    "mod.enderchest": t => `Opened ${t}'s ender chest`,
    "mod.gamemode": (t, d) => `Set ${t}'s game mode to ${d}`,
    "mod.bring": t => `Brought ${t}`,
    // Same letters, new colour or style: "Renamed Midnight to Midnight" read
    // as nonsense in a playtest (2026-11-12), so say what changed. And the old
    // name, when they had one (2.11.6, the user: "it still doesn't show the
    // previous name then changed to new one"). `p` is the display name before.
    "name.set": (t, d, p) => {
        if (sameLetters(p || t, d)) return `Changed the look of ${t}'s name`
        return hadOwnName(p, t) ? `Renamed ${t} from ${plainName(p)} to ${plainName(d)}` : `Renamed ${t} to ${plainName(d)}`
    },
    "name.clear": (t, _d, p) => hadOwnName(p, t) ? `Cleared ${t}'s display name (was ${plainName(p)})` : `Cleared ${t}'s display name`,
    "rank.grant": (t, d) => `Gave ${t} ${d}`,
    "rank.revoke": (t, d) => `Took ${d} from ${t}`,
    "rank.set": (t, d) => `Set ${t} to ${d}`,
    // The one line that names the tool rather than the effect. Sudo's whole
    // point is that the room cannot tell it happened, so the sentence the few
    // people cleared to read it get has to say outright what it was.
    "player.sudo": t => `Used sudo on ${t}`,
    // An automation (2.10.0) acting on a player. The actor reads
    // 'Automation "Name"', so staff see which one did it.
    "automation.rank": (t, d) => {
        const rank = String(d ?? "").replace(/^(gave|took) /, "").replace(/ for a while$/, "")
        return String(d ?? "").startsWith("took") ? `Took ${rank} from ${t}` : `Gave ${t} ${rank}`
    },
    "automation.cancel": t => `Stopped a message from ${t}`,
    "automation.replace": t => `Changed a message from ${t}`
}

/**
 * Acting on yourself, where naming yourself twice would read badly.
 *
 * The game says "Set own game mode to Creative" for exactly this case, and a
 * staff member flipping their own mode is the commonest line this system will
 * ever print — worth the four lines it costs to have it read right.
 */
const SELF_PHRASES = {
    "mod.gamemode": (_t, d) => `Set own game mode to ${d}`,
    "name.set": (t, d, p) => {
        if (sameLetters(p || t, d)) return "Changed the look of own name"
        return hadOwnName(p, t) ? `Changed own display name from ${plainName(p)} to ${plainName(d)}` : `Changed own display name to ${plainName(d)}`
    },
    "name.clear": (t, _d, p) => hadOwnName(p, t) ? `Cleared own display name (was ${plainName(p)})` : "Cleared own display name"
}

/** A name with its colour codes taken out, so it can't recolour the rest of a staff line. */
const plainName = name => String(name ?? "").replace(/§./g, "").trim()

/** Did they go by a display name of their own before, not just their gamertag in a colour? */
const hadOwnName = (previous, gamertag) => !!plainName(previous) && !sameLetters(previous, gamertag)

/**
 * True when a new display name has the same letters as the name it replaces,
 * so only its colour, bold or italic changed. Fonts are stored apart from the
 * display name, so they never reach here.
 */
export function sameLetters(before, after) {
    const plain = s => String(s ?? "").replace(/§./g, "").trim()
    return plain(before) !== "" && plain(before) === plain(after)
}

/**
 * The sentence, without the surrounding format. `previous` is the display name
 * a name change replaced, if they had one.
 */
export function phraseFor(action, targetName, detail, self, previous = "") {
    const build = (self && SELF_PHRASES[action]) || PHRASES[action]
    if (build) return build(targetName, String(detail ?? ""), String(previous ?? ""))
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
        // ...and must not be outranked by the ACTOR. This half was missing, so
        // a moderator saw an operator open a third player's ender chest: the
        // only rank check was against the target, and a moderator does outrank
        // an ordinary player. You watch your peers and the people under you.
        if (!canSeeActionsOf(viewer, actor)) continue
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
export function lineFor(actor, target, action, detail, extra = {}) {
    // A display-name change is recorded AFTER it is made, so the target's
    // display name is already the new one, and every rename read "Renamed
    // Midnight to Midnight" (seen in a playtest, 2026-11-12). Name them by
    // their gamertag instead, which a rename never changes.
    const naming = String(action).startsWith("name.")
    const name = naming && target?.name ? target.name : displayName(target)
    const self = !!(actor && target && actor.id && actor.id === target.id)
    // Someone renaming themselves showed up under the NEW name, as in
    // "[Firelie: Changed own display name to Firelie]" (2.11.5 playtest), so
    // nobody could tell who it was. In a name change the actor is named by
    // gamertag too: a new name can't hide who chose it.
    const actorTokens = nameTokens(actor)
    if (naming && actor?.name) actorTokens.NICKNAME = actor.name
    return render("format.command", {
        ...actorTokens,
        ACTION: phraseFor(action, name, detail, self, naming ? extra?.previous : ""),
        COMMAND: verbOf(action),
        TARGET: name,
        DETAIL: String(detail ?? "")
    })
}

/**
 * Announce one staff action. Called from record(); nothing else should need to.
 * @returns {number} how many people were told
 */
export function announce(actor, action, target, detail, extra) {
    const audience = audienceFor(actor, target, action)
    if (!audience.length) return 0

    const line = lineFor(actor, target, action, detail, extra)
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
