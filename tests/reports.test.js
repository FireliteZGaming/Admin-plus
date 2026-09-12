import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import {
    fileReport, pendingReports, handledReports, getReport,
    markRead, isUnreadBy, unreadCount, handleReport, reportStaff,
    CATEGORIES, STAFF_CATEGORIES
} from "../Admin+ BP/scripts/core/reports.js"
import { readFileSync } from "node:fs"

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


console.log("\n— reporting staff is its own kind of report —")
// The other four categories are about a PLAYER and go to staff. This one is
// about STAFF and has to go over their head — which makes who can SEE it the
// whole design, not a detail.
{
    check("there is a category for staff misconduct", CATEGORIES.includes("abuse"), true)
    check("it is a bare word, because it registers as a Bedrock Enum",
        CATEGORIES.every(c => /^[a-z0-9_]+$/.test(c)), true)
    check("other stays last, so the list does not open on vagueness",
        CATEGORIES.at(-1), "other")
    check("and it is marked as accusing staff", STAFF_CATEGORIES.has("abuse"), true)

    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/reports.js", import.meta.url), "utf8")
    // "Abuse" alone does not tell a member this is where you report a STAFF
    // member; somebody who does not know that files it under Other, and it
    // reads as a complaint about a player.
    check("the picker spells out what it is for", src.includes("Staff abuse"), true)
    check("every category has text written for it",
        CATEGORIES.filter(c => !new RegExp(`${c}:\\s*"`).test(src)), [])
}

console.log("\n— and the person reported never sees the report —")
// canSeeActionsOf answers TRUE when the viewer is the subject, which is right
// for reading your own audit trail and catastrophic here: the reported staff
// member would be shown the report against them, with the reporter's name on
// it. An abuse report is exactly the case where being tipped off IS the harm.
{
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/reports.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")
    check("the target is refused before the seeing rule is consulted",
        /if \(report\.target\.id === viewer\.id\) return false/.test(code), true)
    const refuse = code.indexOf("report.target.id === viewer.id")
    const see = code.indexOf("canSeeActionsOf(viewer, report.target.id)")
    check("and refused FIRST, or the seeing rule would let them through",
        refuse !== -1 && refuse < see, true)

    // Every door re-asks, including the two reachable by id — one of which is
    // where a report gets handled, which is where reading turns into acting.
    // Counted by the REFUSAL each door prints rather than by the helper name:
    // readableReports calls canSeeReport too and would count itself.
    check("both by-id doors refuse",
        (code.match(/That report is above your rank/g) ?? []).length, 2)
    check("and the alert itself filters its audience",
        /reportStaff\(\)\.filter\(member => canSeeReport\(member, report\)\)/.test(code), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
