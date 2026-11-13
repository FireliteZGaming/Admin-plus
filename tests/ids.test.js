import { __test } from "@minecraft/server"
import { onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { fileReport, pendingReports } from "../Admin+ BP/scripts/core/reports.js"
import { addWarning, warningsFor, removeWarning } from "../Admin+ BP/scripts/core/warnings.js"

// IDs never collide. Reports and warnings used to take the millisecond plus a
// random number from 0 to 1295, so two made in the same millisecond could get
// the same id: a report then overwrote another, and taking back one warning
// removed both. Found 2026-11-12 when reports.test.js failed once in a while.
//
// The clock and the dice are both frozen here, which made the old ids collide
// every time, so this test fails on the old code rather than one run in 400.

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
        id: `i${nextId++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [...tags], addTag: t => { tags.add(t); return true }, removeTag: t => tags.delete(t),
        sendMessage: () => {}
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const target = fakePlayer("Target")
const reporters = [fakePlayer("A"), fakePlayer("B"), fakePlayer("C")]
const staff = fakePlayer("Staff")

const realNow = Date.now, realRandom = Math.random
Date.now = () => 1800000000000
Math.random = () => 0.5

console.log("\n— three reports in the same millisecond —")
const filed = reporters.map(reporter => fileReport(reporter, target, "griefing"))
check("all three were taken", filed.map(r => r.ok), [true, true, true])
check("with three different ids", new Set(filed.map(r => r.report.id)).size, 3)
check("and all three are still waiting", pendingReports().length, 3)

console.log("\n— two warnings in the same millisecond —")
const first = addWarning(staff, target, "spam")
const second = addWarning(staff, target, "spam again")
check("they get different ids", first.entry.id === second.entry.id, false)
removeWarning(target, first.entry.id)
check("taking one back leaves the other",
    warningsFor(target).map(w => w.reason), ["spam again"])

Date.now = realNow
Math.random = realRandom

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
