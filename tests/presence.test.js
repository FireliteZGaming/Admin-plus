import { __test, world } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting, setting } from "../Admin+ BP/scripts/core/settings.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { vanish, unvanish } from "../Admin+ BP/scripts/core/vanish.js"
import { announceJoin, announceLeave } from "../Admin+ BP/scripts/features/presence.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// Capture what the world broadcasts.
const sent = []
world.sendMessage = (m) => sent.push(m)

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `pr${nextId++}`, name, nameTag: name, commandPermissionLevel: 0, effects: new Set(),
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: () => {}, addEffect: (e) => p.effects.add(e), removeEffect: (e) => p.effects.delete(e),
        runCommand: () => ({ successCount: 1 })
    }
    __test.players.push(p)
    return p
}
const nova = fakePlayer("Nova") ; onPlayerJoin(nova)

console.log("\n— the lines match vanilla's wording and colour —")
sent.length = 0
announceJoin(nova)
check("join line", sent.at(-1), "§eNova joined the game")
announceLeave("Nova")
check("leave line", sent.at(-1), "§eNova left the game")
check("yellow, like the game's own", sent.at(-1).startsWith("§e"), true)

console.log("\n— a vanish is indistinguishable because it is the same line —")
sent.length = 0
vanish(nova)
announceLeave("Nova")           // what /vanish does
const fake = sent.at(-1)
unvanish(nova)
sent.length = 0
announceLeave("Nova")           // a real disconnect
check("byte-identical to a real leave", sent.at(-1), fake)

console.log("\n— nicknames are respected —")
setNickname(nova, "§dStarlight")
sent.length = 0
announceJoin(nova)
check("the display name is used", sent.at(-1), "§e§dStarlight joined the game")
setNickname(nova, "")

console.log("\n— the format is editable —")
setSetting("format.join", "§a+ {NAME}")
sent.length = 0
announceJoin(nova)
check("custom join format", sent.at(-1), "§a+ Nova")
resetSetting("format.join")
check("default restored", setting("format.join"), "§e{NAME} joined the game")

console.log("\n— announcements can be switched off entirely —")
setSetting("presence.announce", "false")
sent.length = 0
announceJoin(nova)
announceLeave("Nova")
check("nothing is printed", sent.length, 0)
resetSetting("presence.announce")
sent.length = 0
announceJoin(nova)
check("and back on again", sent.length, 1)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
