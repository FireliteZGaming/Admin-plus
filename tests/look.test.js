import { readFileSync, existsSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setRanks, onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { BETA_LOOK, TILES, TILE_LEFT, lift, lookTitle, tile, tileIcon, tileText, betaLook } from "../Admin+ BP/scripts/core/look.js"
import { MULTILINE, hubTitle, hubButton, BRAND_PREFIX, COLOUR_CODE_TIP } from "../Admin+ BP/scripts/core/theme.js"
import { menu, modal, confirm, drawsTiles } from "../Admin+ BP/scripts/core/ui.js"
import { openPanel } from "../Admin+ BP/scripts/features/panel.js"
import { openMenu } from "../Admin+ BP/scripts/features/menu.js"
import { panelsOf, shownFor, evaluate, visibleExpr } from "./jsonui.js"

// Admin+'s own look, the UI overhaul (2.11.0). The user approved the concept on
// 2026-11-13: "Yes the UI is perfect, we can start on that." It ships in Beta:
// scripts mark a form's title only when the pack settings slider is on Beta,
// and the resource pack draws a marked form in Admin+'s own frame.
//
// As with the multi-line editor, the script and the pack agree on strings
// across two files in two languages, and nothing at runtime reports a
// disagreement: the form just opens in the game's look. This file is that
// report.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const RP = new URL("../Admin+ RP/", import.meta.url)
const BP = new URL("../Admin+ BP/scripts/", import.meta.url)
const FORM = JSON.parse(readFileSync(new URL("ui/server_form.json", RP), "utf8"))
const LOOK = JSON.parse(readFileSync(new URL("ui/adminplus_beta.json", RP), "utf8"))
const DEFS = JSON.parse(readFileSync(new URL("ui/_ui_defs.json", RP), "utf8"))
const TEXTURES = new URL("textures/ui/adminplus/", RP)
const textureExists = path => existsSync(new URL(`${path.replace(/^textures\/ui\/adminplus\//, "")}.png`, TEXTURES))

const BETA_ITEM = { id: "adminplus:channel_beta" }
function setBeta(on) {
    const at = __test.itemTypes.indexOf(BETA_ITEM)
    if (on && at < 0) __test.itemTypes.push(BETA_ITEM)
    if (!on && at >= 0) __test.itemTypes.splice(at, 1)
}

const lastForm = () => __ui.shown[__ui.shown.length - 1]
const partsOf = (form, kind) => form.parts.filter(p => p[0] === kind)
const titleOf = form => partsOf(form, "title")[0]?.[1]

// The chest grid's own markers (Admin+ RP/ui/adminplus_ui.json, server_form.json).
const CHEST = ["§m§c§e", "§t§r§a§d§e", "§c§h§e§s§t§s§m§a§l§l", "§s§h§o§p§c§h§e§s§t", "§b§i§g§c§h§e§s§t"]

console.log("\n— the markers print nothing and restyle nothing —")
// Bedrock eats "§" plus one character, so a string of those pairs draws
// nothing. Every letter is a colour code: bold (l), italic (o), obfuscated (k)
// or reset (r) would change how the title is drawn.
for (const [name, marker] of [["BETA_LOOK", BETA_LOOK], ["TILES", TILES]]) {
    check(`${name} is nothing but section-sign pairs`, /^(?:§.)+$/.test(marker) && marker.length > 0, true)
    check(`${name} uses colour codes only`, [...marker.matchAll(/§(.)/g)].every(m => "0123456789abcdefghijmnpqstuv".includes(m[1])), true)
    check(`lifting leaves ${name} alone`, lift(marker), marker)
}
check("the two are different", BETA_LOOK === TILES, false)

console.log("\n— lifting reads codes the way the game does —")
// The game reads "§" plus the next character as one code, left to right, so
// "§§" is a code that hides itself. The rank editor's row of codes is written
// "§0§§0 §1§§1 ...": each code, then "§§" to hide nothing, then its letter.
// A first version of lift() turned that row's 0 into f and its 8 into 7, seen
// on the phone page on 2026-11-13.
check("dark grey and black are lifted", lift("§8Most never need it. §0Black"), "§7Most never need it. §fBlack")
check("a code shown off in its own colour keeps it", lift("§0§§0 §1§§1 §8§§8 §f§§f"), "§0§§0 §1§§1 §8§§8 §f§§f")
check("the letter after §§ is never read as a code", lift("§§8 and §§0"), "§§8 and §§0")
check("a § at the very end is left alone", lift(COLOUR_CODE_TIP), COLOUR_CODE_TIP)
check("other colours are untouched", lift("§cRed §7grey §eyellow"), "§cRed §7grey §eyellow")
// Markers are matched as text inside the whole title. Placed side by side,
// they must not spell out somebody else's.
const ours = { MULTILINE, BETA_LOOK, TILES }
for (const parts of [["BETA_LOOK", "TILES"], ["MULTILINE", "BETA_LOOK"], ["MULTILINE", "BETA_LOOK", "TILES"]]) {
    const joined = parts.map(p => ours[p]).join("")
    const others = [...Object.entries(ours).filter(([name]) => !parts.includes(name)).map(([, m]) => m), ...CHEST]
    check(`${parts.join(" + ")} spells no other marker`, others.filter(m => joined.includes(m)), [])
}

console.log("\n— the pack draws one look per menu title —")
{
    const panels = panelsOf(FORM.long_form.controls)
    check("four ways to draw a menu", panels.map(p => p.name), ["long_form", "adminplus_ui", "beta_list", "beta_tiles"])
    const plain = hubTitle("ranks", "Staff panel")
    for (const [what, title, expected] of [
        ["a plain title", plain, "long_form"],
        ["a chest grid", "Inventory§m§c§e", "adminplus_ui"],
        ["a Beta title", lookTitle(plain), "beta_list"],
        ["a Beta title asking for tiles", lookTitle(plain, { tiles: true }), "beta_tiles"],
        ["a chest grid that somehow carries the Beta marker", "Inventory§m§c§e" + BETA_LOOK, "adminplus_ui"]
    ]) {
        check(`${what}: ${expected} and nothing else`, shownFor(panels, title), [expected])
    }
    check("each Beta menu is drawn in Admin+'s own frame",
        panels.filter(p => p.name.startsWith("beta_")).map(p => p.base), ["adminplus_beta.list_form", "adminplus_beta.tile_form"])
}

console.log("\n— the Beta frames are all there —")
{
    check("the pack loads the file", DEFS.ui_defs.includes("ui/adminplus_beta.json"), true)
    check("under its own namespace", LOOK.namespace, "adminplus_beta")
    const defined = new Set(Object.keys(LOOK).map(k => k.split("@")[0]))
    const text = JSON.stringify(LOOK) + JSON.stringify(FORM)
    const used = [...new Set([...text.matchAll(/adminplus_beta\.(\w+)/g)].map(m => m[1]))]
    check("every adminplus_beta control that is used is defined", used.filter(n => !defined.has(n)), [])
    // The look leans on two of our own server_form controls, and on vanilla's
    // custom_form_panel, which the game ships.
    const formDefined = new Set(Object.keys(FORM).map(k => k.split("@")[0]))
    const fromForm = [...new Set([...JSON.stringify(LOOK).matchAll(/server_form\.(\w+)/g)].map(m => m[1]))]
    check("the server_form controls it uses are ours or the game's own custom_form_panel",
        fromForm.filter(n => !formDefined.has(n) && n !== "custom_form_panel"), [])
    const textures = [...new Set([...JSON.stringify(LOOK).matchAll(/textures\/ui\/adminplus\/\w+/g)].map(m => m[0]))]
    check("it uses our own textures", textures.length > 0, true)
    check("and every one of them is in the pack", textures.filter(t => !textureExists(t)), [])
    check("no game texture is referenced by a path we don't ship",
        [...JSON.stringify(LOOK).matchAll(/"(textures\/[^"]+)"/g)].map(m => m[1]).filter(t => !t.startsWith("textures/ui/adminplus/")), [])

    // The game numbers what is pressed. A button that sends anything else does
    // nothing at all.
    const rowButton = LOOK.row.controls[0].line.controls[1]["row_button@adminplus_beta.dark_button"]
    const tileButton = LOOK["tile_button@adminplus_beta.dark_content_button"]
    check("a row presses like the game's own form button", rowButton.$pressed_button_name, "button.form_button_click")
    check("so does a tile", tileButton.$pressed_button_name, "button.form_button_click")
    check("and both know which button of the list they are",
        [rowButton, tileButton].every(b => b.bindings.some(x => x.binding_type === "collection_details" && x.binding_collection_name === "form_buttons")), true)
    check("the close button closes, like the game's",
        LOOK.close.button_mappings.every(m => m.to_button_id === "button.menu_exit"), true)

    // The list and both columns of tiles read how many entries the form has,
    // and which kind each is, the way the game's own 1.26 server_form.json
    // does. 2.11.0's grid of tiles drew nothing in game (2026-11-13).
    const columns = [LOOK.tile_column_left, LOOK.tile_column_right]
    for (const [what, list] of [["the list", LOOK.rows], ["the left column of tiles", columns[0]], ["the right column", columns[1]]]) {
        check(`${what} counts entries like the game does`,
            list.bindings[0], { binding_name: "#form_button_contents", binding_name_override: "#collection_length" })
        check(`${what} is made from the form's buttons`, [list.collection_name, list.factory.name], ["form_buttons", "buttons"])
        check(`${what} names the same four parts as the game's list`,
            Object.keys(list.factory.control_ids), ["button", "label", "header", "divider"])
    }
    check("there is no grid any more", JSON.stringify(LOOK).includes("\"grid\""), false)
    check("the two columns share the width, with a 4px gap",
        [columns[0].size[0], columns[1].size[0], LOOK.tiles.controls[1].gap.size[0]], ["50% - 2px", "50% - 2px", 4])

    // Pictures keep their own shape unless told not to, which squashed 2.11.0's
    // panel into a square and its badge into a line (seen in game, 2026-11-13).
    // Every picture of ours that is stretched says so. Tile icons are drawn at
    // their own shape, so they may keep it.
    const images = []
    const walk = (node, name) => {
        if (Array.isArray(node)) return node.forEach(n => walk(n, name))
        if (!node || typeof node !== "object") return
        if (node.type === "image" && typeof node.texture === "string") images.push([name, node])
        for (const [k, v] of Object.entries(node)) walk(v, k.split("@")[0])
    }
    walk(LOOK, "")
    check("every picture of ours stretches to its box",
        images.filter(([, n]) => n.keep_ratio !== false).map(([name]) => name), [])
    check("so does a button's face", [LOOK["dark_button@common_buttons.light_text_button"].$button_image,
        LOOK["dark_content_button@common_buttons.light_content_button"].$button_image, LOOK.button_fill.keep_ratio],
        ["adminplus_beta.button_fill", "adminplus_beta.button_fill", false])
    check("and the flat colours stretch as nine-slices too",
        ["tile", "tile_hover", "tile_pressed", "white"].filter(t => !existsSync(new URL(`${t}.json`, TEXTURES))), [])

    // The frame sizes itself from the screen, so the panels above it must be
    // the screen's size. In 2.11.0 they weren't, and the frame fell back to its
    // smallest size (seen in game: 225 by 200).
    check("the form's factory fills the screen", FORM["main_screen_content/server_form_factory"].size, ["100%", "100%"])
    check("and so does the menu panel", FORM.long_form.size, ["100%", "100%"])
    check("the frame never shrinks below 300 by 200", LOOK.frame["$frame_min_size|default"], [300, 200])
}

console.log("\n— each tile shows in one column —")
// Every tile is made in both columns; the left shows tiles carrying TILE_LEFT,
// the right shows the rest. Worked out from the bindings themselves.
{
    const visible = (control, text) => evaluate(visibleExpr(control), { "#form_button_text": text })
    for (const [what, text, expected] of [
        ["the first tile", tileText("§f§lPlayers§r\n§7Help, warn, punish", 0), ["left"]],
        ["the second", tileText("§f§lRanks§r\n§7Make and give ranks", 1), ["right"]],
        ["the third", tileText("§f§lPlaces", 2), ["left"]],
        ["an empty entry", "", []]
    ]) {
        const shown = [["left", LOOK.tile_left], ["right", LOOK.tile_right]].filter(([, c]) => visible(c, text)).map(([side]) => side)
        check(`${what} shows ${expected.length ? `on the ${expected.join(" and ")}` : "on neither side"}`, shown, expected)
    }
    check("TILE_LEFT prints nothing and restyles nothing", /^(?:§[0-9a-jmnpqstuv])+$/.test(TILE_LEFT), true)
    check("lifting leaves it alone", lift(TILE_LEFT), TILE_LEFT)
    check("it spells no other marker", [MULTILINE, BETA_LOOK, TILES, ...CHEST].filter(m => TILE_LEFT.includes(m) || m.includes(TILE_LEFT)), [])
}

// A player who may open everything.
const boss = {
    id: "look-boss", name: "Boss", nameTag: "Boss", commandPermissionLevel: 0,
    getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {},
    dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
}
__test.players.push(boss)
onPlayerJoin(boss)
applyPreset("server")
setRanks(boss.id, ["owner"], boss.name)

const SPEC = () => ({
    title: hubTitle("settings", "Server"),
    body: "§7How this server works.\n§8Most never need it.",
    layout: "tiles",
    buttons: [
        { label: "§lGroups" },
        { text: hubButton("settings", "Settings", "Switch things on and off"), tile: tile("server", "Settings", "On and off"), run: () => {} },
        { divider: true },
        { text: hubButton("about", "Help", "What this does"), tile: tile("help", "Help", "What this does"), run: () => {} }
    ],
    back: () => {}
})

console.log("\n— on Default, every form is exactly what it was —")
{
    setBeta(false)
    check("the slider is on Default", betaLook(), false)
    const spec = SPEC()
    await menu(boss, spec)
    const form = lastForm()
    check("the title is untouched", titleOf(form), spec.title)
    check("so is the text", partsOf(form, "body")[0][1], spec.body)
    check("buttons show their own text, not a tile's", partsOf(form, "button").map(p => p[1]),
        [spec.buttons[1].text, spec.buttons[3].text, "§8< Back"])
    check("and no pictures", partsOf(form, "button").map(p => p[2]), [undefined, undefined, undefined])
    check("labels are untouched", partsOf(form, "label").map(p => p[1]), ["§lGroups"])

    await openPanel(boss)
    const panel = lastForm()
    check("/admin keeps its title", titleOf(panel), hubTitle("ranks", "Staff panel"))
    check("and its six buttons, without pictures",
        partsOf(panel, "button").map(p => [p[1].split("\n")[0].replace(/§./g, ""), p[2]]),
        [["Players", undefined], ["Ranks", undefined], ["Places", undefined], ["Logs", undefined], ["Server", undefined], ["Help", undefined]])

    await modal(boss, hubTitle("ranks", "Basics"), [
        { id: "name", type: "text", label: "§8Name", placeholder: "§8Example: §eHelper", default: "§8Mod", tooltip: COLOUR_CODE_TIP },
        { id: "colour", type: "dropdown", label: "§8Colour", options: ["§0Black", "§8Dark grey"] }
    ])
    const box = partsOf(lastForm(), "text")[0]
    check("a form keeps its title", titleOf(lastForm()), hubTitle("ranks", "Basics"))
    check("and its words", [box[1], box[2], box[3].defaultValue], ["§8Name", "§8Example: §eHelper", "§8Mod"])
    check("and its choices", partsOf(lastForm(), "dropdown")[0][2], ["§0Black", "§8Dark grey"])
}

console.log("\n— on Beta, Admin+ draws its own look —")
{
    setBeta(true)
    check("the slider is on Beta", betaLook(), true)
    const spec = SPEC()
    await menu(boss, spec)
    const form = lastForm()
    const title = titleOf(form)
    check("the title carries the look's marker at its end", title.endsWith(BETA_LOOK), true)
    check("the frame draws Admin+ itself, so the name comes off", title.startsWith(BRAND_PREFIX), false)
    check("and the screen's own name stays, lifted from dark grey", title, "§7Server" + BETA_LOOK)
    check("dark grey text is lifted to grey", partsOf(form, "body")[0][1], "§7How this server works.\n§7Most never need it.")
    check("so are the buttons and Back", partsOf(form, "button").map(p => p[1]),
        [lift(spec.buttons[1].text), lift(spec.buttons[3].text), "§7< Back"])
    check("nothing dark is left on a button", partsOf(form, "button").some(p => /§[08]/.test(p[1])), false)
    // A label, a divider or Back would be drawn as a tile, so this one is a list.
    check("a menu with a label or Back is drawn as a list", title.includes(TILES), false)
    check("which keeps its labels and dividers", [partsOf(form, "label").length, partsOf(form, "divider").length], [1, 1])

    check("tiles need the Beta look", drawsTiles({ layout: "tiles", buttons: [] }, false), false)
    check("and the menu has to ask", drawsTiles({ buttons: [] }, true), false)
    check("a Back button rules them out", drawsTiles({ layout: "tiles", buttons: [], back: () => {} }, true), false)
    check("so does a divider", drawsTiles({ layout: "tiles", buttons: [{ divider: true }] }, true), false)
    check("buttons alone are tiles", drawsTiles({ layout: "tiles", buttons: [{ text: "a", run: () => {} }] }, true), true)

    await openPanel(boss)
    const panel = lastForm()
    check("/admin is drawn as tiles", titleOf(panel).endsWith(BETA_LOOK + TILES), true)
    const faces = partsOf(panel, "button")
    check("six tiles", faces.map(p => p[1].split("\n")[0].replace(/§./g, "")), ["Players", "Ranks", "Places", "Logs", "Server", "Help"])
    check("each with its picture", faces.map(p => p[2]),
        ["players", "ranks", "places", "logs", "server", "help"].map(tileIcon))
    check("each name in white over one grey line", faces.every(p => /^§f§l[^\n]+§r\n§7[^\n]+$/.test(p[1])), true)

    const member = {
        id: "look-member", name: "Mia", nameTag: "Mia", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {},
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(member)
    onPlayerJoin(member)
    setRanks(member.id, ["member"], member.name)
    await openMenu(member)
    check("/menu is drawn as tiles too", titleOf(lastForm()).endsWith(BETA_LOOK + TILES), true)
    check("with a picture on every tile", partsOf(lastForm(), "button").every(p => typeof p[2] === "string"), true)

    await modal(boss, hubTitle("ranks", "Basics"), [
        { id: "name", type: "text", label: "§8Name", placeholder: "§8Example: §eHelper", default: "§8Mod", tooltip: COLOUR_CODE_TIP },
        { id: "colour", type: "dropdown", label: "§8Colour", options: ["§0Black", "§8Dark grey"] }
    ])
    const box = partsOf(lastForm(), "text")[0]
    check("a form carries the marker", titleOf(lastForm()), "§bBasics" + BETA_LOOK)
    check("its words are lifted", [box[1], box[2]], ["§7Name", "§7Example: §eHelper"])
    check("but never the value in the box, which is what gets saved", box[3].defaultValue, "§8Mod")
    check("the colour-code tip still ends in § for the game to show", box[3].tooltip, COLOUR_CODE_TIP)
    // The game draws the choices on its own light drop-down in both looks, so
    // they keep the colours chosen for it.
    check("a drop-down's choices are left as they are", partsOf(lastForm(), "dropdown")[0][2], ["§0Black", "§8Dark grey"])
    check("but its label is lifted", partsOf(lastForm(), "dropdown")[0][1], "§7Colour")

    await modal(boss, hubTitle("code", "< Code >") + MULTILINE, [{ id: "code", type: "text", label: "Code", default: "format.chat = §8{NAME}" }])
    check("a multi-line form keeps its own marker, then the look's",
        titleOf(lastForm()).endsWith(MULTILINE + BETA_LOOK), true)
    check("and its document is untouched", partsOf(lastForm(), "text")[0][3].defaultValue, "format.chat = §8{NAME}")

    __ui.answers.push({ canceled: false, selection: 1 })
    const yes = await confirm(boss, hubTitle("actions", "Factory reset"), "§8This cannot be undone.")
    const ask = lastForm()
    check("a confirm carries the marker", titleOf(ask), "§cFactory reset" + BETA_LOOK)
    check("its words are lifted", partsOf(ask, "body")[0][1], "§7This cannot be undone.")
    check("and it still answers yes on the second button", yes, true)
    setBeta(false)
}

console.log("\n— every tile fits, and has its picture —")
// The Minecraft font, in pixels per letter including the gap after it. Close
// enough to keep a tile's line on one line.
const NARROW = { "i": 2, "!": 2, ",": 2, ".": 2, ":": 2, ";": 2, "'": 2, "|": 2, "l": 3, "`": 3, "t": 4, "I": 4, " ": 4, "[": 4, "]": 4, "(": 5, ")": 5, "f": 5, "k": 5, "<": 5, ">": 5, "{": 5, "}": 5, "\"": 5, "*": 5 }
const widthOf = (text, bold = false) => [...text.replace(/§./g, "")].reduce((w, c) => w + (NARROW[c] ?? 6) + (bold && c !== " " ? 1 : 0), 0)
// Room for a tile's words, from adminplus_beta.json: the content sits 5px in
// on each side, the scroll bar and the list take about 12px, the columns
// share what is left with a 4px gap, the button's content is 6px narrower,
// and the words start 34px in and stop 2px short. A tile shows three lines.
const [maxWidth] = LOOK.frame["$frame_max_size|default"]
const [minWidth] = LOOK.frame["$frame_min_size|default"]
const roomAt = width => (width - 22) / 2 - 2 - 6 - 36
const ROOM = roomAt(maxWidth), TIGHT = roomAt(minWidth)
check(`the words get ${ROOM}px at the widest and ${TIGHT}px at the narrowest`, TIGHT > 80, true)
check("a tile has room for three lines", LOOK.tile_content.controls[1].text.max_size[1], 30)
{
    const sources = readdirSync(new URL("features/", BP)).filter(f => f.endsWith(".js"))
        .map(f => readFileSync(new URL(`features/${f}`, BP), "utf8")).join("\n")
    const calls = [...sources.matchAll(/tile\("(\w+)", "([^"]+)", (?:"([^"]*)"|[^)]*\))/g)]
    check("the tiles are found in the code", calls.length >= 12, true)
    check("every tile's picture is in the pack", [...new Set(calls.map(c => c[1]))].filter(k => !textureExists(tileIcon(k))), [])
    for (const [, key, name, line] of calls) {
        check(`${key}: "${name}" fits on one line even at the narrowest`, widthOf(name, true) <= TIGHT, true)
        if (line !== undefined) {
            check(`${key}: "${line}" fits on one line at the widest`, widthOf(line) <= ROOM, true)
            check(`and on two at the narrowest`, widthOf(line) <= 2 * TIGHT, true)
        }
    }
    // Lines worked out at run time, at their longest.
    check("My settings with a count fits", widthOf("12 changed") <= ROOM, true)
    check("Reports at its longest fits", widthOf("99 waiting, 99 new") <= ROOM, true)
    const pictures = readdirSync(TEXTURES).filter(f => f.startsWith("tile_") && f.endsWith(".png") && f !== "tile_hover.png" && f !== "tile_pressed.png")
    check("and no picture is left over", pictures.filter(f => !calls.some(c => `tile_${c[1]}.png` === f)), [])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
