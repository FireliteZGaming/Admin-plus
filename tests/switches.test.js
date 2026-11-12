import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting, nameTagsEnabled } from "../Admin+ BP/scripts/core/settings.js"
import { saveRank, setRanks, onPlayerJoin, applyPreset, renderTags, refreshNameTag, chatColourFor, chatNameFor } from "../Admin+ BP/scripts/core/ranks.js"
import { saveTag, giveTag, takeTag, deleteTag, tagsOf, allTags, holderCount, __resetTags } from "../Admin+ BP/scripts/core/tags.js"
import { formatChatLine } from "../Admin+ BP/scripts/features/chat.js"
import { mute, unmute } from "../Admin+ BP/scripts/core/moderation.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The switches for a server that runs another chat or rank mod, cosmetic
// tags, and the name and chat colours a rank sets in Basics.

let n = 0
function makePlayer(name) {
    const inbox = []
    const p = {
        id: `sw${n++}`, name, nameTag: name, commandPermissionLevel: 0, inbox,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: m => inbox.push(m)
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
__resetTags()
const steve = makePlayer("Steve")
const alex = makePlayer("Alex")
setRanks(steve.id, ["mod"], steve.name)
setRanks(alex.id, ["member"], alex.name)
const plain = s => String(s).replace(/§./g, "")

console.log("\n— cosmetic tags sit outside the rank order —")
{
    saveTag("builder", { name: "Builder", display: "§6Builder" })
    saveTag("artist", { name: "Artist", display: "§dArtist" })
    check("tags are listed by name, not by any order of authority",
        allTags().map(t => t.id), ["artist", "builder"])
    check("giving a tag works once", giveTag(steve.id, "builder"), true)
    check("and twice is refused, not duplicated", giveTag(steve.id, "builder"), false)
    check("a tag that does not exist cannot be given", giveTag(steve.id, "nope"), false)
    check("the tag shows after the rank tag", plain(renderTags(steve)), "[Mod] [Builder]")
    check("its holder count", holderCount("builder"), 1)

    // A tag is decoration: it changes nothing about who outranks whom.
    giveTag(alex.id, "artist")
    check("a member with a tag is still just a member", plain(renderTags(alex)), "[Member] [Artist]")

    check("taking it away works", takeTag(steve.id, "builder"), true)
    check("and leaves only the rank", plain(renderTags(steve)), "[Mod]")

    giveTag(steve.id, "builder")
    deleteTag("builder")
    check("deleting a tag takes it off everyone", tagsOf(steve.id).length, 0)
}

console.log("\n— rank tags can be switched off —")
{
    giveTag(steve.id, "artist")
    setSetting("feature.ranktags", "false")
    check("with rank tags off, only cosmetic tags show", plain(renderTags(steve)), "[Artist]")
    check("and somebody with no cosmetic tag shows nothing at all", plain(renderTags(makePlayer("Nobody"))), "")
    setSetting("feature.tags", "false")
    check("with both off there is no tag", renderTags(steve), "")
    resetSetting("feature.tags")
    resetSetting("feature.ranktags")
    check("back on, both return", plain(renderTags(steve)), "[Mod] [Artist]")
    takeTag(steve.id, "artist")
}

console.log("\n— names above heads can be handed to another mod —")
{
    check("on by default", nameTagsEnabled(), true)
    refreshNameTag(steve)
    const drawn = steve.nameTag
    check("Admin+ draws the nametag", plain(drawn).includes("[Mod]"), true)
    setSetting("feature.nametags", "false")
    check("switched off", nameTagsEnabled(), false)
    steve.nameTag = "OtherMod: Steve"
    refreshNameTag(steve)
    check("and Admin+ no longer writes it, so another mod's stays", steve.nameTag, "OtherMod: Steve")
    resetSetting("feature.nametags")
}

console.log("\n— Admin+ chat can be switched off —")
{
    const emit = (player, message) => __test.emitChat(player, message)

    const on = emit(alex, "hello everyone")
    check("normally Admin+ takes the message over", on.cancel, true)

    setSetting("feature.adminchat", "false")
    const off = emit(alex, "hello everyone")
    check("switched off, the message is left for the game or another mod", off.cancel, false)

    mute(alex, 0, "spam", steve)
    const muted = emit(alex, "let me talk")
    check("a mute still works with Admin+ chat off", muted.cancel, true)
    unmute(alex)
    resetSetting("feature.adminchat")
}

console.log("\n— name colour and chat colour, from the rank —")
{
    saveRank("member", { meta: { "chat.colour": "e", "nametag.style": "colour_aqua" } })
    check("the chat colour comes from the rank", chatColourFor(alex), "§e")
    check("the name is painted in the name colour", chatNameFor(alex, "Alex"), "§bA§bl§be§bx")
    const line = formatChatLine(alex, "hi", undefined, false)
    check("a chat line carries both", line.includes("§bA§bl§be§bx") && line.includes("§ehi"), true)

    setSetting("feature.namecolour", "false")
    check("with name colours off the name is left alone", chatNameFor(alex, "Alex"), "Alex")
    resetSetting("feature.namecolour")

    saveRank("member", { meta: { "chat.colour": "x" } })
    check("something that is not a colour code gives no colour", chatColourFor(alex), "")
    saveRank("member", { meta: {} })
    check("and no value gives none", chatColourFor(alex), "")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
