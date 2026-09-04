import { __test, world } from "@minecraft/server"
import {
    ban, banRecord, isBanned, unban, banList, banMessage, pruneExpired,
    mute, isMuted, unmute, muteRecord,
    kick, setFrozen, isFrozen, tpaClosed, setTpaClosed, statusLine,
    BAN_REASONS, BAN_MAX_DAYS, PERMANENT_NOTCH,
    banSliderMax, banLengthMs, banLengthLabel
} from "../Admin+ BP/scripts/core/moderation.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name) {
    const p = {
        id: `p${nextId++}`, name, inbox: [],
        sendMessage: m => p.inbox.push(m),
        inputPermissions: { enabled: {}, setEnabled: (cat, on) => { p.inputPermissions.enabled[cat] = on } }
    }
    __test.players.push(p)
    return p
}

const griefer = fakePlayer("Griefer")
const spammer = fakePlayer("Spammer")
const quiet = fakePlayer("Quiet")
const staff = { name: "Firelite" }

console.log("\n— bans —")
await ban(griefer, 0, "Grief", staff)
check("permanent ban sticks", isBanned(griefer), true)
check("record keeps who and why", [banRecord(griefer).reason, banRecord(griefer).by], ["Grief", "Firelite"])
check("permanent means no expiry", banRecord(griefer).until, 0)
check("it appears in the ban list", banList().map(b => b.name), ["Griefer"])
unban(griefer.id)
check("unban clears it", isBanned(griefer), false)

console.log("\n— temporary bans expire on their own —")
await ban(spammer, 60 * 1000, "Spam", staff)
check("temp ban is live now", isBanned(spammer), true)
// Rewind the expiry rather than waiting a minute.
banRecord(spammer).until = Date.now() - 1
check("an elapsed ban stops counting", isBanned(spammer), false)
pruneExpired()
check("and prune clears the record", banList().length, 0)

console.log("\n— no /kick command line is ever built —")
// The pack never assembles a "kick <name> <reason>" string. That does not make
// it safe — Player.kick reaches the same command underneath — but it does mean
// a reason containing quotes or a newline cannot break out of a command line,
// and there is no second, worse code path to maintain.
__test.commands.length = 0
await ban(griefer, 0, "Grief", staff)
check("banning somebody with no Player.kick issues no command",
    __test.commands.filter(c => String(c).startsWith("kick ")).length, 0)
check("the ban itself still stands", isBanned(griefer), true)
check("and the ban message is unaffected",
    banMessage(banRecord(griefer)).includes("\n"), true)
unban(griefer.id)

__test.commands.length = 0
check("kick() reports the failure rather than falling back",
    await kick(quiet, 'go "away" now'), false)
check("still no command was run", __test.commands.length, 0)


console.log("\n— Player.kick IS /kick, and the report must say so —")
// Do not read "no command line was built" as "a different, gentler mechanism".
// Player.kick hands back a CommandResult — the same shape runCommand returns —
// and that return type is the tell: it runs /kick underneath and inherits
// everything /kick does. What this pack controls is not the mechanism but
// whether it reports the outcome honestly.
const modern = fakePlayer("Modern")
modern.kicked = []
modern.kick = (reason) => { modern.kicked.push(reason); return true }

__test.commands.length = 0
check("it reports success", await kick(modern, "Behave\nSee you"), true)
check("the script method was used once", modern.kicked.length, 1)
check("and NO kick command was built by us", __test.commands.length, 0)
// A real newline survives, because the reason is passed as a string rather
// than pasted into a command line where a break would truncate it.
check("the reason keeps its line break, unmangled",
    modern.kicked[0].includes("\n"), true)
check("and is passed through untouched", modern.kicked[0], "Behave\nSee you")

// THE BUG THIS SUITE EXISTS FOR. A CommandResult with successCount 0 means the
// command ran and removed nobody — no throw, no rejection, just a count of
// zero. The old code returned true the moment the method existed and did not
// throw synchronously, so this case reported a successful removal while the
// player stood exactly where they were.
const refused = fakePlayer("Refused")
refused.kick = () => ({ successCount: 0 })
check("successCount 0 is a FAILURE, not a success", await kick(refused, "bye"), false)

const landed = fakePlayer("Landed")
landed.kick = () => ({ successCount: 1 })
check("successCount 1 is a success", await kick(landed, "bye"), true)

// A promise that rejects is a kick that did not happen. The old code took the
// promise, attached a rejection logger and returned true immediately.
const asyncKick = fakePlayer("Async")
asyncKick.kick = () => Promise.reject(new Error("gone"))
check("a rejected kick reports FAILURE, not success", await kick(asyncKick, "bye"), false)

// A promise that RESOLVES to a refusal is the same story one layer deeper.
const asyncRefused = fakePlayer("AsyncRefused")
asyncRefused.kick = () => Promise.resolve({ successCount: 0 })
check("an awaited successCount 0 is caught too", await kick(asyncRefused, "bye"), false)

// A runtime where the method exists but throws reports the failure and stops.
const brokenKick = fakePlayer("Broken")
brokenKick.kick = () => { throw new Error("nope") }
__test.commands.length = 0
check("a throwing Player.kick reports failure", await kick(brokenKick, "bye"), false)
check("and runs no command", __test.commands.length, 0)

console.log("\n— freezing uses the current input API —")
// setEnabled was renamed setPermissionCategory. Calling the old name threw on
// every freeze, which a catch turned into a warning - so freeze silently did
// nothing at all until v0.33.1.
const frozenModern = fakePlayer("FrozenModern")
frozenModern.inputPermissions = {
    categories: {},
    setPermissionCategory(cat, on) { this.categories[cat] = on }
}
setFrozen(frozenModern, true)
check("the new method was called for both categories",
    Object.keys(frozenModern.inputPermissions.categories).length, 2)
check("and it locked rather than unlocked",
    Object.values(frozenModern.inputPermissions.categories).every(v => v === false), true)
setFrozen(frozenModern, false)
check("releasing turns them back on",
    Object.values(frozenModern.inputPermissions.categories).every(v => v === true), true)

const noInput = fakePlayer("NoInput")
noInput.inputPermissions = {}
check("a runtime with neither method does not throw", isFrozen(noInput), false)
setFrozen(noInput, true)
check("the flag is still recorded, so the panel stays honest", isFrozen(noInput), true)
setFrozen(noInput, false)

console.log("\n— banning somebody the kick cannot remove —")
// Whatever the reason a kick fails — and the host is the usual suspect, though
// that has been asserted here more often than it has been observed — the ban
// still has to be RECORDED, and the caller has to be told the player is still
// standing there. A tool that says "removed" about somebody visibly present is
// a tool nobody trusts twice.
const unkickable = fakePlayer("Unkickable")
unkickable.kick = () => { throw new Error("cannot kick the host") }

// Nothing else may quietly remove them either.
const dim = world.getDimension("overworld")
const realRun = dim.runCommand
dim.runCommand = () => { throw new Error("cannot kick the host") }

const hostBan = await ban(unkickable, 0, "Testing", staff)
check("the ban is recorded regardless", isBanned(unkickable), true)
check("ok is true - the ban itself succeeded", hostBan.ok, true)
check("kicked is FALSE - they are still standing there", hostBan.kicked, false)
check("the record survives for the rejoin kick", banRecord(unkickable).reason, "Testing")

dim.runCommand = realRun
unban(unkickable.id)

const normal = fakePlayer("Normal")
normal.kick = () => true
check("an ordinary ban reports the kick landed", (await ban(normal, 0, "x", staff)).kicked, true)
unban(normal.id)

console.log("\n— mutes —")
mute(spammer, 0, "Caps", staff)
check("muted", isMuted(spammer), true)
check("reason kept", muteRecord(spammer).reason, "Caps")
unmute(spammer.id)
check("unmuted", isMuted(spammer), false)

console.log("\n— flags —")
setFrozen(quiet, true)
check("freeze is recorded", isFrozen(quiet), true)
check("movement was actually disabled", quiet.inputPermissions.enabled.movement, false)
setFrozen(quiet, false)
check("unfreeze restores movement", quiet.inputPermissions.enabled.movement, true)
check("tpa open by default", tpaClosed(quiet), false)
setTpaClosed(quiet, true)
check("tpa can be closed", tpaClosed(quiet), true)

console.log("\n— status line —")
check("clear player reads clear", statusLine(griefer).includes("clear"), true)
mute(quiet, 0, "x", staff)
setFrozen(quiet, true)
const s = statusLine(quiet)
check("status names every live state", [s.includes("muted"), s.includes("frozen"), s.includes("TPA")], [true, true, true])

console.log("\n— the ban slider —")
const DAY = 864e5
check("notch 1 is one day", banLengthMs(1), DAY)
check("notch 7 is a week", banLengthMs(BAN_MAX_DAYS), 7 * DAY)
check("the last notch is permanent, which ban() spells 0", banLengthMs(PERMANENT_NOTCH), 0)
check("permanent sits one past the day range", PERMANENT_NOTCH, BAN_MAX_DAYS + 1)

check("the slider offers 8 notches when permanent is allowed", banSliderMax(true), PERMANENT_NOTCH)
check("and stops at 7 when it is not", banSliderMax(false), BAN_MAX_DAYS)

// The whole point of the toggle: with permanent bans off there must be no way
// to reach a permanent ban, including by sending the notch that used to mean it.
check("notch 8 is 7 days when permanent is off, NOT forever",
    banLengthMs(PERMANENT_NOTCH, false), 7 * DAY)
check("and so is anything past it", banLengthMs(99, false), 7 * DAY)
check("out-of-range low still lands on a real length", banLengthMs(0), DAY)
check("a junk value does not become permanent", banLengthMs(undefined), DAY)

check("permanent is called permanent", banLengthLabel(PERMANENT_NOTCH), "permanent")
check("a length is never called permanent by accident",
    banLengthLabel(PERMANENT_NOTCH, false) === "permanent", false)

check("Other is the last reason, so the dropdown ends with the free-text one",
    BAN_REASONS[BAN_REASONS.length - 1], "Other")

// A ban built the way banScreen builds one has to survive the round trip.
const slid = fakePlayer("Slid")
await ban(slid, banLengthMs(3), "Griefing: tore up spawn", staff)
check("a 3-day ban is live", isBanned(slid), true)
check("and carries an expiry rather than 0", banRecord(slid).until > Date.now(), true)
unban(slid.id)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
