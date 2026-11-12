import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting, nameTagsEnabled } from "../Admin+ BP/scripts/core/settings.js"
import {
    saveRank, setRanks, grantRank, revokeRank, deleteRank, heldRankIds, getRank, ladder, has,
    onPlayerJoin, applyPreset, renderTags, refreshNameTag, rankType,
    chatColourFor, chatNameFor, nameFontFor, chatFontFor
} from "../Admin+ BP/scripts/core/ranks.js"
import { setNameFont, nameTokens } from "../Admin+ BP/scripts/core/identity.js"
import { applyFont } from "../Admin+ BP/scripts/core/fonts.js"
import { formatChatLine } from "../Admin+ BP/scripts/features/chat.js"
import { mute, unmute } from "../Admin+ BP/scripts/core/moderation.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The switches for a server that runs another chat or rank mod, the four rank
// types, and the colours and fonts a rank sets in Basics.

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
const steve = makePlayer("Steve")
const alex = makePlayer("Alex")
setRanks(steve.id, ["mod"], steve.name)
setRanks(alex.id, ["member"], alex.name)
const plain = s => String(s).replace(/§./g, "")

console.log("\n— cosmetic ranks sit outside the rank order —")
{
    saveRank("builder", { display: "§6Builder", type: "cosmetic" })
    saveRank("artist", { display: "§dArtist", type: "cosmetic" })
    check("a cosmetic rank is not in the order", ladder().some(r => r.id === "builder"), false)
    check("and weighs nothing", getRank("builder")?.weight, 0)

    grantRank(steve.id, "builder", steve.name)
    check("its tag shows after the rank tag", plain(renderTags(steve)), "[Mod] [Builder]")
    check("and it does not replace their rank", heldRankIds(steve.id).includes("mod"), true)

    grantRank(alex.id, "artist", alex.name)
    check("it does not replace the starting rank either", plain(renderTags(alex)), "[Member] [Artist]")

    saveRank("artist", { perms: ["warp.manage"] })
    check("a cosmetic rank gives no permissions, even ones written on it", has(alex, "warp.manage"), false)

    revokeRank(steve.id, "builder", steve.name)
    check("taking it away leaves only the rank", plain(renderTags(steve)), "[Mod]")

    grantRank(steve.id, "builder", steve.name)
    deleteRank("builder")
    check("deleting a cosmetic rank takes it off everyone", heldRankIds(steve.id).includes("builder"), false)
}

console.log("\n— unlisted ranks work without showing —")
{
    saveRank("secret", { display: "§7Secret", type: "unlisted", perms: ["warp.manage"] })
    grantRank(alex.id, "secret", alex.name)
    check("an unlisted rank's permissions apply", has(alex, "warp.manage"), true)
    check("but it shows no tag", plain(renderTags(alex)), "[Member] [Artist]")
    check("and the starting rank stays", heldRankIds(alex.id).includes("member"), true)
    check("it is not in the order", ladder().some(r => r.id === "secret"), false)
    revokeRank(alex.id, "secret", alex.name)
}

console.log("\n— old ranks read their type from the staff flag —")
{
    check("a staff rank from before types is Staff", rankType({ staff: true }), "staff")
    check("and any other is Default", rankType({ staff: false }), "default")
}

console.log("\n— a template keeps cosmetic and unlisted ranks —")
{
    saveRank("secret", { display: "§7Secret", type: "unlisted" })
    applyPreset("server")
    check("the cosmetic rank is still there", getRank("artist")?.type, "cosmetic")
    check("and the unlisted one", getRank("secret")?.type, "unlisted")
    setRanks(steve.id, ["mod"], steve.name)
}

console.log("\n— a new rank joins the order on a weight of its own —")
{
    saveRank("first", { display: "§aFirst" })
    saveRank("second", { display: "§aSecond" })
    const order = ladder().map(r => r.id)
    check("each new rank goes to the very bottom", order.slice(-2), ["first", "second"])
    const weights = ladder().map(r => r.weight)
    check("and no two ranks share a weight", new Set(weights).size, weights.length)
    deleteRank("first")
    deleteRank("second")
}

console.log("\n— rank tags can be switched off —")
{
    grantRank(steve.id, "artist", steve.name)
    setSetting("feature.ranktags", "false")
    check("with rank tags off, only cosmetic tags show", plain(renderTags(steve)), "[Artist]")
    check("and somebody with no cosmetic rank shows nothing at all", plain(renderTags(makePlayer("Nobody"))), "")
    setSetting("feature.tags", "false")
    check("with both off there is no tag", renderTags(steve), "")
    resetSetting("feature.tags")
    resetSetting("feature.ranktags")
    check("back on, both return", plain(renderTags(steve)), "[Mod] [Artist]")
    revokeRank(steve.id, "artist", steve.name)
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

console.log("\n— fonts: the player's own, then the rank's —")
{
    check("no font anywhere is Normal", nameFontFor(alex), "normal")

    saveRank("member", { font: "smallcaps", fontName: true, fontChat: false })
    check("a rank's font can go on its players' names", nameFontFor(alex), "smallcaps")
    check("names in templated lines use it", nameTokens(alex).NICKNAME, applyFont("Alex", "smallcaps"))
    check("but not their messages unless switched on", chatFontFor(alex), "normal")

    saveRank("member", { fontChat: true })
    check("switched on, messages use it too", chatFontFor(alex), "smallcaps")
    check("and the chat line shows it", formatChatLine(alex, "hi", undefined, false).includes(applyFont("hi", "smallcaps")), true)

    setNameFont(alex, "circled")
    check("the player's own font beats the rank's", nameFontFor(alex), "circled")
    setNameFont(alex, "normal")

    saveRank("member", { font: "normal", fontName: false, fontChat: false })
    saveRank("artist", { font: "tiny", fontName: true, fontChat: true })
    grantRank(alex.id, "artist", alex.name)
    check("a cosmetic rank's font never reaches names", nameFontFor(alex), "normal")
    check("or messages", chatFontFor(alex), "normal")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
