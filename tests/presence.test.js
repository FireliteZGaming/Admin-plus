import { __test, world } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting, setting } from "../Admin+ BP/scripts/core/settings.js"
import { setNickname, getNickname } from "../Admin+ BP/scripts/core/identity.js"
import { vanish, unvanish } from "../Admin+ BP/scripts/core/vanish.js"
import { announceJoin, announceLeave, greet, GREETING_DELAY } from "../Admin+ BP/scripts/features/presence.js"

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
        got: [],
        sendMessage: (m) => p.got.push(m),
        addEffect: (e) => p.effects.add(e), removeEffect: (e) => p.effects.delete(e),
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
// 3.1.9, the user: "it shouldn't use color besides the natural yellow for
// join and leave messages". The display name is used, without its colour, so
// the whole line is the game's yellow.
check("the display name is used, all in the line's yellow", sent.at(-1), "§eStarlight joined the game")
setNickname(nova, "")

console.log("\n— {NAME} is the gamertag, {NICKNAME} is what they call themselves —")
// The shipped line uses {NICKNAME}, so a nicknamed player still joins under the
// name everyone watched them wear. But {NAME} now reaches the real account name,
// which it could not do at all before — every site filled it with displayName().
// That is the name you ban under and the one the audit log stores, so a server
// that wants it in the join line can finally ask for it.
setNickname(nova, "§dStarlight")
setSetting("format.join", "§a+ {NAME}")
sent.length = 0
announceJoin(nova)
check("a {NAME} format shows the gamertag even when nicknamed", sent.at(-1), "§a+ Nova")
setSetting("format.join", "§a+ {NICKNAME}")
sent.length = 0
announceJoin(nova)
check("and {NICKNAME} shows the nickname, in the line's own colour", sent.at(-1), "§a+ Starlight")
setSetting("format.join", "§a+ {NAME} ({NICKNAME})")
sent.length = 0
announceJoin(nova)
check("both at once, which is the point of splitting them",
    sent.at(-1), "§a+ Nova (Starlight)")
setNickname(nova, "")
sent.length = 0
announceJoin(nova)
check("no nickname means {NICKNAME} falls back rather than going blank",
    sent.at(-1), "§a+ Nova (Nova)")
resetSetting("format.join")
check("default restored", setting("format.join"), "§e{NICKNAME} joined the game")

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

console.log("\n— a styled name cannot repaint the line —")
// Three reports. 1: a nickname's colour escaped and repainted the words after
// it. 2: the §r that closed it reset the rest of the line to WHITE. 3 (3.1.9,
// the user, with a screenshot of a red name before a yellow "joined the
// game"): "it shouldn't use color besides the natural yellow for join and
// leave messages". So join and leave lines carry the name without its colour.
// The line has to stay yellow. That is what vanilla's own leave line looks
// like, and matching it is the whole reason this pack prints its own.
{
    setNickname(nova.id, "§bSp§lar§rks")
    sent.length = 0
    announceLeave("Nova", getNickname(nova.id))
    const line = sent.at(-1)

    check("the name keeps its letters and loses its colour, bold and resets", line, "§eSparks left the game")
    check("so the whole line is yellow: one colour code, the line's own", line.match(/§./g), ["§e"])

    // A plain name changes nothing — no reset, because nothing was styled.
    setNickname(nova.id, "")
    sent.length = 0
    announceLeave("Nova", getNickname(nova.id))
    check("an unstyled name adds no codes at all", sent.at(-1), "§eNova left the game")
}

console.log("\n— a newcomer is told where to look, and nobody else hears it —")
// /info is written for somebody who has never used a mod, and nothing anywhere
// told them it existed. One line on join fixes that. What makes it bearable
// rather than spam is who hears it: them, and only them.
{
    const newbie = fakePlayer("Newbie")
    onPlayerJoin(newbie)
    sent.length = 0
    newbie.got.length = 0

    const line = greet(newbie)
    check("it says something", typeof line, "string")
    check("and it lands on them", newbie.got.at(-1), line)
    check("nobody else hears it", sent.length, 0)
    // The whole point of the line. If this fails the feature is decorative.
    check("it names the command it exists to point at", line.includes("/info"), true)
    check("and calls them by name", line.includes("Newbie"), true)

    // A nickname is what they chose to be called, so the greeting uses it.
    setNickname(newbie.id, "§bSparks")
    newbie.got.length = 0
    check("a nickname wins", greet(newbie).includes("Sparks"), true)
    setNickname(newbie.id, "")

    // Late, not instant: the join burst is where a line goes to be missed.
    check("it waits for the join noise to pass", GREETING_DELAY >= 20, true)
    check("but not so long they have wandered off", GREETING_DELAY <= 200, true)

    // Two ways to silence it, because a realm with its own welcome system
    // should not have to hunt for the switch.
    setSetting("presence.greet", "false")
    newbie.got.length = 0
    check("the switch silences it", greet(newbie), undefined)
    check("and it really sent nothing", newbie.got.length, 0)
    resetSetting("presence.greet")

    setSetting("format.greeting", "")
    newbie.got.length = 0
    check("so does blanking the line", greet(newbie), undefined)
    check("also without sending", newbie.got.length, 0)
    resetSetting("format.greeting")
    check("and it comes back", typeof greet(newbie), "string")

    // The shipped default has to be the useful one — a test on greet() alone
    // would pass just as happily with the pointer edited out of it.
    check("the default that ships points at /info",
        setting("format.greeting").includes("/info"), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
