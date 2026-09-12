import { readdirSync, readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { audienceFor, lineFor, phraseFor, verbOf, announce, SILENT, PHRASES } from "../Admin+ BP/scripts/core/audit.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `a${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        heard: [],
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: (text) => p.heard.push(text),
        runCommand: () => ({ successCount: 1 })
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

// Server ladder: Owner > Co-Owner > Developer > Admin > Mod > Member.
const owner = fakePlayer("Owner");   setRanks(owner.id, ["owner"], owner.name)
const admin = fakePlayer("Admin");   setRanks(admin.id, ["admin"], admin.name)
const admin2 = fakePlayer("Admin2"); setRanks(admin2.id, ["admin"], admin2.name)
const mod = fakePlayer("Mod");       setRanks(mod.id, ["mod"], mod.name)
const mod2 = fakePlayer("Mod2");     setRanks(mod2.id, ["mod"], mod2.name)
const member = fakePlayer("Member"); setRanks(member.id, ["member"], member.name)

const names = list => list.map(p => p.name).sort()

console.log("\n— the sentence —")
// One short past-tense line, shaped like the game's own operator feedback. The
// reason and the duration deliberately do not appear — those live in the log.
const plain = (a, t, act, d) => lineFor(a, t, act, d).replace(/§./g, "")
check("it reads the way op feedback reads",
    plain(admin, member, "mod.kick", "spam"), "[Admin: Kicked Member]")
check("the detail stays out of chat",
    plain(admin, member, "mod.ban", "griefing").includes("griefing"), false)
check("a game mode change names the mode",
    plain(admin, member, "mod.gamemode", "Creative"),
    "[Admin: Set Member's game mode to Creative]")
check("sudo still says sudo outright",
    plain(admin, member, "player.sudo", "hi"), "[Admin: Used sudo on Member]")
check("a rank grant says what was given",
    plain(admin, member, "rank.grant", "mod"), "[Admin: Gave Member mod]")

// Nothing may quietly fall back to the generic shape this replaced. The only
// sentence left containing "used" is sudo's, which is written that way on
// purpose; every other one has to be a real verb with a real object.
const ACTIONS = ["mod.ban", "mod.unban", "mod.kick", "mod.mute", "mod.unmute",
    "mod.freeze", "mod.unfreeze", "mod.tpaClose", "mod.tpaOpen", "mod.invsee",
    "mod.gamemode", "name.set", "name.clear", "rank.grant", "rank.revoke", "rank.set"]
check("none of them fall back to the generic shape",
    ACTIONS.filter(a => phraseFor(a, "Member", "d").includes("used")), [])
check("every one of them names the target",
    ACTIONS.filter(a => !phraseFor(a, "Member", "d").includes("Member")), [])
check("an action nobody wrote a sentence for still says something",
    phraseFor("weird.thing", "Member"), "Used thing on Member")

check("the log branch prefix is not read out", verbOf("mod.ban"), "ban")
check("awkward ones are spelled properly", verbOf("rank.grant"), "grant rank")
check("and TPA reads as TPA", verbOf("mod.tpaClose"), "close TPA")
check("an unknown action still says something", verbOf("weird.thing"), "thing")

// A world that customised this line before the tokens changed keeps working.
setSetting("format.command", "§7{NAME} used {COMMAND} on {TARGET}")
check("an old stored format still renders",
    plain(admin, member, "mod.kick", "spam"), "Admin used kick on Member")
resetSetting("format.command")

console.log("\n— who hears an ordinary action —")
// TWO rank lines have to pass, not one.
//   above the TARGET  — who is entitled to know what was done to this person
//   not below the ACTOR — you do not get to watch your seniors work
// Only the first existed for a long time, and the second is the fix: a
// moderator was reading an operator opening a third player's ender chest,
// because the moderator did outrank that third player and nothing ever looked
// at who was doing it.
check("an Admin kicking a Member reaches their peers and up",
    names(audienceFor(admin, member, "mod.kick")), ["Admin2", "Owner"])
check("but NOT the Mod, who is below the one who did it",
    names(audienceFor(admin, member, "mod.kick")).includes("Mod"), false)
check("never the member it happened to",
    names(audienceFor(admin, member, "mod.kick")).includes("Member"), false)
check("never the one who did it",
    names(audienceFor(admin, member, "mod.kick")).includes("Admin"), false)

console.log("\n— peers watch each other, which is the point of an audit trail —")
// Seeing needs LEVEL, acting needs strictly above. Two mods cannot punish each
// other, and that is deliberate; they can still both see a kick either of them
// makes, which is what stops the rule from hiding staff from their own equals.
check("one Mod's kick is visible to the other Mod",
    names(audienceFor(mod, member, "mod.kick")).includes("Mod2"), true)
check("and to everybody above them",
    names(audienceFor(mod, member, "mod.kick")), ["Admin", "Admin2", "Mod2", "Owner"])

console.log("\n— the top of the ladder answers to nobody —")
// The honest consequence of "equal and below", and worth pinning so it is a
// decision rather than a surprise: an Owner acting on a Mod is announced to
// NOBODY. Every remaining candidate is below the Owner. The action is still
// written to the log — this rule governs the chat line, not the record.
check("an Owner acting on a Mod is announced to nobody",
    names(audienceFor(owner, mod, "mod.kick")), [])
check("and the Mod it happened to still never hears it",
    names(audienceFor(owner, mod, "mod.kick")).includes("Mod"), false)

console.log("\n— sudo is narrower than everything else —")
// A Mod2 is level with Mod and outranks a Member, so it would normally hear
// about a kick. Sudo is the exception: anyone who learns of it can simply tell
// the target, which ends the command's usefulness, so it is limited to holders
// of admin.troll.
//
// It used to have its own admin.sudo node. That was a second switch guarding a
// distinction nobody asked for — "hand out troll tools but not this one" — so
// it went, and sudo answers to the node that gates every other prank.
//
// No shipped preset grants admin.troll, so out of the box this reaches owners
// and operators only. That is the same protection the old world-level
// feature.troll switch gave, expressed once and in the place people already go
// to decide who may do what.
check("the Mod hears about a kick", names(audienceFor(mod, member, "mod.kick")).includes("Mod2"), true)
check("but not about a sudo", names(audienceFor(admin, member, "player.sudo")).includes("Mod"), false)
check("and by default only an owner does", names(audienceFor(admin, member, "player.sudo")), ["Owner"])
check("mod genuinely lacks the node", has(mod, "admin.troll"), false)
check("and so does an admin, until somebody grants it", has(admin, "admin.troll"), false)

console.log("\n— things that are never announced —")
check("a report does not double-announce", audienceFor(member, mod, "report.filed"), [])
check("nor each item taken during an invsee", audienceFor(admin, member, "mod.invsee.take"), [])
check("but opening the inventory does",
    names(audienceFor(admin, member, "mod.invsee")).length > 0, true)
// Vanish is on that list. features/vanish.js already tells staff in its own
// words, so announcing it here said the same event twice — the second time as
// "used vanish on" somebody who had only hidden themselves.
check("vanish is not announced twice", audienceFor(admin, member, "admin.vanish"), [])
check("walking to someone is silent too", audienceFor(admin, member, "mod.tpTo"), [])
// Staff mode is done to yourself. The actor and the target are one person, so
// there is nobody the audience rule would tell even if it were not on the list.
check("entering staff mode is silent", audienceFor(admin, admin, "admin.staffmode"), [])
check("switching your own developer mode is silent",
    audienceFor(admin, admin, "dev.mode"), [])
check("taking an admin item is silent", audienceFor(admin, admin, "admin.items"), [])
check("a knockback hit is silent", audienceFor(admin, member, "admin.knockback"), [])
check("nor each item taken out of an ender chest",
    audienceFor(admin, member, "mod.enderchest.take"), [])
check("but opening someone's ender chest IS announced",
    names(audienceFor(admin, member, "mod.enderchest")).length > 0, true)
check("the silent list is exactly those twelve", SILENT.size, 12)

console.log("\n— actions with nobody on one end —")
check("no actor, no line", audienceFor(undefined, member, "automod.ore"), [])
check("no target, no line", audienceFor(admin, undefined, "config.edit"), [])

console.log("\n— it actually sends —")
for (const p of [owner, admin, admin2, mod, mod2, member]) p.heard.length = 0
const told = announce(admin, "mod.kick", member, "spam")
check("it reports how many it told", told, 2)
check("and the message really arrived",
    names([owner, admin2].filter(p => p.heard.length === 1)), ["Admin2", "Owner"])
check("the member got nothing", member.heard.length, 0)
check("the actor got nothing from this path", admin.heard.length, 0)
check("and neither Mod heard it, being below the Admin who acted",
    mod.heard.length + mod2.heard.length, 0)

console.log("\n— the switch —")
setSetting("audit.announce", "false")
check("off means nobody", audienceFor(admin, member, "mod.kick"), [])
resetSetting("audit.announce")
check("back on again", names(audienceFor(admin, member, "mod.kick")).length, 2)
check("it ships on", setting("audit.announce"), "true")

console.log("\n— every recorded action has been given words —")
// The inventory. record() is the only door into both the log and chat, so
// scanning for its calls finds every staff action there is — including the ones
// added by whoever reads this next. Each has to be accounted for: it either has
// a sentence, is deliberately silent, or has nobody on one end for a sentence
// to be about. A new action that is none of those fails here rather than
// shipping as "Used thing on Steve".
//
// This is how the command forms of /mute, /unmute, /unban and /gm were found:
// they changed a player and told the log nothing, so the panel button was
// audited and the command that did the same thing was not.
function scriptFiles(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) out.push(...scriptFiles(full))
        else if (entry.name.endsWith(".js")) out.push(full)
    }
    return out
}

const RECORDED = new Set()
for (const file of scriptFiles("Admin+ BP/scripts")) {
    const src = readFileSync(file, "utf8")
    // The action is the second argument, so read from each record( to the third
    // comma. A ternary between two action names lives inside that window and is
    // picked up by the string scan; a detail string never is.
    // A fixed window rather than a match to the closing paren: the tpa call
    // carries an options object, so the first ")" is well past the argument
    // that matters and the lazy form gave up before reaching it.
    for (const call of src.matchAll(/\brecord\(([\s\S]{0,200})/g)) {
        const head = call[1].split(",").slice(0, 2).join(",")
        for (const lit of head.matchAll(/"([a-z][a-z0-9]*\.[a-zA-Z][\w.]*)"/g)) RECORDED.add(lit[1])
    }
}

// Actions with nobody on one end: audienceFor() returns [] for these whatever
// they are called, because there is no actor (automod fires itself) or no
// target (a warp is not a person). They are log entries only.
const NO_AUDIENCE = new Set([
    "automod.ore", "automod.breaks", "automod.spam", "automod.config",
    "admin.clearchat", "admin.lagclear", "chat.broadcast", "dev.banhammer",
    // Taking a barrier out of the panel is done to the world, not to a person.
    // It is logged so there is a record of who has them.
    "admin.opblock",
    // /cmd has no target either — but it is the one entry here that MUST stay
    // logged, because being able to run vanilla commands without op is exactly
    // the power an operator has invisibly. The log is the difference.
    "admin.cmd",
    // The Creator/Dev console tells online owners itself, by name and with the
    // command, at the moment it runs — a second audit announcement would be the
    // same news twice. The log entry stays as the durable record.
    "creator.console",
    // Shutting the door is done to the WORLD, not to a person — everyone who
    // gets turned away is told why at the moment it happens, which is a better
    // channel than a staff line about somebody who is no longer here.
    "admin.guestOn", "admin.guestOff", "admin.guestAdd", "admin.guestRemove",
    "admin.maintenanceOn", "admin.maintenanceOff",
    // Muting a channel is announced to EVERYONE, by name, from
    // features/chatcommands.js — the opposite of the audit line's audience, and
    // deliberately so: chat going quiet with no explanation reads as a broken
    // server. The log entry is the record; the announcement is the courtesy.
    "chat.mute", "chat.unmute",
    "config.edit", "config.preset", "config.presetSave", "config.reset",
    "config.serverPreset",
    "hologram.create", "hologram.edit", "hologram.move", "hologram.delete", "hologram.clear",
    "rank.delete", "rank.preset",
    "warp.create", "warp.move", "warp.delete", "warp.access", "warp.spawnSet", "warp.spawnEdit"
])

check("the scan actually found the actions", RECORDED.size > 25, true)
// Asked of the map, not of the rendered string. Sudo's own sentence happens to
// be spelled the same as the fallback, so comparing text would have called the
// one deliberate "Used X on Y" a mistake.
const unspoken = [...RECORDED].filter(a =>
    !SILENT.has(a) && !NO_AUDIENCE.has(a) && !(a in PHRASES))
check("nothing announced falls back to the generic sentence", unspoken, [])
check("and no sentence was written for an action nobody records",
    Object.keys(PHRASES).filter(a => !RECORDED.has(a)), [])

// The op-style commands specifically. Each of these changes a player, and each
// has both a panel button and a command; both go through record().
for (const action of ["mod.kick", "mod.ban", "mod.unban", "mod.mute", "mod.unmute",
    "mod.freeze", "mod.gamemode", "mod.bring", "mod.invsee", "player.sudo"]) {
    check(`${action} is recorded somewhere`, RECORDED.has(action), true)
}

console.log("\n— acting on yourself —")
// What the game itself prints: "Set own game mode to Creative".
check("changing your own mode does not name you twice",
    phraseFor("mod.gamemode", "Admin", "Creative", true), "Set own game mode to Creative")
check("changing someone else's still names them",
    phraseFor("mod.gamemode", "Member", "Creative", false), "Set Member's game mode to Creative")
check("and lineFor works out which it is",
    lineFor(admin, admin, "mod.gamemode", "Creative").replace(/§./g, ""),
    "[Admin: Set own game mode to Creative]")
check("walking to someone is logged but not spoken",
    audienceFor(admin, member, "mod.tpTo"), [])
check("dragging them to you is spoken",
    names(audienceFor(admin, member, "mod.bring")).length > 0, true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
