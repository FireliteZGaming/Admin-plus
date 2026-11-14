import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import {
    onPlayerJoin, setRanks, applyPreset, getRank, saveRank, has, chatNameFor,
    effectiveNameRamp, personalRamp, BASIC_PERMS, PERMISSION_NODES, nodeLabels
} from "../Admin+ BP/scripts/core/ranks.js"
import { getNameColours, setNameColours } from "../Admin+ BP/scripts/core/identity.js"
import { rampFrom, paint, currentFrame, STYLES } from "../Admin+ BP/scripts/core/nametag.js"
import { openMenu } from "../Admin+ BP/scripts/features/menu.js"
import { personalizeScreen, personalizeSettingsScreen, nameColoursScreen, canPersonalize, canChooseColours, nameEffectsOn, colourCodeFrom } from "../Admin+ BP/scripts/features/personalize.js"
import { PREFS, LOOKS, look, setLook } from "../Admin+ BP/scripts/core/prefs.js"
import { readFileSync } from "node:fs"
import { rankScreen, basicsScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
import { GROUPS, groupScreen } from "../Admin+ BP/scripts/features/settingsUI.js"
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
// The rows a menu offers, without its Back button.
const rowsOf = form => buttonsOf(form).filter(t => !plain(t).startsWith("< Back"))
const submit = (...formValues) => ({ canceled: false, formValues })
const press = selection => ({ canceled: false, selection })
// The game keeps a place in the answers for the form's label, so the boxes follow it.
const colours = (...boxes) => submit(undefined, ...boxes)
const NODE = "personalize.nameeffect"
const switchOn = rankId => saveRank(rankId, { perms: [...getRank(rankId).perms.filter(n => n !== NODE), NODE] })
const switchOff = rankId => saveRank(rankId, { perms: getRank(rankId).perms.filter(n => n !== NODE) })

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

console.log("\n— the Name effect switch, under Personalization —")
// 2.12.3, the user: "let's change it to 'Name Effect'". It was Name colour.
check("a rank's permissions have a Personalization section", Object.keys(PERMISSION_NODES).includes("Personalization"), true)
check("holding one switch", PERMISSION_NODES.Personalization, [NODE])
check("named Name effect", nodeLabels(PERMISSION_NODES.Personalization), ["Name effect"])
check("it isn't one of the basics everyone gets", BASIC_PERMS.includes(NODE), false)
check("so a member starts without it", has(pat, NODE), false)
check("an owner, holding everything, has it", has(boss, NODE), true)
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    // A rank's screen ▸ Permissions ▸ Member: the switch sits with What they can use.
    __ui.answers.push(press(1), press(0))
    await rankScreen(boss, "member", () => {})
    const member = __ui.shown[from + 2]
    check("Permissions ▸ Member lists Personalization, off",
        buttonsOf(member).map(plain).find(t => t.startsWith("Personalization")), "Personalization\nName effect · off")
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
    // 2.12.4: it opens on Settings, the player's own switches.
    check("Personalization opens on Settings, which says their rank hasn't switched name effects on",
        plain(buttonsOf(lastForm())[0]), "Settings\nName effects · not switched on for your rank")
    check("and offers no way to change a name effect", rowsOf(lastForm()).length, 1)
    __ui.answers.push(submit(undefined))
    await personalizeSettingsScreen(pat, () => {})
    const settings = lastForm()
    check("Settings says why instead of offering a switch that can't work",
        [settings.parts.some(p => p[0] === "toggle"), settings.parts.some(p => p[0] === "label" && plain(p[1]).includes(
            "Name effects aren't switched on for your rank. Staff can switch them on in Ranks ▸ your rank ▸ Permissions ▸ Member ▸ Personalization."))],
        [false, true])
    __ui.answers.length = 0
    await nameColoursScreen(pat, () => {})
    check("the colour boxes stay closed to them", [canChooseColours(pat), told(pat).startsWith("Name effects aren't switched on")], [false, true])
}

console.log("\n— Personalization ▸ Settings: their own Name effects switch —")
// 2.12.4, the user: "for name it'll be Name Effects as a toggle. If it's off
// you won't be able to see a way to change it until you turn it on. And this
// toggle is basicly like if you wanted to turn it on and off yourself, the
// rank settings give you the permission to do so."
{
    setBeta(true)
    switchOn("member")
    __ui.answers.length = 0
    await personalizeScreen(pat, () => {})
    check("with the rank switch, Settings shows their own switch, off to start", plain(buttonsOf(lastForm())[0]), "Settings\nName effects · off")
    check("and while it's off there's still no way to change it", rowsOf(lastForm()).length, 1)
    setNameColours(pat, ["c", "6"])
    check("colours saved while it's off don't show", effectiveNameRamp(pat), "")
    __ui.answers.push(submit(true))
    await personalizeSettingsScreen(pat, () => {})
    check("Settings has the Name effects switch",
        lastForm().parts.filter(p => p[0] === "toggle").map(p => plain(p[1]).split("\n")[0]), ["Name effects"])
    check("turning it on is kept", [look(pat, "name.effects"), nameEffectsOn(pat)], [true, true])
    check("and said", told(pat), "Name effects are on. Pick yours under Name effect.")
    check("their colours show now", effectiveNameRamp(pat), "cc66")
    await personalizeScreen(pat, () => {})
    check("and Name effect appears, to change them",
        rowsOf(lastForm()).map(t => plain(t).split("\n")[0]), ["Settings", "Name effect"])
    __ui.answers.push(submit(false))
    await personalizeSettingsScreen(pat, () => {})
    check("turning it off hides them again", [look(pat, "name.effects"), effectiveNameRamp(pat)], [false, ""])
    check("but keeps the colours for next time", getNameColours(pat), ["c", "6"])
    __ui.answers.length = 0
    await nameColoursScreen(pat, () => {})
    check("and the colour boxes say to turn it on first", told(pat), "Your name effects are off. Turn them on in Personalization ▸ Settings first.")
    __ui.answers.push(submit(false))
    await personalizeSettingsScreen(pat, () => {})
    check("saving with no change says so", told(pat), "Nothing changed.")
    check("it's Personalization's own, not one of My settings", Object.keys(PREFS).includes("name.effects"), false)
    for (const [key, spec] of Object.entries(LOOKS)) {
        const src = readFileSync(new URL(`../Admin+ BP/scripts/${spec.readBy}`, import.meta.url), "utf8")
        check(`${key} is actually read by ${spec.readBy}`, src.includes(`"${key}"`), true)
    }
    setLook(pat, "name.effects", true)
    setNameColours(pat, [])
}

console.log("\n— choosing colours, once both switches are on —")
{
    setBeta(true)
    switchOn("member")
    __ui.answers.length = 0
    const from = __ui.shown.length
    __ui.answers.push(press(1), colours("c", "§6", "", ""))
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

console.log("\n— in Beta a rank gives no name effect, only the switch —")
// 2.12.3, the user, seeing Name colour in a rank's Basics: "Wtf is name
// colour doing here? It's supposed to be a toggle thing ... in permissions
// under a personalization section". So in Beta a rank's saved style no
// longer shows; players pick their own. Default works as before.
{
    setBeta(true)
    saveRank("member", { meta: { ...(getRank("member").meta ?? {}), "nametag.style": "fire" } })
    setNameColours(pat, [])
    check("a style the rank saved on Default doesn't show in Beta", effectiveNameRamp(pat), "")
    setNameColours(pat, ["c", "6"])
    check("their own colours do", effectiveNameRamp(pat), "cc66")
    __ui.answers.push(colours("", "", "", ""))
    await nameColoursScreen(pat, () => {})
    check("all boxes empty turns them off", getNameColours(pat), [])
    check("and the name is plain again", effectiveNameRamp(pat), "")
    check("they're told it's off", told(pat), "Your name effect is off.")
    setNameColours(pat, ["c", "6"])
    switchOff("member")
    check("switched off for the rank, their colours stay saved but don't show", [getNameColours(pat), effectiveNameRamp(pat)], [["c", "6"], ""])
    switchOn("member")
    setBeta(false)
    check("on Default nobody's own colours show", personalRamp(pat), "")
    check("and a rank's effect works as before", effectiveNameRamp(pat), STYLES.fire.ramp)
    setBeta(true)
}

console.log("\n— a rank's Basics has no Name colour in Beta —")
{
    const nameColourIn = form => form.parts.some(p => p[0] === "dropdown" && plain(p[1]).startsWith("Name colour"))
    __ui.answers.length = 0
    setBeta(false)
    await basicsScreen(boss, "member", () => {})
    check("on Default, Basics still has the Name colour list", nameColourIn(lastForm()), true)
    setBeta(true)
    await basicsScreen(boss, "member", () => {})
    check("in Beta it's gone", nameColourIn(lastForm()), false)
    check("while chat colour stays", lastForm().parts.some(p => p[0] === "text" && plain(p[1]).startsWith("Chat colour")), true)

    // The server switch for them reads Name effects in Beta, and keeps its
    // Default words there.
    const names = GROUPS.find(g => g.id === "names")
    setBeta(false)
    await groupScreen(boss, names, () => {})
    check("on Default, Names and tags still says Name colours", buttonsOf(lastForm()).map(plain).some(t => t.startsWith("Name colours\n")), true)
    setBeta(true)
    await groupScreen(boss, names, () => {})
    // In Beta a group is one page in sections (2.12.7).
    const parts = lastForm().parts
    check("in Beta its section says Name effects", parts.some(p => p[0] === "label" && plain(p[1]) === "Name effects"), true)
    const toggle = parts.find(p => p[0] === "toggle" && plain(p[1]).startsWith("Name effects\n"))
    check("and its switch says players pick their own in /menu", plain(toggle?.[1]).includes("Players pick their own in /menu"), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
