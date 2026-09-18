import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { recent, branch, clear as clearLogs } from "../Admin+ BP/scripts/core/logs.js"
import { recentSigns, __resetChatLog } from "../Admin+ BP/scripts/core/chatlog.js"
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
    clearLogs(); __resetChatLog(); __clearSignWatches()
    const sign = fakeSign("")
    __test.emitPlaceBlock(player, sign)
    check("nothing is recorded while it is still blank", recent(10).length, 0)

    // They type. Then the watch looks again.
    sign.text = "free diamonds at spawn"
    __test.runTimers()

    // **Signs go in the CHAT log, not the audit log** (2.6.6). A sign is
    // something a player put in front of everyone, which is what that table
    // is for — filed as an action it sat under Recent between a ban and a
    // rank grant, while the Chat screen could not see it at all.
    const entries = recentSigns(10)
    check("one entry, once the words exist", entries.length, 1)
    check("it is not in the action log", branch("sign").length, 0)
    check("marked as a sign, not spoken", entries[0].kind, "sign")
    check("filed as written, not edited", entries[0].was, undefined)
    check("by the player who placed it", entries[0].name, "Writer")
    check("with what it says", entries[0].text, "free diamonds at spawn")
    // A moderator has to be able to go and look at it.
    check("and where to find it", entries[0].where.includes("10, 64, -20"), true)
    check("in which world", entries[0].where.includes("overworld"), true)
}

console.log("\n— a sign nobody writes on is not an entry —")
{
    clearLogs(); __resetChatLog(); __clearSignWatches()
    __test.emitPlaceBlock(player, fakeSign(""))
    __test.runTimers()
    check("placing a blank sign records nothing", recentSigns(10).length, 0)
    // And the watch releases itself, or the cap fills with blank signs.
    check("and the watch is not left holding the slot",
        watchSign(player, fakeSign("", { x: 10, y: 64, z: -20 })), true)
}

console.log("\n— editing an existing sign is a different entry —")
// A place-only hook misses this entirely, and it is the more suspicious case:
// changing somebody else's sign at spawn.
{
    clearLogs(); __resetChatLog(); __clearSignWatches()
    const sign = fakeSign("shop: 5 gold")
    __test.emitInteractBlock(player, sign)
    __test.runTimers()
    check("merely touching a sign records nothing", recentSigns(10).length, 0)

    __clearSignWatches()
    __test.emitInteractBlock(player, sign)
    sign.text = "shop: 500 gold"
    __test.runTimers()
    const entries = recentSigns(10)
    check("changing it does", entries.length, 1)
    check("filed as an edit", entries[0].was, "shop: 5 gold")
    check("carrying the new text", entries[0].text, "shop: 500 gold")
    // Without the old text the entry cannot answer "what did they change".
    check("and the old, which is the point of an edit entry",
        entries[0].was, "shop: 5 gold")
}

console.log("\n— the switch, and the ceiling —")
{
    clearLogs(); __resetChatLog(); __clearSignWatches()
    setSetting("logs.signs", "false")
    const sign = fakeSign("")
    __test.emitPlaceBlock(player, sign)
    sign.text = "should not appear"
    __test.runTimers()
    check("switched off, nothing is recorded", recentSigns(10).length, 0)
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

console.log("\n— command blocks: who, where, and honestly not what —")
// **The command inside cannot be read.** Bedrock has no NBT and the script API
// exposes no command-block component — settled by WorldEdit, which keeps a list
// of components it CAN read and a separate list of block ids it special-cases,
// with all three command blocks in the second. A pack that copies blocks for a
// living would read the command if there were a way.
//
// So this pins the useful half, and pins that the honest half stays absent.
{
    clearLogs(); __resetChatLog(); __clearSignWatches()
    const at = { x: -8, y: 72, z: 300 }
    const cmd = { location: at, dimension: __test.dimension, typeId: "minecraft:command_block",
                  getComponent: () => undefined }

    __test.emitPlaceBlock(player, cmd)
    const placed = branch("cmdblock")
    check("placing one is recorded", placed.length, 1)
    check("filed as placed", placed[0].action, "cmdblock.placed")
    check("naming who did it", placed[0].actor.name, "Writer")
    check("which kind it was", placed[0].detail.includes("command block"), true)
    check("and where to go and look", placed[0].detail.includes("-8, 72, 300"), true)

    // The three types are told apart, because a repeating one is a different
    // level of concern from a plain one.
    clearLogs()
    __test.emitPlaceBlock(player, { ...cmd, typeId: "minecraft:repeating_command_block" })
    check("a repeating one says so", branch("cmdblock")[0].detail.includes("repeating"), true)

    // Removing one is the same question in reverse: "who took out the command
    // block that ran spawn protection".
    clearLogs()
    __test.emitBreakBlock(player, { location: at, dimension: __test.dimension },
        "minecraft:chain_command_block")
    const broken = branch("cmdblock")
    check("breaking one is recorded too", broken.length, 1)
    check("filed as broken", broken[0].action, "cmdblock.broken")
    check("and reads the type off the broken permutation, not the air left behind",
        broken[0].detail.includes("chain command block"), true)

    // An ordinary block is not an event.
    clearLogs()
    __test.emitPlaceBlock(player, { ...cmd, typeId: "minecraft:stone" })
    __test.emitBreakBlock(player, { location: at, dimension: __test.dimension }, "minecraft:stone")
    check("ordinary blocks are not logged", branch("cmdblock").length, 0)

    setSetting("logs.commandBlocks", "false")
    __test.emitPlaceBlock(player, cmd)
    check("and the switch silences it", branch("cmdblock").length, 0)
    resetSetting("logs.commandBlocks")
    clearLogs()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
