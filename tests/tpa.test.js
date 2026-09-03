import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, saveRank, getRank } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setTpaClosed } from "../Admin+ BP/scripts/core/moderation.js"
import {
    createRequest, cancelRequest, takeIncoming, incomingFor, outgoingFrom, secondsLeft
} from "../Admin+ BP/scripts/core/tpa.js"

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
        id: `a${nextId++}`, name, nameTag: name, inbox: [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" },
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(m), teleport: () => {}
    }
    __test.players.push(p)
    return p
}

const nova = fakePlayer("Nova")   ; onPlayerJoin(nova)
const alex = fakePlayer("Alex")   ; onPlayerJoin(alex)
const sam = fakePlayer("Sam")     ; onPlayerJoin(sam)

console.log("\n— asking —")
check("a request is accepted", createRequest(nova, alex, "to").ok, true)
check("it shows on the sender", outgoingFrom(nova).toName, "Alex")
check("and in the target's inbox", incomingFor(alex).map(r => r.fromName), ["Nova"])
check("you cannot ask yourself", createRequest(nova, nova, "to").ok, false)

console.log("\n— one live request per sender —")
createRequest(nova, sam, "to")
check("asking someone else replaces the first", outgoingFrom(nova).toName, "Sam")
check("so Alex's copy is gone", incomingFor(alex).length, 0)
check("and Sam has it", incomingFor(sam).map(r => r.fromName), ["Nova"])

console.log("\n— several people can ask the same player —")
createRequest(alex, sam, "here")
check("Sam has two waiting", incomingFor(sam).map(r => r.fromName).sort(), ["Alex", "Nova"])
check("bare accept takes the newest", takeIncoming(sam).fromName, "Alex")
check("the other still waits", incomingFor(sam).map(r => r.fromName), ["Nova"])
check("naming a sender picks that one", takeIncoming(sam, "nova").fromName, "Nova")
check("and the queue is empty", incomingFor(sam).length, 0)

console.log("\n— closed TPA is respected —")
setTpaClosed(alex, true)
const refused = createRequest(nova, alex, "to")
check("refused", refused.ok, false)
check("and says why without being cryptic", refused.reason.includes("isn't accepting"), true)
setTpaClosed(alex, false)
check("reopening lets it through", createRequest(nova, alex, "to").ok, true)

console.log("\n— a rank that denies tpa.use blocks being asked —")
saveRank("member", { perms: getRank("member").perms.filter(p => p !== "tpa.use") })
check("cannot ask someone without the node", createRequest(nova, sam, "to").ok, false)
saveRank("member", { perms: [...getRank("member").perms, "tpa.use"] })

console.log("\n— cancelling —")
createRequest(nova, alex, "to")
check("cancel returns what it removed", cancelRequest(nova).toName, "Alex")
check("nothing left outgoing", outgoingFrom(nova), undefined)
check("nor incoming", incomingFor(alex).length, 0)
check("cancelling twice is harmless", cancelRequest(nova), undefined)

console.log("\n— requests lapse —")
setSetting("tpa.expire", "60")
const live = createRequest(nova, alex, "to").request
check("fresh request has time left", secondsLeft(live) > 55, true)
live.at -= 61 * 1000                       // rewind past the expiry
check("an expired request is not delivered", incomingFor(alex).length, 0)
check("and is not accepted", takeIncoming(alex), undefined)
check("the sender's slot is freed too", outgoingFrom(nova), undefined)
resetSetting("tpa.expire")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
