import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
import {
    WARN_REASONS, addWarning, removeWarning, clearWarnings,
    warningsFor, warningCount, getWarning, warnedPlayers, warningLine,
    warningLive, warningHistory
} from "../Admin+ BP/scripts/core/warnings.js"

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
        id: `w${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        heard: [],
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: text => p.heard.push(text)
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const mod = fakePlayer("Mod"); setRanks(mod.id, ["mod"], mod.name)
const member = fakePlayer("Member"); setRanks(member.id, ["member"], member.name)

console.log("\n— adding one —")
const first = addWarning(mod, member, "Spam: said the same thing nine times", "watch this one")
check("it takes", first.ok, true)
check("and reports the running total", first.total, 1)
check("which is what makes the feature worth having", warningCount(member), 1)
check("the reason is kept", warningsFor(member)[0].reason, "Spam: said the same thing nine times")
check("and who gave it", warningsFor(member)[0].by, "Mod")
check("the staff note rides along", warningsFor(member)[0].note, "watch this one")

console.log("\n— what it refuses —")
check("a warning needs a reason", addWarning(mod, member, "   ").ok, false)
check("and a reason it can print", addWarning(mod, member, "").reason, "A warning needs a reason.")
check("you cannot warn yourself", addWarning(mod, mod, "testing").ok, false)
check("none of those left a mark", warningCount(member), 1)

console.log("\n— counting, which is the whole point —")
addWarning(mod, member, "Chat behaviour: told to stop and did not")
addWarning(mod, member, "Griefing: broke a door")
check("they stack", warningCount(member), 3)
check("newest first", warningsFor(member)[0].reason.startsWith("Griefing"), true)
check("the info line summarises", warningLine(member).includes("3"), true)
check("and names the last one", warningLine(member).includes("Griefing"), true)
check("someone with none reads clean", warningLine(mod), "§7none")

console.log("\n— taking one back —")
const target = warningsFor(member)[1]
const gone = removeWarning(member, target.id)
check("it returns what it removed", gone.reason, target.reason)
check("the count drops", warningCount(member), 2)
check("and it is really gone", getWarning(member, target.id), undefined)
check("removing it twice is not an error", removeWarning(member, target.id), undefined)
check("and did not damage the rest", warningCount(member), 2)

console.log("\n— the staff overview —")
check("warned players are listed", warnedPlayers().map(p => p.name), ["Member"])
check("with their counts", warnedPlayers()[0].count, 2)
check("clearing returns how many went", clearWarnings(member), 2)
check("and leaves nothing", warningCount(member), 0)
check("so they drop off the list", warnedPlayers().length, 0)

console.log("\n— the reason list —")
// The dropdown has to end in Other, because the box under it is what carries
// the detail and a fixed list can never cover everything.
check("Other is offered", WARN_REASONS.includes("Other"), true)
check("and it is last", WARN_REASONS[WARN_REASONS.length - 1], "Other")
check("there are enough of them to be useful", WARN_REASONS.length > 4, true)

console.log("\n— the nodes —")
// Warning is a moderation act; reading your own record is not.
const nodes = Object.values(PERMISSION_NODES).flat()
check("admin.warn is declared", nodes.includes("admin.warn"), true)
check("and sits with moderation", PERMISSION_NODES.Moderation.includes("admin.warn"), true)
check("a Mod may warn", has(mod, "admin.warn"), true)
check("a Member may not", has(member, "admin.warn"), false)

// There is deliberately NO node for reading your own record. A world stores its
// rank table, so a node added in an update reaches nobody already running until
// somebody re-applies the ladder — which for the one command aimed at ordinary
// players would mean /warnings refusing them on every existing world.
check("no node gates reading your own warnings",
    nodes.includes("warn.view"), false)
check("and none is granted either",
    JSON.stringify(PERMISSION_NODES).includes("warn."), false)


console.log("\n— warnings expire, unless somebody meant them to stick —")
// A warning is a nudge with a memory, not a mark for life. Somebody told off
// for spamming on Tuesday should not still be one step from a ban on Friday —
// nothing enforces good behaviour like knowing the slate genuinely clears.
{
    const HOUR = 3600000
    const subject = { id: "warn-exp", name: "Expiry" }
    clearWarnings(subject.id)
    setSetting("warnings.expire", "48")

    const staff = { id: "warn-staff", name: "Staff" }
    addWarning(staff, subject, "Ordinary nudge")
    check("a fresh warning counts", warningsFor(subject).length, 1)

    const now = Date.now()
    check("it still counts at 47 hours", warningsFor(subject, now + 47 * HOUR).length, 1)
    check("and stops at 49", warningsFor(subject, now + 49 * HOUR).length, 0)

    // The flag exists precisely so the things worth remembering past the week
    // are the ones somebody chose to mark.
    addWarning(staff, subject, "Serious thing", "", { severe: true })
    check("a severe one is still there at 49 hours",
        warningsFor(subject, now + 49 * HOUR).map(w => w.reason), ["Serious thing"])
    check("and at a year", warningsFor(subject, now + 8760 * HOUR).length, 1)

    // "Clean now" and "never warned" are different facts, and only one of them
    // is reassuring — so staff can still see the whole thing.
    check("history keeps the expired ones", warningHistory(subject).length, 2)

    // 0 is a server that wants a permanent record.
    setSetting("warnings.expire", "0")
    check("expiry off keeps everything", warningsFor(subject, now + 8760 * HOUR).length, 2)
    setSetting("warnings.expire", "48")

    // An entry written before severity existed carries no flag, so it expires
    // like an ordinary one — the forgiving reading, and the right default for
    // something nobody marked.
    check("an unmarked old entry expires rather than sticking",
        warningLive({ at: now - 100 * HOUR, reason: "old" }, now), false)

    clearWarnings(subject.id)
    resetSetting("warnings.expire")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
