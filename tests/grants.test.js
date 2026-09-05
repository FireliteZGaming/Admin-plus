import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, applyPreset, heldRankIds, grantRank } from "../Admin+ BP/scripts/core/ranks.js"
import {
    DURATIONS, durationAt, setExpiry, clearExpiry, expiryOf,
    timedGrants, sweep, remainingLabel, __resetGrants
} from "../Admin+ BP/scripts/core/grants.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const p = {
        id: `g${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: () => {},
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const HOUR = 60 * 60 * 1000

console.log("\n— the durations offered —")
check("permanent is first, so the default answer adds no timer", DURATIONS[0].id, "permanent")
check("and permanent is zero, not a flag", DURATIONS[0].ms, 0)
check("every other option is a real length", DURATIONS.slice(1).every(d => d.ms > 0), true)
check("they only ever get longer", DURATIONS.slice(1).every((d, i, a) => i === 0 || d.ms > a[i - 1].ms), true)
check("an index off the end falls back to permanent rather than throwing",
    durationAt(999).id, "permanent")
check("so does a missing one", durationAt(undefined).id, "permanent")

console.log("\n— recording an end date —")
__resetGrants()
const alice = fakePlayer("Alice")
setRanks(alice.id, ["member"], alice.name)
grantRank(alice.id, "mod", alice.name)

check("no timer to begin with", expiryOf(alice.id, "mod"), undefined)
setExpiry(alice.id, "mod", HOUR, { id: "x", name: "Owner" })
check("a timer is recorded", typeof expiryOf(alice.id, "mod"), "number")
check("it is in the future", expiryOf(alice.id, "mod") > Date.now(), true)
check("and it says who set it", timedGrants(alice.id)[0].byName, "Owner")

// Permanent is stored as the ABSENCE of a record, so re-granting permanently
// really does stop the clock instead of leaving one behind to fire later.
setExpiry(alice.id, "mod", 0)
check("granting it permanently clears the timer", expiryOf(alice.id, "mod"), undefined)
check("and nothing is left listed", timedGrants(alice.id), [])

console.log("\n— taking it back —")
__resetGrants()
const bob = fakePlayer("Bob")
setRanks(bob.id, ["member"], bob.name)
grantRank(bob.id, "mod", bob.name)
setExpiry(bob.id, "mod", HOUR, bob)
check("Bob is a Mod", heldRankIds(bob.id).includes("mod"), true)

check("nothing expires early", sweep(Date.now()), [])
check("and he keeps it", heldRankIds(bob.id).includes("mod"), true)

const ended = sweep(Date.now() + 2 * HOUR)
check("the sweep reports what ended", ended.map(e => e.rankId), ["mod"])
check("the rank is actually gone", heldRankIds(bob.id).includes("mod"), false)
check("and the record went with it", timedGrants(bob.id), [])
check("sweeping again finds nothing to do", sweep(Date.now() + 9 * HOUR), [])

console.log("\n— a permanent rank underneath is not disturbed —")
__resetGrants()
const cara = fakePlayer("Cara")
setRanks(cara.id, ["member"], cara.name)
grantRank(cara.id, "mod", cara.name)
setExpiry(cara.id, "mod", HOUR, cara)
sweep(Date.now() + 2 * HOUR)
// Losing a timed rank drops you to whatever is left, which for anybody is at
// least the default rank — never to nothing at all.
check("she still holds something", heldRankIds(cara.id).length > 0, true)
check("and it is the default rank", heldRankIds(cara.id), ["member"])

console.log("\n— records that no longer describe anything —")
// Somebody revoking the rank by hand leaves an expiry pointing at nothing. It
// must not resurrect, error, or sit there forever.
__resetGrants()
const dan = fakePlayer("Dan")
setRanks(dan.id, ["member"], dan.name)
grantRank(dan.id, "mod", dan.name)
setExpiry(dan.id, "mod", HOUR, dan)
setRanks(dan.id, ["member"], dan.name)          // revoked by hand
check("the stale record ends nothing", sweep(Date.now() + 2 * HOUR), [])
check("and is cleaned up", timedGrants(dan.id), [])
check("he is not given the rank back", heldRankIds(dan.id).includes("mod"), false)

console.log("\n— how long is left, in words —")
const now = Date.now()
check("minutes while it is minutes", remainingLabel(now + 9 * 60000, now), "9 minutes")
check("one minute is singular", remainingLabel(now + 60000, now), "1 minute")
check("under a minute still reads as one, not zero",
    remainingLabel(now + 5000, now), "1 minute")
check("hours after that", remainingLabel(now + 5 * HOUR, now), "5 hours")
check("one hour is singular", remainingLabel(now + HOUR, now), "1 hour")
check("days past two", remainingLabel(now + 72 * HOUR, now), "3 days")
check("something already over says so", remainingLabel(now - HOUR, now), "expired")
check("and so does nothing at all", remainingLabel(undefined, now), "expired")

console.log("\n— several at once —")
__resetGrants()
const eve = fakePlayer("Eve")
setRanks(eve.id, ["member"], eve.name)
grantRank(eve.id, "mod", eve.name)
setExpiry(eve.id, "mod", 5 * HOUR, eve)
setExpiry(eve.id, "admin", 1 * HOUR, eve)
check("both are listed", timedGrants(eve.id).length, 2)
check("soonest first", timedGrants(eve.id)[0].rankId, "admin")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
