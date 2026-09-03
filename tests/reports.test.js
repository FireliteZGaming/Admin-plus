import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import {
    fileReport, pendingReports, handledReports, getReport,
    markRead, isUnreadBy, unreadCount, handleReport, reportStaff
} from "../Admin+ BP/scripts/core/reports.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `q${nextId++}`, name, nameTag: name, inbox: [], commandPermissionLevel: 0,
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(m)
    }
    __test.players.push(p)
    return p
}
// Rewind a report so the per-reporter cooldown doesn't block the next test.
const rewind = (r, ms = 120000) => { r.at -= ms; return r }

const nova = fakePlayer("Nova")
const alex = fakePlayer("Alex")
const griefer = fakePlayer("Griefer")
const modA = fakePlayer("ModA")
const modB = fakePlayer("ModB")
for (const p of [nova, alex, griefer, modA, modB]) onPlayerJoin(p)
setRanks(modA.id, ["mod"], modA.name)
setRanks(modB.id, ["mod"], modB.name)

console.log("\n— filing —")
const first = fileReport(nova, griefer, "broke spawn", "griefing")
check("accepted", first.ok, true)
check("queued", pendingReports().length, 1)
check("records both sides", [first.report.reporter.name, first.report.target.name], ["Nova", "Griefer"])
check("staff are the ones who get told", reportStaff().map(p => p.name).sort(), ["ModA", "ModB"])
check("you cannot report yourself", fileReport(nova, nova, "oops").ok, false)

console.log("\n— abuse control —")
check("a second report too soon is refused", fileReport(nova, alex, "spam").ok, false)
check("the refusal explains the wait", fileReport(nova, alex, "spam").reason.includes("Wait"), true)
rewind(first.report)
const again = fileReport(nova, griefer, "still breaking spawn", "griefing")
check("re-reporting the same player updates rather than stacks", [again.ok, again.updated], [true, true])
check("still one report", pendingReports().length, 1)
check("with the newer reason", getReport(first.report.id).reason, "still breaking spawn")

console.log("\n— read is per viewer, and never removes it —")
const report = pendingReports()[0]
check("unread by both mods", [isUnreadBy(modA, report), isUnreadBy(modB, report)], [true, true])
check("both see one unread", [unreadCount(modA), unreadCount(modB)], [1, 1])
markRead(modA, report.id)
check("ModA has read it", isUnreadBy(modA, getReport(report.id)), false)
check("ModB has NOT", isUnreadBy(modB, getReport(report.id)), true)
check("ModA's unread count drops", unreadCount(modA), 0)
check("but the report is STILL in the queue", pendingReports().length, 1)
check("and ModB still sees it waiting", unreadCount(modB), 1)

console.log("\n— handling is what clears it for everyone —")
handleReport(modA, report.id, "action", "banned 3d")
check("queue is empty", pendingReports().length, 0)
check("gone for ModB too", unreadCount(modB), 0)
check("recorded who closed it and how", [getReport(report.id).handled.by, getReport(report.id).handled.outcome], ["ModA", "action"])
check("the note is kept", getReport(report.id).handled.note, "banned 3d")
check("it moved to the handled list", handledReports().length, 1)

console.log("\n— a second admin cannot close it twice —")
const before = getReport(report.id).handled.by
handleReport(modB, report.id, "dismissed")
check("the first outcome stands", getReport(report.id).handled.by, before)
check("and it is not reopened", pendingReports().length, 0)

console.log("\n— the pending cap —")
let filed = 0
for (const target of [alex, griefer, modB, modA]) {
    const r = fileReport(alex, target, "test")
    if (r.ok) { filed++; rewind(r.report) }
}
check("capped at three pending per reporter", filed, 3)
check("the fourth is refused, not silently dropped", fileReport(alex, nova, "test").ok, false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
