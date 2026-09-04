import { __test, world } from "@minecraft/server"
import {
    ban, banRecord, isBanned, unban, banList, banMessage, pruneExpired,
    mute, isMuted, unmute, muteRecord,
    kick, setFrozen, isFrozen, tpaClosed, setTpaClosed, statusLine
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
ban(griefer, 0, "Grief", staff)
check("permanent ban sticks", isBanned(griefer), true)
check("record keeps who and why", [banRecord(griefer).reason, banRecord(griefer).by], ["Grief", "Firelite"])
check("permanent means no expiry", banRecord(griefer).until, 0)
check("it appears in the ban list", banList().map(b => b.name), ["Griefer"])
unban(griefer.id)
check("unban clears it", isBanned(griefer), false)

console.log("\n— temporary bans expire on their own —")
ban(spammer, 60 * 1000, "Spam", staff)
check("temp ban is live now", isBanned(spammer), true)
// Rewind the expiry rather than waiting a minute.
banRecord(spammer).until = Date.now() - 1
check("an elapsed ban stops counting", isBanned(spammer), false)
pruneExpired()
check("and prune clears the record", banList().length, 0)

console.log("\n— there is NO /kick fallback, on purpose —")
// /kick does not merely disconnect somebody on a local world: it locks them out
// until the HOST restarts it. That is a punishment nobody chose and the person
// who ran it cannot undo, so a kick that quietly fails is the smaller problem.
// Nothing in the pack may reach for the command.
__test.commands.length = 0
ban(griefer, 0, "Grief", staff)
check("banning somebody with no Player.kick issues no command",
    __test.commands.filter(c => String(c).startsWith("kick ")).length, 0)
check("the ban itself still stands", isBanned(griefer), true)
check("and the ban message is unaffected",
    banMessage(banRecord(griefer)).includes("\n"), true)
unban(griefer.id)

__test.commands.length = 0
check("kick() reports the failure rather than falling back",
    kick(quiet, 'go "away" now'), false)
check("still no command was run", __test.commands.length, 0)


console.log("\n— kicking uses Player.kick, not the operator command —")
// The distinction matters: /kick is the op command, and on a local or LAN
// world it can leave someone unable to rejoin until the world is relaunched,
// besides refusing to touch the host. A kick should mean "leave and come
// back"; the ban list is what makes something last.
const modern = fakePlayer("Modern")
modern.kicked = []
modern.kick = (reason) => { modern.kicked.push(reason); return true }

__test.commands.length = 0
check("it reports success", kick(modern, "Behave\nSee you"), true)
check("the script method was used once", modern.kicked.length, 1)
check("and NO kick command was run", __test.commands.length, 0)
// A REAL newline, which is what the fallback has to flatten and the script
// method does not — that difference is the whole reason to prefer it.
check("the reason keeps its line break, unmangled",
    modern.kicked[0].includes("\n"), true)
check("and is passed through untouched", modern.kicked[0], "Behave\nSee you")

// A promise that rejects must not become an unhandled rejection.
const asyncKick = fakePlayer("Async")
asyncKick.kick = () => Promise.reject(new Error("gone"))
check("a rejected promise is caught, not thrown", kick(asyncKick, "bye"), true)

// A runtime where the method exists but throws reports the failure and stops.
// It does NOT reach for /kick: locking somebody out of a friend's world until
// the host restarts it is worse than a kick that did not happen.
const brokenKick = fakePlayer("Broken")
brokenKick.kick = () => { throw new Error("nope") }
__test.commands.length = 0
check("a throwing Player.kick reports failure", kick(brokenKick, "bye"), false)
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

console.log("\n— banning somebody who cannot be kicked —")
// The world HOST cannot be removed by anything on Bedrock: they are the
// server. The ban still has to be RECORDED, and the caller has to be told the
// player is still standing there, or the tool starts lying to the person
// holding it. Confirmed in play: the hammer works on everyone but the host.
const unkickable = fakePlayer("Unkickable")
unkickable.kick = () => { throw new Error("cannot kick the host") }

// Make the /kick fallback fail too, so nothing can remove them.
const dim = world.getDimension("overworld")
const realRun = dim.runCommand
dim.runCommand = () => { throw new Error("cannot kick the host") }

const hostBan = ban(unkickable, 0, "Testing", staff)
check("the ban is recorded regardless", isBanned(unkickable), true)
check("ok is true - the ban itself succeeded", hostBan.ok, true)
check("kicked is FALSE - they are still standing there", hostBan.kicked, false)
check("the record survives for the rejoin kick", banRecord(unkickable).reason, "Testing")

dim.runCommand = realRun
unban(unkickable.id)

const normal = fakePlayer("Normal")
normal.kick = () => true
check("an ordinary ban reports the kick landed", ban(normal, 0, "x", staff).kicked, true)
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

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
