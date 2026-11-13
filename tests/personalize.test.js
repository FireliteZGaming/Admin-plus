import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import {
    onPlayerJoin, setRanks, applyPreset, getRank, saveRank, has, chatNameFor,
    effectiveNameRamp, personalRamp, BASIC_PERMS, PERMISSION_NODES, nodeLabels
} from "../Admin+ BP/scripts/core/ranks.js"
import { getNameColours, setNameColours } from "../Admin+ BP/scripts/core/identity.js"
import { rampFrom, paint, currentFrame, STYLES } from "../Admin+ BP/scripts/core/nametag.js"
import { openMenu } from "../Admin+ BP/scripts/features/menu.js"
import { personalizeScreen, nameColoursScreen, canPersonalize, canChooseColours, colourCodeFrom } from "../Admin+ BP/scripts/features/personalize.js"
import { rankScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
import { stepNameAnimation } from "../Admin+ BP/scripts/features/nameanim.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// /menu ▸ Personalization (2.12.0, the user's idea, 2026-11-13). Open to
// everyone; choosing name colours (up to four, typed into boxes) needs the
// rank's own Name colour switch, under Personalization, which starts off:
// "its rank specific for the color shift, so it would have to be turned on
// for the rank".

const BETA_ITEM = { id: "adminplus:channel_beta" }
function setBeta(on) {
    const at = __test.itemTypes.indexOf(BETA_ITEM)
    if (on && at < 0) __test.itemTypes.push(BETA_ITEM)
    if (!on && at >= 0) __test.itemTypes.splice(at, 1)
}
function player(id, name, ranks) {
    const p = { id, name, nameTag: name, commandPermissionLevel: 0, said: [], getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: t => p.said.push(t) }
    __test.players.push(p)
    onPlayerJoin(p)
    setRanks(p.id, ranks, p.name)
    return p
}
const plain = s => String(s ?? "").replace(/§./g, "")
// What a player was told, without the [Admin+] in front.
const told = p => plain(p.said.at(-1)).replace(/^\[Admin\+\] /, "")
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => p[1])
const submit = (...formValues) => ({ canceled: false, formValues })
const press = selection => ({ canceled: false, selection })
// The game keeps a place in the answers for the form's label, so the boxes follow it.
const colours = (...boxes) => submit(undefined, ...boxes)
const switchOn = rankId => saveRank(rankId, { perms: [...getRank(rankId).perms.filter(n => n !== "personalize.namecolour"), "personalize.namecolour"] })
const switchOff = rankId => saveRank(rankId, { perms: getRank(rankId).perms.filter(n => n !== "personalize.namecolour") })

applyPreset("server")
const pat = player("prs-pat", "Pat", ["member"])
const boss = player("prs-boss", "Boss", ["owner"])

console.log("\n— the colours become a wave —")
check("none is nothing", rampFrom([]), "")
check("one colour is a still name", rampFrom(["b"]), "b")
check("two shift back and forth in pairs", rampFrom(["c", "6"]), "cc66")
check("three run up and back down", rampFrom(["c", "6", "e"]), "cc66ee66")
check("four too", rampFrom(["a", "b", "c", "d"]), "aabbccddccbb")
check("at most four", rampFrom(["a", "b", "c", "d", "e"]), rampFrom(["a", "b", "c", "d"]))
check("bold and the like aren't colours", rampFrom(["l", "c"]), "c")
check("a typed colour can be the letter, or the sign and the letter",
    ["c", "§C", " 6 ", "g", "x", "l", "cc", ""].map(colourCodeFrom), ["c", "c", "6", "g", "", "", "", ""])

console.log("\n— the Name colour switch, under Personalization —")
check("a rank's permissions have a Personalization section", Object.keys(PERMISSION_NODES).includes("Personalization"), true)
check("holding one switch", PERMISSION_NODES.Personalization, ["personalize.namecolour"])
check("named Name colour", nodeLabels(PERMISSION_NODES.Personalization), ["Name colour"])
check("it isn't one of the basics everyone gets", BASIC_PERMS.includes("personalize.namecolour"), false)
check("so a member starts without it", has(pat, "personalize.namecolour"), false)
check("an owner, holding everything, has it", has(boss, "personalize.namecolour"), true)
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    // A rank's screen ▸ Permissions ▸ Member: the switch sits with What they can use.
    __ui.answers.push(press(1), press(0))
    await rankScreen(boss, "member", () => {})
    const member = __ui.shown[from + 2]
    check("Permissions ▸ Member lists Personalization, off",
        buttonsOf(member).map(plain).find(t => t.startsWith("Personalization")), "Personalization\nName colour · off")
}

console.log("\n— /menu, in Beta, for everyone —")
{
    setBeta(false)
    __ui.answers.length = 0
    await openMenu(pat)
    check("not on Default", buttonsOf(lastForm()).some(t => plain(t).includes("Personalization")), false)
    setBeta(true)
    await openMenu(pat)
    check("on Beta, everyone has it, switch or not", [canPersonalize(pat), buttonsOf(lastForm()).some(t => plain(t).includes("Personalization"))], [true, true])
    await personalizeScreen(pat, () => {})
    check("without the switch, Name colours shows but says why it's off",
        plain(buttonsOf(lastForm())[0]), "Name colours\nNot switched on for your rank")
    __ui.answers.push(press(0))
    await personalizeScreen(pat, () => {})
    check("and tapping it says where staff switch it on", told(pat),
        "Name colours aren't switched on for your rank. Staff can switch them on in Ranks ▸ your rank ▸ Permissions ▸ Member ▸ Personalization.")
    __ui.answers.length = 0
    await nameColoursScreen(pat, () => {})
    check("the colour boxes stay closed to them", [canChooseColours(pat), told(pat).startsWith("Name colours aren't switched on")], [false, true])
}

console.log("\n— choosing colours, once the rank has the switch —")
{
    setBeta(true)
    switchOn("member")
    __ui.answers.length = 0
    const from = __ui.shown.length
    __ui.answers.push(press(0), colours("c", "§6", "", ""))
    await personalizeScreen(pat, () => {})
    const form = __ui.shown[from + 1]
    check("four boxes", form.parts.filter(p => p[0] === "text").map(p => plain(p[1])), ["Colour 1", "Colour 2", "Colour 3", "Colour 4"])
    check("under the codes, each in its colour", form.parts.some(p => p[0] === "label" && String(p[1]).includes("§c§§c")), true)
    check("and the button says Save", form.parts.find(p => p[0] === "submit")?.[1], "Save")
    check("two colours are kept, empty boxes skipped", getNameColours(pat), ["c", "6"])
    check("the name shifts through them", effectiveNameRamp(pat), "cc66")
    check("above their head", pat.nameTag.includes(paint("Pat", "cc66", currentFrame())), true)
    check("chat shows one still frame", chatNameFor(pat, "Pat"), paint("Pat", "cc66", 0))
    check("and they're told how it looks", told(pat), "Your name now shifts through 2 colours: Pat.")
    check("the animation moves a name with two or more colours", stepNameAnimation([pat]), 1)

    __ui.answers.push(colours("b", "", "", ""))
    await nameColoursScreen(pat, () => {})
    check("one colour is a still name", [effectiveNameRamp(pat), stepNameAnimation([pat])], ["b", 0])

    const before = __ui.shown.length
    __ui.answers.push(colours("c", "x", "", ""))
    await nameColoursScreen(pat, () => {})
    check("a box that isn't a colour changes nothing", getNameColours(pat), ["b"])
    check("says which box", told(pat), "Colour 2 isn't a colour code. Type one of the codes shown, like c.")
    const again = __ui.shown[before + 1]
    check("and asks again with what was typed", again?.parts.filter(p => p[0] === "text").map(p => p[3]?.defaultValue), ["c", "x", "", ""])
}

console.log("\n— their own colours, their rank's effect, and the switch —")
{
    saveRank("member", { meta: { ...(getRank("member").meta ?? {}), "nametag.style": "fire" } })
    setNameColours(pat, ["c", "6"])
    check("their own colours win over the rank's effect", effectiveNameRamp(pat), "cc66")
    __ui.answers.push(colours("", "", "", ""))
    await nameColoursScreen(pat, () => {})
    check("all boxes empty turns them off", getNameColours(pat), [])
    check("and the rank's effect shows again", effectiveNameRamp(pat), STYLES.fire.ramp)
    setNameColours(pat, ["c", "6"])
    switchOff("member")
    check("switched off for the rank, their colours stay saved but don't show", [getNameColours(pat), effectiveNameRamp(pat)], [["c", "6"], STYLES.fire.ramp])
    switchOn("member")
    setBeta(false)
    check("and on Default nobody's own colours show", personalRamp(pat), "")
    setBeta(true)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
