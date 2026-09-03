import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { audienceFor, lineFor, verbOf, announce, SILENT } from "../Admin+ BP/scripts/core/audit.js"

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
const member = fakePlayer("Member"); setRanks(member.id, ["member"], member.name)

const names = list => list.map(p => p.name).sort()

console.log("\n— the sentence —")
check("it reads as an action, not an outcome",
    lineFor(admin, member, "mod.kick", "spam").replace(/§./g, ""),
    "Admin used kick on Member")
check("sudo says sudo",
    lineFor(admin, member, "player.sudo", "hi").replace(/§./g, ""),
    "Admin used sudo on Member")
check("the log branch prefix is not read out", verbOf("mod.ban"), "ban")
check("awkward ones are spelled properly", verbOf("rank.grant"), "grant rank")
check("and TPA reads as TPA", verbOf("mod.tpaClose"), "close TPA")
check("an unknown action still says something", verbOf("weird.thing"), "thing")

console.log("\n— who hears an ordinary action —")
// Staff above the TARGET. Measured against the person it happened to, because
// the question is who is entitled to know what was done to them.
check("kicking a member reaches every staff member above them",
    names(audienceFor(admin, member, "mod.kick")), ["Admin2", "Mod", "Owner"])
check("never the member it happened to",
    names(audienceFor(admin, member, "mod.kick")).includes("Member"), false)
check("never the one who did it",
    names(audienceFor(admin, member, "mod.kick")).includes("Admin"), false)

console.log("\n— the rank line is measured against the target —")
check("acting on a Mod is not visible to that Mod",
    names(audienceFor(owner, mod, "mod.kick")), ["Admin", "Admin2"])
check("and a Member below them hears nothing either",
    names(audienceFor(owner, mod, "mod.kick")).includes("Member"), false)

console.log("\n— sudo is narrower than everything else —")
// A Mod outranks a Member and would normally hear about a kick. Sudo is the
// exception: anyone who learns of it can simply tell the target, which ends the
// command's usefulness, so it is limited to people who hold admin.sudo.
check("the Mod hears about a kick", names(audienceFor(admin, member, "mod.kick")).includes("Mod"), true)
check("but not about a sudo", names(audienceFor(admin, member, "player.sudo")).includes("Mod"), false)
check("holders of admin.sudo do", names(audienceFor(admin, member, "player.sudo")), ["Admin2", "Owner"])
check("mod genuinely lacks the node", has(mod, "admin.sudo"), false)

console.log("\n— things that are never announced —")
check("a report does not double-announce", audienceFor(member, mod, "report.filed"), [])
check("nor each item taken during an invsee", audienceFor(admin, member, "mod.invsee.take"), [])
check("but opening the inventory does",
    names(audienceFor(admin, member, "mod.invsee")).length > 0, true)
check("the silent list is exactly those four", SILENT.size, 4)

console.log("\n— actions with nobody on one end —")
check("no actor, no line", audienceFor(undefined, member, "automod.ore"), [])
check("no target, no line", audienceFor(admin, undefined, "config.edit"), [])

console.log("\n— it actually sends —")
for (const p of [owner, admin, admin2, mod, member]) p.heard.length = 0
const told = announce(admin, "mod.kick", member, "spam")
check("it reports how many it told", told, 3)
check("and the message really arrived",
    names([owner, admin2, mod].filter(p => p.heard.length === 1)), ["Admin2", "Mod", "Owner"])
check("the member got nothing", member.heard.length, 0)
check("the actor got nothing from this path", admin.heard.length, 0)

console.log("\n— the switch —")
setSetting("audit.announce", "false")
check("off means nobody", audienceFor(admin, member, "mod.kick"), [])
resetSetting("audit.announce")
check("back on again", names(audienceFor(admin, member, "mod.kick")).length, 3)
check("it ships on", setting("audit.announce"), "true")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
