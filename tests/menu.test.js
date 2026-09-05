import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { PREFS, pref, setPref, prefsOf, changedCount, __resetPrefs } from "../Admin+ BP/scripts/core/prefs.js"
import { statsLines } from "../Admin+ BP/scripts/features/menu.js"
import { mute, unmute } from "../Admin+ BP/scripts/core/moderation.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const p = {
        id: `m${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: () => {},
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")

console.log("\n— a switch exists only if something reads it —")
// This is the whole discipline of the settings screen. A toggle that changes
// nothing is WORSE than no toggle: the player believes they turned something
// off and finds out otherwise when somebody teleports to them anyway. Each
// preference names the file that honours it; this proves that file mentions it.
for (const [key, spec] of Object.entries(PREFS)) {
    const src = readFileSync(new URL(`../Admin+ BP/scripts/${spec.readBy}`, import.meta.url), "utf8")
    check(`${key} is actually read by ${spec.readBy}`, src.includes(`"${key}"`), true)
}
check("every preference says who reads it",
    Object.values(PREFS).filter(p => !p.readBy), [])
check("and carries a refusal line for when it is off",
    Object.values(PREFS).filter(p => !p.off), [])

console.log("\n— defaults —")
// All ON on purpose: somebody who never opens the menu stays reachable exactly
// as they are today. Turning something off is an act, not a starting state.
check("every switch ships on", Object.values(PREFS).every(p => p.value === true), true)

const alice = fakePlayer("Alice")
setRanks(alice.id, ["member"], alice.name)
check("an untouched player accepts teleports", pref(alice, "tpa.accept"), true)
check("and private messages", pref(alice, "pm.accept"), true)
check("nothing is stored for them", changedCount(alice), 0)

console.log("\n— changing one —")
setPref(alice, "tpa.accept", false)
check("it reads back", pref(alice, "tpa.accept"), false)
check("one difference is stored", changedCount(alice), 1)
check("the others are untouched", pref(alice, "pm.accept"), true)

// Only DIFFERENCES are stored, so agreeing with the default again empties the
// record rather than writing "true" into it forever.
setPref(alice, "tpa.accept", true)
check("agreeing again stores nothing", changedCount(alice), 0)
check("and still reads true", pref(alice, "tpa.accept"), true)

check("an unknown key is refused", setPref(alice, "nonsense.key", false), false)
check("and reading one falls back to allowed", pref(alice, "nonsense.key"), true)

console.log("\n— the settings screen's data —")
const rows = prefsOf(alice)
check("one row per switch", rows.length, Object.keys(PREFS).length)
check("each carries a label", rows.every(r => !!r.label), true)
check("and the player's current answer", rows.every(r => typeof r.on === "boolean"), true)

console.log("\n— the stats block answers questions —")
__resetPrefs(alice)
const bob = fakePlayer("Bob")
setRanks(bob.id, ["member"], bob.name)

let lines = statsLines(bob)
check("it names them", lines[0].includes("Bob"), true)
check("a clean player gets no warning line", lines.some(l => l.includes("warning")), false)
check("and no mute line", lines.some(l => l.includes("Muted")), false)
check("it stays short", lines.length <= 4, true)

// The line that earns the feature: a muted player currently types, sees
// nothing, and has to ask staff why.
mute(bob, 2 * 60 * 60 * 1000, "spamming in general", alice)
lines = statsLines(bob)
check("a muted player is told so", lines.some(l => l.includes("Muted")), true)
check("with how long is left", lines.some(l => l.includes("hour")), true)
check("and why", lines.some(l => l.includes("spamming in general")), true)
unmute(bob.id)
check("unmuting clears the line", statsLines(bob).some(l => l.includes("Muted")), false)

console.log("\n— the wiring the screen depends on —")
// Reading the source rather than restating the rule: these three checks are
// what make the switches real, and each lives in a different file.
const tpaSrc = readFileSync(new URL("../Admin+ BP/scripts/features/tpa.js", import.meta.url), "utf8")
const pcSrc = readFileSync(new URL("../Admin+ BP/scripts/features/privatechat.js", import.meta.url), "utf8")
check("tpa refuses when the target said no", tpaSrc.includes('pref(target, "tpa.accept")'), true)
check("private chat does too", pcSrc.includes('pref(target, "prchat.accept")'), true)
// Staff must always be able to reach somebody. A preference that let a player
// mute the moderators would be a hole, not a setting.
check("but staff always get a private message through",
    pcSrc.includes('!pref(target, "pm.accept") && !isStaff(player)'), true)
// ...and NOT for teleports, where staff have /a:tp and need no exception.
check("teleport has no staff exception", tpaSrc.includes("isStaff"), false)

console.log("\n— vanish must survive this screen —")
const menuSrc = readFileSync(new URL("../Admin+ BP/scripts/features/menu.js", import.meta.url), "utf8")
check("the people list hides vanished players", menuSrc.includes("!isVanished(p)"), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
