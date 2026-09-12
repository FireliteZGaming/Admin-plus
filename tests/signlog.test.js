import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { recent, branch, clear as clearLogs } from "../Admin+ BP/scripts/core/logs.js"
import {
    installSignLog, signText, watchSign, __clearSignWatches
} from "../Admin+ BP/scripts/features/signlog.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const player = {
    id: "s1", name: "Writer", nameTag: "Writer",
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}
}
__test.players.push(player)

/**
 * A sign whose text can change between looks — which is the entire point. A
 * stub returning a fixed string would agree with any polling scheme at all,
 * including one that never polled.
 */
function fakeSign(text = "", at = { x: 10, y: 64, z: -20 }) {
    const block = {
        location: at,
        dimension: __test.dimension,
        text,
        getComponent: id => id === "minecraft:sign"
            ? { getText: () => block.text, setText: t => { block.text = t } }
            : undefined
    }
    return block
}

/** A block that is not a sign at all. */
const stone = { location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension, getComponent: () => undefined }

installSignLog()

console.log("\n— reading a sign —")
{
    check("a blank sign says nothing", signText(fakeSign("")), "")
    check("a written one comes back", signText(fakeSign("hello there")), "hello there")
    // Four lines of sign become one line of log, or the entry breaks the list.
    check("the four lines become one", signText(fakeSign("a\nb\nc\nd")), "a / b / c / d")
    // Colour codes go entirely. Hiding a word behind §0 on a black sign is
    // exactly the trick this feature exists to catch, and a § in the log would
    // repaint the line around it besides.
    check("§ codes are stripped, not preserved", signText(fakeSign("§4§lBAD §0word")), "BAD word")
    check("a block with no sign component is not a sign", signText(stone), "")
}

console.log("\n— text typed after the sign goes down is still caught —")
// The whole difficulty: Bedrock places the sign blank and the words arrive
// afterwards, through a screen no script can see. There is no sign-edited
// event — checked against every pack installed on this machine. So the block is
// watched and read back.
{
    clearLogs(); __clearSignWatches()
    const sign = fakeSign("")
    __test.emitPlaceBlock(player, sign)
    check("nothing is recorded while it is still blank", recent(10).length, 0)

    // They type. Then the watch looks again.
    sign.text = "free diamonds at spawn"
    __test.runTimers()

    const entries = branch("sign")
    check("one entry, once the words exist", entries.length, 1)
    check("filed as written, not edited", entries[0].action, "sign.written")
    check("by the player who placed it", entries[0].actor.name, "Writer")
    check("with what it says", entries[0].detail.includes("free diamonds at spawn"), true)
    // A moderator has to be able to go and look at it.
    check("and where to find it", entries[0].detail.includes("10, 64, -20"), true)
    check("in which world", entries[0].detail.includes("overworld"), true)
}

console.log("\n— a sign nobody writes on is not an entry —")
{
    clearLogs(); __clearSignWatches()
    __test.emitPlaceBlock(player, fakeSign(""))
    __test.runTimers()
    check("placing a blank sign records nothing", branch("sign").length, 0)
    // And the watch releases itself, or the cap fills with blank signs.
    check("and the watch is not left holding the slot",
        watchSign(player, fakeSign("", { x: 10, y: 64, z: -20 })), true)
}

console.log("\n— editing an existing sign is a different entry —")
// A place-only hook misses this entirely, and it is the more suspicious case:
// changing somebody else's sign at spawn.
{
    clearLogs(); __clearSignWatches()
    const sign = fakeSign("shop: 5 gold")
    __test.emitInteractBlock(player, sign)
    __test.runTimers()
    check("merely touching a sign records nothing", branch("sign").length, 0)

    __clearSignWatches()
    __test.emitInteractBlock(player, sign)
    sign.text = "shop: 500 gold"
    __test.runTimers()
    const entries = branch("sign")
    check("changing it does", entries.length, 1)
    check("filed as an edit", entries[0].action, "sign.edited")
    check("carrying the new text", entries[0].detail.includes("shop: 500 gold"), true)
    // Without the old text the entry cannot answer "what did they change".
    check("and the old, which is the point of an edit entry",
        entries[0].detail.includes("shop: 5 gold"), true)
}

console.log("\n— the switch, and the ceiling —")
{
    clearLogs(); __clearSignWatches()
    setSetting("logs.signs", "false")
    const sign = fakeSign("")
    __test.emitPlaceBlock(player, sign)
    sign.text = "should not appear"
    __test.runTimers()
    check("switched off, nothing is recorded", branch("sign").length, 0)
    resetSetting("logs.signs")

    // A sign farm, or somebody doing it deliberately, must not grow the watch
    // list without end.
    __clearSignWatches()
    let taken = 0
    for (let i = 0; i < 200; i++) {
        if (watchSign(player, fakeSign("", { x: i, y: 64, z: 0 }))) taken++
    }
    check("the watch list has a ceiling", taken <= 64, true)
    check("which is not so low it is useless", taken >= 16, true)
    __clearSignWatches()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
