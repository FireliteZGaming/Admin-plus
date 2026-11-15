import { readFileSync } from "fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { DEFAULTS, setting, setSetting, replaceOverrides, overrides, flag } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, onPlayerJoin, applyPreset as applyRankPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { readScript, writeScript } from "../Admin+ BP/scripts/core/jsconfig.js"
import { toScript, fromScript, codeScreen, toBlock } from "../Admin+ BP/scripts/features/code.js"
import { savePresetFromCurrent, deletePreset } from "../Admin+ BP/scripts/core/configPresets.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"

// < Code > written as JavaScript (2.12.7, Beta). The user kept < Code > and
// asked, 2026-11-13: "we actually make that JavaScript too, instead of how it is now".
// It is READ like JavaScript and never run: run, it could do anything, past
// every rank rule. core/jsconfig.js reads it; features/code.js saves it.

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
const dev = {
    id: "js-dev", name: "Dev", nameTag: "Dev", commandPermissionLevel: 1,
    getTags: () => ["Dev"], addTag: () => true, removeTag: () => true, sendMessage: m => said.push(String(m))
}
__test.players.push(dev)
onPlayerJoin(dev)
applyRankPreset("server")
setRanks(dev.id, ["owner"], dev.name)

const plain = s => String(s ?? "").replace(/§./g, "")
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const entries = text => readScript(text).entries?.map(e => [e.key, e.value])
const errorOf = text => readScript(text).error

console.log("\n— it reads the shape the settings take —")
{
    const doc = [
        "// a comment",
        "/* a comment",
        "   over two lines */",
        "const setup = \"camp\"",
        "let settings = {",
        "  spawn: { radius: 16, protect: true },",
        "  'format': { chat: '{NICKNAME}: {MSG}' },",
        "  filter: { terms: { sexual: `a, b` } },",
        "}",
        "settings.rtp.range = -500;",
        "var settings2 = 1".replace("var settings2 = 1", "")
    ].join("\n")
    const read = readScript(doc)
    check("no error", read.error, undefined)
    check("the setup", read.setup, { value: "camp", line: 4 })
    check("every setting as a dotted name", read.entries.map(e => [e.key, e.value]),
        [["spawn.radius", 16], ["spawn.protect", true], ["format.chat", "{NICKNAME}: {MSG}"], ["filter.terms.sexual", "a, b"], ["rtp.range", -500]])
    check("with the line each is on", read.entries.map(e => e.line), [6, 6, 7, 8, 10])
    check("commas between entries are optional", entries("settings = { a: 1\n b: 2 }"), [["a", 1], ["b", 2]])
    check("a comma after the last one is fine", entries("settings = { a: 1, }"), [["a", 1]])
    check("no const at all is fine", entries("settings = { a: false }"), [["a", false]])
    check("decimals and signs", entries("settings = { a: 0.5, b: +3, c: -.25, d: 1e3 }"), [["a", 0.5], ["b", 3], ["c", -0.25], ["d", 1000]])
    check("a list", entries("settings = { a: [0, 60, \"x\"] }"), [["a", [0, 60, "x"]]])
    check("the later of two wins", entries("settings = { a: 1 }\nsettings.a = 2").at(-1), ["a", 2])
    check("an empty settings is nothing", entries("const settings = {}"), [])
    check("names with dots in quotes", entries("settings = { \"feature.spawn\": false }"), [["feature.spawn", false]])
}

console.log("\n— text, exactly as written —")
{
    check("§ codes stay", entries("settings = { a: \"§8[\" }")[0][1], "§8[")
    check("\\\" and \\\\ are a quote and a backslash", entries("settings = { a: \"say \\\"hi\\\" \\\\ there\" }")[0][1], "say \"hi\" \\ there")
    check("\\n is a new line", entries("settings = { a: \"one\\ntwo\" }")[0][1], "one\ntwo")
    check("\\u00a7 is the section sign", entries("settings = { a: \"\\u00a7e\" }")[0][1], "§e")
    check("a space is a space", entries("settings = { a: \" \" }")[0][1], " ")
    check("a quote of the other kind is just a letter", entries("settings = { a: \"it's\" }")[0][1], "it's")
    check("braces inside text are text", entries("settings = { a: \"{OPEN}{RANK}{CLOSE}\" }")[0][1], "{OPEN}{RANK}{CLOSE}")
}

console.log("\n— a mistake names its line, and nothing is read —")
{
    check("text with no closing quote", errorOf("settings = {\n  a: \"open\n}"), "Line 2: a text value has no closing \" on its line.")
    check("a { never closed", errorOf("settings = {\n  a: 1"), "Line 1: this { is never closed with }.")
    check("a word that isn't a value", errorOf("settings = {\n\n  a: hello }"), "Line 3: hello isn't a value Admin+ can read. Text goes in quotes, like \"hello\".")
    check("null says how to go back to a default", errorOf("settings = { a: null }"), "Line 1: null isn't a value Admin+ can read. To put a setting back to its default, delete its line.")
    check("text left out of quotes", errorOf("settings = { a: §8[ }"), "Line 1: Admin+ can't read \"§\" here. Text goes in quotes.")
    check("a missing colon", errorOf("settings = { a 1 }"), "Line 1: expected : after a.")
    check("a missing equals", errorOf("settings { a: 1 }"), "Line 1: expected = after settings.")
    check("anything but setup and settings", errorOf("module.exports = {}"), "Line 1: Admin+ only reads setup = and settings = here, not module.exports.")
    check("settings that aren't in { }", errorOf("settings = 5"), "Line 1: settings = needs a { } around the settings.")
    check("a setup that isn't a name", errorOf("setup = 5"), "Line 1: setup is a setup's name in quotes, like \"defaults\".")
    check("an unclosed comment", errorOf("/* forever"), "Line 1: a /* comment is never closed with */.")
    check("filling in ${} in text", errorOf("settings = { a: `x${1}` }"), "Line 1: Admin+ doesn't fill in ${...} in text. Write the text out instead.")
    check("too deep", errorOf("settings = " + "{ a: ".repeat(12) + "1" + " }".repeat(12)).startsWith("Line 1: settings don't nest"), true)
    check("a list inside a list", errorOf("settings = { a: [[1]] }"), "Line 1: a list holds text, numbers, true or false.")
}

console.log("\n— nothing in it ever runs —")
{
    globalThis.__adminplusRan = undefined
    const attempts = [
        "settings = (function () { globalThis.__adminplusRan = true })()",
        "settings = { a: globalThis.__adminplusRan = true }",
        "settings = { a: eval(\"globalThis.__adminplusRan = true\") }",
        "globalThis.__adminplusRan = true",
        "settings = { a: `${globalThis.__adminplusRan = true}` }",
        "settings = { a: new Function(\"globalThis.__adminplusRan = true\") }"
    ]
    check("each is refused", attempts.map(text => typeof errorOf(text)), attempts.map(() => "string"))
    check("and none of them ran", globalThis.__adminplusRan, undefined)
    check("a name JavaScript treats specially can't be stored", fromScript("settings = { __proto__: { polluted: \"yes\" } }").error, "Line 1: __proto__.polluted can't be the name of a setting.")
    check("and nothing was polluted", ({}).polluted, undefined)
}

console.log("\n— the document Admin+ writes —")
{
    replaceOverrides({})
    setSetting("format.chat", "§b{NICKNAME} said \"{MSG}\"")
    setSetting("format.nameTag", "{TAG}\\n{NICKNAME}")
    const doc = toScript()
    check("starts by saying it never runs", doc.split("\n")[0], "// Admin+ settings, written as JavaScript. Admin+ reads it and never runs it.")
    check("is real JavaScript", (() => { try { new Function(doc); return true } catch { return false } })(), true)
    check("names the setup", doc.includes("const setup = \"custom\""), true)
    check("one heading per group", doc.includes("  // Formatting\n  format: {"), true)
    check("switches are true or false", doc.includes("    spawn: true,"), true)
    check("numbers are plain", doc.includes("    radius: 16,"), true)
    check("text is in quotes", doc.includes("    open: \"§8[\","), true)
    const back = fromScript(doc)
    check("it reads back without a mistake", [back.error, back.wrong.size, back.unknown.length], [undefined, 0, 0])
    check("every setting comes back as it is", Object.keys(DEFAULTS).filter(key => back.values.get(key) !== setting(key)), [])
    check("including the space between tags", back.values.get("format.tagJoin"), " ")
    check("and a quote inside a line", back.values.get("format.chat"), "§b{NICKNAME} said \"{MSG}\"")
    check("and a typed \\n", back.values.get("format.nameTag"), "{TAG}\\n{NICKNAME}")
    const RP = JSON.parse(readFileSync(new URL("../Admin+ RP/ui/server_form.json", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""))
    const cap = RP["custom_multiline_input@server_form.option_multiline_text_edit"].$max_text_edit_length
    check("it fits the editor", doc.length < cap, true)
    replaceOverrides({})
    check("with every setting at its default the setup is defaults", toScript().includes("const setup = \"defaults\""), true)
    check("writeScript puts a key that isn't a name in quotes", writeScript({ intro: [], setup: "x", setupNote: "", groups: [["G", [["a.b-c", 1]]]] }).includes("\"b-c\": 1,"), true)
}

console.log("\n— < Code > in Beta saves by the same rules as the block —")
{
    setBeta(true)
    replaceOverrides({})
    const save = async (text, ...more) => {
        __ui.answers.length = 0
        __ui.answers.push({ canceled: false, formValues: [text] }, ...more)
        said.length = 0
        await codeScreen(dev, () => {})
    }
    __ui.answers.length = 0
    await codeScreen(dev, () => {})
    const form = lastForm()
    const box = form.parts.find(p => p[0] === "text")
    check("it opens the JavaScript", String(box?.[3]?.defaultValue).startsWith("// Admin+ settings, written as JavaScript."), true)
    check("and says it never runs it", plain(box?.[1]).includes("Admin+ reads it and never runs it"), true)

    const doc = toScript()
    await save(doc)
    check("an unchanged document changes nothing", Object.keys(overrides()).filter(key => setting(key) !== DEFAULTS[key].value), [])

    await save(doc.replace("    radius: 16,", "    radius: 40,"))
    check("a changed value is saved", setting("spawn.radius"), "40")
    check("and logged so it can be undone", [recent(1)[0]?.action, recent(1)[0]?.undo?.kind], ["config.edit", "config"])

    await save(toScript().replace("    radius: 40,\n", ""))
    check("a deleted line goes back to its default", setting("spawn.radius"), "16")

    setSetting("spawn.radius", "24")
    await save(toScript().replace("    radius: 24,", "    radius: \"big\",").replace("    protect: false,", "    protect: true,"))
    check("a value of the wrong kind keeps what it had", setting("spawn.radius"), "24")
    check("while the rest saves", flag("spawn.protect"), true)
    check("and the screen names the line", said.some(m => /Line \d+: spawn\.radius is a number, like 16\./.test(plain(m))), true)

    setSetting("format.chat", "§a{NICKNAME}: {MSG}")
    await save(toScript().replace("§a{NICKNAME}: {MSG}", "{NICKNAME} has nothing to say"))
    check("a chat line without {MSG} keeps its own value, not the default", setting("format.chat"), "§a{NICKNAME}: {MSG}")

    const before = JSON.stringify(overrides())
    await save(toScript().replace("    radius: 24,", "    radius: 30\n    oops"))
    check("a mistake saves nothing", JSON.stringify(overrides()), before)
    check("and says so with the line", said.some(m => /Line \d+: /.test(plain(m)) && plain(m).includes("Nothing was saved")), true)

    await save("// Admin+ settings, written as JavaScript. const settings = { feature: { spawn: false } }")
    check("a box that came back as one line saves nothing", JSON.stringify(overrides()), before)
    check("and points at the resource pack", said.some(m => plain(m).includes("resource")), true)
    await save("")
    check("an empty box saves nothing", JSON.stringify(overrides()), before)

    await save(toScript().replace("const settings = {", "const settings = {\n  feature: { spwan: false },"))
    check("a group written twice saves nothing", JSON.stringify(overrides()), before)
    check("and names the line of the second", said.some(m => /Line \d+: feature is written twice in the same \{ \}\. Keep one of them\./.test(plain(m))), true)

    const typo = () => toScript().replace("  feature: {", "  feature: {\n    spwan: false,")
    await save(typo(), { canceled: false, selection: 0 })
    check("a name Admin+ doesn't use asks first, and No saves nothing", JSON.stringify(overrides()), before)
    await save(typo(), { canceled: false, selection: 1 })
    check("Yes saves it", overrides()["feature.spwan"], "false")

    // A saved setup named in the document loads, and a line changed in the
    // same edit still wins over it.
    replaceOverrides({})
    setSetting("teleport.warmup", "7")
    setSetting("presence.announce", "false")
    savePresetFromCurrent("quietcamp", "Quiet camp", "test")
    replaceOverrides({})
    await save(toScript().replace("const setup = \"defaults\"", "const setup = \"quietcamp\"").replace("    tpa: true,", "    tpa: false,"))
    check("the setup loads", [setting("teleport.warmup"), setting("presence.announce")], ["7", "false"])
    check("with the changed line on top", flag("feature.tpa"), false)
    check("and it says so", said.some(m => plain(m).includes("Loaded the Quiet camp setup")), true)

    await save(toScript().replace(/const setup = "[^"]*"/, "const setup = \"defaults\""))
    check("defaults puts every setting back", Object.keys(DEFAULTS).filter(key => setting(key) !== DEFAULTS[key].value), [])

    const kept = JSON.stringify(overrides())
    await save(toScript().replace(/const setup = "[^"]*"/, "const setup = \"nope\""))
    check("a setup that doesn't exist saves nothing", JSON.stringify(overrides()), kept)
    check("and lists the ones that do", said.some(m => plain(m).includes("no saved setup called \"nope\"") && plain(m).includes("defaults, quietcamp")), true)
    deletePreset("quietcamp")

    // Since 2.12.10 < Code > is JavaScript with either menus; the old
    // key = value block is kept in code.js but nothing opens it.
    setBeta(false)
    __ui.answers.length = 0
    await codeScreen(dev, () => {})
    check("< Code > is JavaScript with Minecraft's menus too", String(lastForm().parts.find(p => p[0] === "text")?.[3]?.defaultValue).includes("const settings"), true)
    setBeta(true)
}

replaceOverrides({})
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
