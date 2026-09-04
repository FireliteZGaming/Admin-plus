import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, applyPreset, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
import {
    isEnabled, setEnabled, addName, removeName, listNames, count, isAllowed,
    doorCheck, admits, inMaintenance, setMaintenance, maintenanceReason
} from "../Admin+ BP/scripts/core/allowlist.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const p = {
        id: `al${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => { }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const staff = fakePlayer("Staffy")
const guest = fakePlayer("Guest")
const stranger = fakePlayer("Stranger")

console.log("\n— the guest list —")
check("off to begin with", isEnabled(), false)
check("so anybody may join", admits(stranger), true)
check("adding works", addName("Guest", staff), true)
check("adding twice does not", addName("guest", staff), false)
check("names are matched without case", isAllowed("GUEST"), true)
check("and it keeps how they typed it", listNames()[0].name, "Guest")
check("with who added them", listNames()[0].by, "Staffy")

setEnabled(true)
check("now the invited get in", admits(guest), true)
check("and strangers do not", admits(stranger), false)
check("the refusal explains itself",
    doorCheck(stranger).reason, "This world is invite only.")

console.log("\n— staff are never locked out —")
// The obvious way for this to go wrong is the person who switched it on being
// turned away by it, because they forgot to add their own name.
check("a staff member is admitted anyway",
    admits(stranger, { staff: true }), true)
check("so is a config owner", admits(stranger, { owner: true }), true)

check("removing works", removeName("Guest"), true)
check("and they are out", admits(guest), false)
check("removing again does nothing", removeName("Guest"), false)
setEnabled(false)

console.log("\n— maintenance —")
// A different question from the guest list: not WHO is invited, but WHEN
// anybody is. It applies to everyone at once and is meant to be temporary.
check("off to begin with", inMaintenance(), false)
setMaintenance(true, "Back in ten minutes.")
check("it is on", inMaintenance(), true)
check("the reason is kept", maintenanceReason(), "Back in ten minutes.")
check("everyone is turned away", admits(guest), false)
check("with the reason they were given", doorCheck(guest).reason, "Back in ten minutes.")
check("but staff stay in", admits(guest, { staff: true }), true)
check("and owners", admits(guest, { owner: true }), true)

setMaintenance(false)
check("turning it off reopens", admits(guest), true)
setMaintenance(true)
check("the reason survives being switched off and on", maintenanceReason(), "Back in ten minutes.")
setMaintenance(false)

console.log("\n— maintenance outranks the guest list —")
// Both on: maintenance is the one to report, because it is the temporary state
// and "come back later" is more useful than "you were never invited".
addName("Guest", staff)
setEnabled(true)
setMaintenance(true, "Patching.")
check("an invited guest is still turned away", admits(guest), false)
check("and told about the maintenance", doorCheck(guest).reason, "Patching.")
setMaintenance(false)
check("with maintenance over, the invite works again", admits(guest), true)
setEnabled(false)
removeName("Guest")

console.log("\n— the node —")
check("admin.allowlist is declared",
    Object.values(PERMISSION_NODES).flat().includes("admin.allowlist"), true)
check("and sits with moderation",
    PERMISSION_NODES.Moderation.includes("admin.allowlist"), true)
check("nothing left on the list", count(), 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
