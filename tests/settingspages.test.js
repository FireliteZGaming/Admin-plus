import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { DEFAULTS, setting, setSetting, resetSetting, replaceOverrides, flag } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, onPlayerJoin, applyPreset as applyRankPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { GROUPS, settingsScreen, groupScreen, pageScreen } from "../Admin+ BP/scripts/features/settingsUI.js"
import { CHECK_PAGES, automodScreen } from "../Admin+ BP/scripts/features/automod.js"
import { WORD_FIELDS, HOLD_FIELD, screeningScreen } from "../Admin+ BP/scripts/features/automodUI.js"
import { BOT_FIELDS } from "../Admin+ BP/scripts/features/bots.js"
import { openPanel } from "../Admin+ BP/scripts/features/panel.js"
import { configPresetsScreen, kindOf, submittedValue, previewLine, fromBlock, toBlock } from "../Admin+ BP/scripts/features/code.js"
import { savePresetFromCurrent, deletePreset } from "../Admin+ BP/scripts/core/configPresets.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { COLOUR_CODE_TIP } from "../Admin+ BP/scripts/core/theme.js"

// The Server settings overhaul (2.12.7, Beta). The user, 2026-11-13: "it just
// feels like an absurd list of buttons that can be edited, which is what
// confuses people and is what would need an Overhaul". So in Beta each
// Settings group is ONE page in sections, the settings only Every setting
// could reach sit on the page they belong to, Every setting is gone, and
// Vanilla is "Back to defaults". Default stays as it was.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const BETA_ITEM = { id: "adminplus:channel_beta" }
function setBeta(on) {
    const at = __test.itemTypes.indexOf(BETA_ITEM)
    if (on && at < 0) __test.itemTypes.push(BETA_ITEM)
    if (!on && at >= 0) __test.itemTypes.splice(at, 1)
}

const said = []
const boss = {
    id: "sp-boss", name: "Boss", nameTag: "Boss", commandPermissionLevel: 1,
    getTags: () => ["Dev"], addTag: () => true, removeTag: () => true, sendMessage: m => said.push(String(m))
}
__test.players.push(boss)
onPlayerJoin(boss)
applyRankPreset("server")
setRanks(boss.id, ["owner"], boss.name)

const plain = s => String(s ?? "").replace(/§./g, "")
const firstLine = s => plain(s).split("\n")[0]
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const press = selection => ({ canceled: false, selection })
const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => firstLine(p[1]))
const INPUTS = ["toggle", "slider", "text", "dropdown"]
const fieldParts = form => form.parts.filter(p => !["title", "submit", "body", "button"].includes(p[0]))
const inputsOf = form => fieldParts(form).filter(p => INPUTS.includes(p[0]))
const sectionsOf = form => form.parts.filter(p => p[0] === "label" && String(p[1]).startsWith("§l")).map(p => firstLine(p[1]))
function defaultOf(part) {
    switch (part[0]) {
        case "toggle": return !!part[2]?.defaultValue
        case "slider": return part[4]?.defaultValue
        case "text": return part[3]?.defaultValue ?? ""
        case "dropdown": return part[3]?.defaultValueIndex ?? 0
        default: return undefined
    }
}
/** Every answer the form would send back unchanged, with `changes` (by label) applied. */
const answersFor = (form, changes = {}) =>
    fieldParts(form).map(p => INPUTS.includes(p[0]) && firstLine(p[1]) in changes ? changes[firstLine(p[1])] : defaultOf(p))
const submit = formValues => ({ canceled: false, formValues })

/** Open a form once to read it, then again with these answers. */
async function fill(open, changes) {
    __ui.answers.length = 0
    await open()
    const form = lastForm()
    __ui.answers.push(submit(answersFor(form, changes)))
    said.length = 0
    await open()
    return form
}

const group = id => GROUPS.find(g => g.id === id)

console.log("\n— every setting has one home in Beta —")
{
    const screening = ["filter.enabled", "filter.discrimination", "filter.sexual", "filter.aggression", "filter.profanity", "filter.action", "filter.muteSeconds", "filter.staffBypass"]
    const homes = [
        ...GROUPS.flatMap(g => g.pages.flatMap(p => p.fields.map(f => f.key))),
        ...Object.values(CHECK_PAGES).flatMap(page => page.fields.map(f => f.key)),
        ...screening,
        ...WORD_FIELDS.map(f => f.key), HOLD_FIELD.key,
        ...BOT_FIELDS.map(f => f.key)
    ]
    const nowhere = Object.keys(DEFAULTS).filter(key => !homes.includes(key))
    // The three technical ones stay in < Code > alone, on purpose.
    check("all but three are on a page", nowhere.sort(), ["creator.console", "creator.identity", "ranks.permissionEditor"])
    check("and none is on two", homes.length, new Set(homes).size)
    check("no page names a setting that doesn't exist", homes.filter(key => !(key in DEFAULTS)), [])
    const fields = [...Object.values(CHECK_PAGES).flatMap(page => page.fields), HOLD_FIELD]
    check("every automod slider can show its shipped value", fields.filter(f => f.kind === "slider").filter(f => {
        const v = Number(DEFAULTS[f.key].value)
        return !(v >= f.min && v <= f.max) || (v - f.min) % f.step !== 0
    }).map(f => f.key), [])
}

console.log("\n— Minecraft's menus get the same pages (2.12.10) —")
{
    setBeta(true)
    __ui.answers.length = 0
    await groupScreen(boss, group("chat"), () => {})
    const styled = inputsOf(lastForm()).map(p => p[0])
    setBeta(false)
    await groupScreen(boss, group("chat"), () => {})
    check("Chat is the same one page with either menus", inputsOf(lastForm()).map(p => p[0]), styled)
    setBeta(true)
}

console.log("\n— in Beta a group is one page in sections —")
{
    setBeta(true)
    __ui.answers.length = 0
    await groupScreen(boss, group("chat"), () => {})
    const chat = lastForm()
    check("Chat opens as one form", chat.parts.some(p => p[0] === "button"), false)
    check("a section per thing in it", sectionsOf(chat), ["Admin+ chat", "Chat lines", "Chat rooms", "Private messages", "Emotes", "Join and leave"])
    check("with a divider before each", chat.parts.filter(p => p[0] === "divider").length, 6)
    check("and a Save button", chat.parts.find(p => p[0] === "submit")?.[1], "Save")
    const chatLine = inputsOf(chat).find(p => firstLine(p[1]) === "Chat line")
    check("how a chat line looks is in Chat", chatLine?.[0], "text")
    check("its box holds the line as it is", chatLine?.[3]?.defaultValue, setting("format.chat"))
    check("with the colour-code tip", chatLine?.[3]?.tooltip, COLOUR_CODE_TIP)
    check("the words in braces are explained", plain(chat.parts.find(p => p[0] === "label" && plain(p[1]).startsWith("Chat lines"))?.[1]).includes("{NICKNAME} is the display name"), true)
    check("the preview fills in every token", /\{[A-Z]+\}/.test(plain(chat.parts.find(p => p[0] === "label")?.[1])), false)

    await groupScreen(boss, group("moderation"), () => {})
    const moderation = inputsOf(lastForm()).map(p => firstLine(p[1]))
    check("Moderation holds how many log lines are kept", ["Chat lines kept", "Commands kept"].every(l => moderation.includes(l)), true)
    check("and what lag clear never clears", moderation.includes("Items it never clears"), true)
    check("and the staff action line", moderation.includes("Staff action line"), true)

    await groupScreen(boss, group("names"), () => {})
    const names = lastForm()
    check("Names and tags has Badges as a section", sectionsOf(names).includes("Badges"), true)
    check("and the brackets under Rank tags", inputsOf(names).map(p => firstLine(p[1])).filter(l => l.endsWith("bracket")), ["Opening bracket", "Closing bracket"])

    await settingsScreen(boss, () => {})
    check("Settings in Beta has the way to the chat rooms", buttonsOf(lastForm()).includes("Manage chat rooms"), true)
}

console.log("\n— saving the one page —")
{
    setBeta(true)
    replaceOverrides({})
    await fill(() => groupScreen(boss, group("chat"), () => {}), {})
    check("an unchanged page writes nothing", setting("format.tagJoin") === " " && Object.keys(DEFAULTS).every(k => setting(k) === DEFAULTS[k].value), true)
    check("and says so", said.some(m => plain(m).includes("Nothing changed")), true)

    await fill(() => groupScreen(boss, group("chat"), () => {}), { "Chat line": "§b{NICKNAME}§7: {MSG}", "Emotes": false })
    check("a changed line is saved", setting("format.chat"), "§b{NICKNAME}§7: {MSG}")
    check("and a switch on the same page", flag("feature.emote"), false)
    const entry = recent(1)[0]
    check("it goes in the log as a settings change", entry?.action, "config.edit")
    check("that can be undone", entry?.undo?.kind, "config")

    await fill(() => groupScreen(boss, group("chat"), () => {}), { "Chat line": "{NICKNAME} says hello" })
    check("a line without {MSG} is kept as it was", setting("format.chat"), "§b{NICKNAME}§7: {MSG}")
    check("and the screen says why", said.some(m => plain(m).includes("Chat line: kept as it was, because it needs {MSG}")), true)

    // The gap between rank tags is one space: an unchanged save keeps it.
    await fill(() => groupScreen(boss, group("names"), () => {}), { "Opening bracket": "§7(" })
    check("a bracket is saved", setting("bracket.open"), "§7(")
    check("and the space between tags survives", setting("format.tagJoin"), " ")
    await fill(() => groupScreen(boss, group("names"), () => {}), { "Between two tags": "" })
    check("emptying it puts tags side by side", setting("format.tagJoin"), "")

    await fill(() => groupScreen(boss, group("moderation"), () => {}), { "Chat lines kept": 400 })
    check("a moved slider is saved", setting("logs.chatCap"), "400")

    // A reply with the wrong number of answers saves nothing.
    __ui.answers.length = 0
    await groupScreen(boss, group("chat"), () => {})
    __ui.answers.push(submit([true, false]))
    said.length = 0
    await groupScreen(boss, group("chat"), () => {})
    check("a short reply saves nothing", flag("feature.emote"), false)
    check("and says to try again", said.some(m => plain(m).includes("Not every setting came back")), true)
    replaceOverrides({})
}

console.log("\n— Automod in Beta —")
{
    setBeta(true)
    await fill(() => automodScreen(boss, () => {}), {})
    const checks = lastForm()
    check("a section per check (chat flooding is on hold)", sectionsOf(checks), ["Ore alerts", "Fast breaking"])
    check("ore alerts carry their numbers", inputsOf(checks).map(p => firstLine(p[1])).slice(0, 4),
        ["Ore alerts", "Blocks apart that still count as one vein", "Seconds with no new find before a vein is reported", "Ores it watches, and how big a vein alerts"])
    await fill(() => automodScreen(boss, () => {}), { "Blocks a second before it flags": 40, "Ore alerts": false })
    check("a moved number is saved", setting("automod.breakRate"), "40")
    check("and a switch beside it", flag("automod.ores"), false)
    check("logged as an automod change that can be undone", [recent(1)[0]?.action, recent(1)[0]?.undo?.kind], ["automod.config", "config"])

    await fill(() => screeningScreen(boss, () => {}), { "Sexual content words": "word1, word2", "Held messages kept": 100 })
    const screening = lastForm()
    check("Chat screening holds the word lists", sectionsOf(screening), ["What it looks for", "Words", "What it costs", "Held messages"])
    check("a word list is saved", setting("filter.terms.sexual"), "word1, word2")
    check("and how many held messages are kept", setting("filter.holdCap"), "100")
    check("Discrimination points below, not to Every setting", plain(inputsOf(screening).find(p => firstLine(p[1]) === "Discrimination")?.[1]).includes("Add your own below"), true)
    replaceOverrides({})

    setBeta(false)
    __ui.answers.length = 0
    await automodScreen(boss, () => {})
    check("Minecraft's menus get the Checks pages too", inputsOf(lastForm()).length > 2, true)
    setBeta(true)
}

console.log("\n— Advanced and Saved setups in Beta —")
{
    const advanced = async () => {
        __ui.answers.length = 0
        await openPanel(boss)
        const serverAt = buttonsOf(lastForm()).indexOf("Server")
        __ui.answers.push(press(serverAt))
        await openPanel(boss)
        const advancedAt = buttonsOf(lastForm()).indexOf("Advanced")
        __ui.answers.push(press(serverAt), press(advancedAt))
        await openPanel(boss)
        return buttonsOf(lastForm())
    }
    setBeta(false)
    check("Minecraft's menus have no Every setting either", (await advanced()).includes("Every setting"), false)
    setBeta(true)
    check("Beta's Advanced: setups, < Code > and reset", await advanced(), ["Saved setups", "< Code >", "Factory reset", "< Back"])

    replaceOverrides({})
    __ui.answers.length = 0
    await configPresetsScreen(boss, () => {})
    check("Vanilla shows as Back to defaults", buttonsOf(lastForm())[0], "Back to defaults")
    check("and the setup in force is called Defaults", plain(lastForm().parts.find(p => p[0] === "body")?.[1]).includes("Currently: Defaults"), true)

    said.length = 0
    __ui.answers.push(press(0))
    await configPresetsScreen(boss, () => {})
    check("with nothing changed, it says so", said.some(m => plain(m).includes("already at its default")), true)

    setSetting("spawn.radius", "40")
    setSetting("feature.tpa", "false")
    __ui.answers.push(press(0), { canceled: false, selection: 1 })
    await configPresetsScreen(boss, () => {})
    const asked = [...__ui.shown].reverse().find(form => plain(form.parts.find(p => p[0] === "title")?.[1]).includes("Back to defaults"))
    check("it asks first, counting what changes", plain(asked?.parts.find(p => p[0] === "body")?.[1]).includes("all 2 changed settings"), true)
    check("both settings went back", [setting("spawn.radius"), flag("feature.tpa")], [DEFAULTS["spawn.radius"].value, true])
    check("logged as a way back that can be undone", [recent(1)[0]?.action, recent(1)[0]?.undo?.kind], ["config.preset", "config"])

    setBeta(false)
    __ui.answers.length = 0
    await configPresetsScreen(boss, () => {})
    check("Minecraft's menus call it Back to defaults too", String(buttonsOf(lastForm())[0]).startsWith("Back to defaults"), true)
    setBeta(true)
}

console.log("\n— a setting that starts as a space is text —")
{
    // Number(" ") is 0, so the gap between rank tags read as a number and
    // every save of it said "Not a number" (fixed in 2.12.7).
    check("format.tagJoin is text", kindOf("format.tagJoin"), "text")
    check("an unchanged space comes back a space", submittedValue("format.tagJoin", " ").text, " ")
    check("and is never reported as not a number", submittedValue("format.tagJoin", " ").rejected, false)
    check("other text is still trimmed", submittedValue("format.broadcast", "  §e{MSG}  ").text, "§e{MSG}")
    const line = toBlock().split("\n").find(l => l.startsWith("format.tagJoin"))
    check("the block can't show the space, so it reads back empty", fromBlock(line).values["format.tagJoin"], "")
}

console.log("\n— the chat preview fills in every token —")
{
    replaceOverrides({})
    // It used to replace four tokens by hand, so {BADGE} and {NICKNAME} showed as written.
    check("no token left in it", /\{[A-Z]+\}/.test(previewLine()), false)
    check("it shows the name and the message", plain(previewLine()).includes("Steve") && plain(previewLine()).endsWith("hello"), true)
}

setBeta(false)
replaceOverrides({})
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
