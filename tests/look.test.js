import { readFileSync, existsSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setRanks, onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { BETA_LOOK, TILES, TILE_LEFT, CARD, PROFILE, LOGS, TAB, TAB_ON, PILL, GUARD, GUARD_ON, WIDE, wideText, guardIcon, tabText, pillText, logIcon, cardText, cardStripe, lift, lookTitle, tile, tileIcon, tileText, betaLook } from "../Admin+ BP/scripts/core/look.js"
import { MULTILINE, hubTitle, hubButton, BRAND_PREFIX, COLOUR_CODE_TIP } from "../Admin+ BP/scripts/core/theme.js"
import { menu, modal, confirm, drawsTiles, drawsCards, INCOMPLETE } from "../Admin+ BP/scripts/core/ui.js"
import { openPanel } from "../Admin+ BP/scripts/features/panel.js"
import { openMenu, profileLines, statsLines } from "../Admin+ BP/scripts/features/menu.js"

const plainText = s => String(s ?? "").replace(/§./g, "")
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
    // 2.12.5 added the Logs timeline, a fifth; 3.1.5 Bot Guard's frame, a sixth.
    check("six ways to draw a menu", panels.map(p => p.name), ["long_form", "adminplus_ui", "beta_list", "beta_logs", "beta_tiles", "beta_guard"])
    const plain = hubTitle("ranks", "Staff panel")
    for (const [what, title, expected] of [
        ["a plain title", plain, "long_form"],
        ["a chest grid", "Inventory§m§c§e", "adminplus_ui"],
        ["a Beta title", lookTitle(plain), "beta_list"],
        ["a Beta title asking for tiles", lookTitle(plain, { tiles: true }), "beta_tiles"],
        ["a Beta title asking for the Logs timeline", lookTitle(plain, { logs: true }), "beta_logs"],
        ["the Logs marker without the Beta look", plain + LOGS, "long_form"],
        ["a chest grid that somehow carries the Beta marker", "Inventory§m§c§e" + BETA_LOOK, "adminplus_ui"],
        ["Bot Guard while it watches", lookTitle(plain, { guard: "on" }), "beta_guard"],
        ["Bot Guard switched off", lookTitle(plain, { guard: "off" }), "beta_guard"],
        ["the Bot Guard marker without the Beta look", plain + GUARD_ON, "long_form"],
        ["tiles that somehow carry the Bot Guard marker", lookTitle(plain, { tiles: true }) + GUARD, "beta_tiles"],
        ["the Logs timeline that somehow carries it", lookTitle(plain, { logs: true }) + GUARD, "beta_logs"],
        ["a chest grid that somehow carries it", "Inventory§m§c§e" + BETA_LOOK + GUARD_ON, "adminplus_ui"]
    ]) {
        check(`${what}: ${expected} and nothing else`, shownFor(panels, title), [expected])
    }
    check("each Beta menu is drawn in Admin+'s own frame",
        panels.filter(p => p.name.startsWith("beta_")).map(p => p.base), ["adminplus_beta.list_form", "adminplus_beta.log_form", "adminplus_beta.tile_form", "adminplus_beta.guard_form"])
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
            list.bindings[0], { binding_name: "#form_button_contents", binding_name_override: "#collection_length", binding_condition: "visible" })
        check(`${what} is made from the form's buttons`, [list.collection_name, list.factory.name], ["form_buttons", "buttons"])
        check(`${what} names the same four parts as the game's list`,
            Object.keys(list.factory.control_ids), ["button", "label", "header", "divider"])
    }
    check("there is no grid any more", JSON.stringify(LOOK).includes("\"grid\""), false)
    check("the two columns share the width, with a 4px gap",
        [columns[0].size[0], columns[1].size[0], LOOK.tiles.controls[1].gap.size[0]], ["50% - 2px", "50% - 2px", 4])

    // Side by side, a height of 100%c ADDS the children's heights; 100%cm is
    // the tallest child, and the game's own files size a row that way 102
    // times. 2.11.4's row of four Template cards came out 720 tall (4 x 180)
    // and drew the cards in its top 180, so Permissions sat under 540 empty
    // pixels (the user's screenshot, 2026-11-13: "you have to scroll really
    // far to reach permissions"; its scroll bar measured 786 tall). Hidden
    // entries took no room at all. The same goes for a column's width.
    check("a row of cards is as tall as its tallest card", LOOK.cards.size, ["100%", "100%cm"])
    check("the tiles are as tall as their taller column", LOOK.tiles.size, ["100%", "100%cm"])
    const summed = []
    for (const file of readdirSync(new URL("ui/", RP)).filter(f => f.endsWith(".json"))) {
        const visit = (node, name) => {
            if (Array.isArray(node)) return node.forEach(n => visit(n, name))
            if (!node || typeof node !== "object") return
            if (node.type === "stack_panel" && Array.isArray(node.size)) {
                const across = node.orientation === "horizontal" ? node.size[1] : node.size[0]
                if (/%c(?!m)/.test(String(across))) summed.push(`${file} ${name}`)
            }
            for (const [k, v] of Object.entries(node)) visit(v, k.split("@")[0])
        }
        visit(JSON.parse(readFileSync(new URL(`ui/${file}`, RP), "utf8")), "")
    }
    check("no stack of ours adds up its children across", summed, [])

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
    check("a wide tile shows in neither column",
        [["left", LOOK.tile_left], ["right", LOOK.tile_right]].filter(([, c]) => visible(c, wideText("§f§lSet up Admin+§r\n§7Ranks, automod, more"))).map(([side]) => side), [])
    check("TILE_LEFT prints nothing and restyles nothing", /^(?:§[0-9a-jmnpqstuv])+$/.test(TILE_LEFT), true)
    check("lifting leaves it alone", lift(TILE_LEFT), TILE_LEFT)
    check("it spells no other marker", [MULTILINE, BETA_LOOK, TILES, ...CHEST].filter(m => TILE_LEFT.includes(m) || m.includes(TILE_LEFT)), [])
}

console.log("\n— a wide tile across both columns —")
// 3.1.6, the user: a setup button in /admin "that spans 2 buttons". A tile
// whose text ends in WIDE shows in the row above the columns. Worked out from
// the bindings themselves.
{
    check("WIDE prints nothing and restyles nothing", /^(?:§[0-9a-jmnpqstuv])+$/.test(WIDE), true)
    check("lifting leaves it alone", lift(WIDE), WIDE)
    check("it spells no other marker",
        [MULTILINE, BETA_LOOK, TILES, TILE_LEFT, CARD, PROFILE, LOGS, TAB, TAB_ON, PILL, GUARD, GUARD_ON, ...CHEST].filter(m => WIDE.includes(m) || m.includes(WIDE)), [])
    const shown = text => evaluate(visibleExpr(LOOK.wide_slot), { "#form_button_text": text })
    check("a wide tile shows in the wide row", shown(wideText("§f§lSet up Admin+")), true)
    check("a plain tile doesn't", [shown(tileText("§f§lPlayers", 0)), shown(tileText("§f§lRanks", 1)), shown("")], [false, false, false])
    check("the wide row is made from the form's buttons, like the game's list",
        [LOOK.wides.collection_name, LOOK.wides.factory.name, LOOK.wides.bindings[0], Object.keys(LOOK.wides.factory.control_ids)],
        ["form_buttons", "buttons", { binding_name: "#form_button_contents", binding_name_override: "#collection_length", binding_condition: "visible" }, ["button", "label", "header", "divider"]])
    check("a label, header or divider makes no wide tile",
        ["label", "header", "divider"].every(k => LOOK.wides.factory.control_ids[k] === "@adminplus_beta.nothing"), true)
    const wideButton = LOOK["wide_button@adminplus_beta.dark_content_button"]
    check("it presses like the game's own form button, and knows which it is",
        [wideButton.$pressed_button_name, wideButton.bindings.some(x => x.binding_type === "collection_details" && x.binding_collection_name === "form_buttons")], ["button.form_button_click", true])
    check("it is as tall as a tile and fills the width", [wideButton.size, wideButton.size[1] <= LOOK.wide_slot.size[1]], [["100%", 40], true])
}

console.log("\n— a Profile card above the /menu tiles —")
// 2.12.3: a "Profile" heading, the player's own model and the form's body
// beside it, which nobody can press. Worked out from the bindings themselves.
{
    check("PROFILE prints nothing and restyles nothing", /^(?:§[0-9a-jmnpqstuv])+$/.test(PROFILE), true)
    check("it spells no other marker",
        [MULTILINE, BETA_LOOK, TILES, TILE_LEFT, CARD, ...CHEST].filter(m => PROFILE.includes(m) || m.includes(PROFILE)), [])
    check("it only rides on tiles",
        [lookTitle("x", { profile: true }).includes(PROFILE), lookTitle("x", { tiles: true, profile: true }).endsWith(TILES + PROFILE)], [false, true])
    const scroll = panelsOf(LOOK.tile_scroll.controls)
    // 3.1.6 put the wide row (setup's button in /admin) between them.
    check("the tile frame starts with the card, then the body, the wide row and the tiles",
        scroll.map(p => p.name), ["profile", "intro", "padding", "wides", "wrapping_panel"])
    const withCard = "§bMenu" + BETA_LOOK + TILES + PROFILE
    const without = "§bAdmin" + BETA_LOOK + TILES
    const shows = (expr, title) => evaluate(expr, { "#title_text": title })
    const cardExpr = visibleExpr(LOOK.profile)
    check("the card shows only when the title asks for it", [shows(cardExpr, withCard), shows(cardExpr, without)], [true, false])
    check("and the plain body steps aside then, since the card shows it", [shows(scroll[1].expr, withCard), shows(scroll[1].expr, without)], [false, true])
    const parts = Object.fromEntries(LOOK.profile.controls.map(c => Object.entries(c)[0]))
    check("headed Profile", parts.heading.controls[0].text.text, "Profile")
    const card = Object.fromEntries(parts.card.controls.map(c => Object.entries(c)[0]))
    check("the player's own model, drawn the way the game's inventory draws it",
        [LOOK.profile_skin.type, LOOK.profile_skin.renderer], ["custom", "live_player_renderer"])
    check("in its own box at the left", Object.keys(card.model_box.controls[1])[0], "model_slot")
    check("with the form's body beside it", card.text.text, "#form_text")
    check("cut off before it runs out of the card", card.text.max_size[1] <= parts.card.size[1], true)
    check("nothing on it can be pressed", JSON.stringify(LOOK.profile).match(/"button"|button_mappings|form_button_click/g), null)
}

console.log("\n— the Logs timeline frame —")
// 2.12.5, the user: "I want something distinct for logs too, not close to the
// template one". Tabs across the top, filter pills under them, then the
// entries down a coloured line. Worked out from the bindings themselves.
{
    const markers = [LOGS, TAB, TAB_ON, PILL]
    check("its markers print nothing and restyle nothing", markers.every(m => /^(?:§[0-9a-jmnpqstuv])+$/.test(m)), true)
    check("lifting leaves them alone", markers.map(lift), markers)
    // TAB_ON is a tab too, so it holds TAB on purpose.
    const others = [MULTILINE, BETA_LOOK, TILES, TILE_LEFT, CARD, PROFILE, ...CHEST]
    check("they spell no other marker",
        [LOGS, TAB, PILL].flatMap(m => others.filter(o => m.includes(o) || o.includes(m))), [])
    check("the open tab holds the tab marker", TAB_ON.startsWith(TAB), true)
    check("the timeline is never asked for with tiles", lookTitle("x", { tiles: true, logs: true }).includes(LOGS), false)

    const scroll = panelsOf(LOOK.log_scroll.controls)
    check("tabs, then pills, then the body, then the timeline",
        scroll.map(p => p.name), ["tabs", "tab_gap", "pills", "pill_gap", "intro", "padding", "wrapping_panel"])
    const shown = (control, text) => evaluate(visibleExpr(control), { "#form_button_text": text })
    const where = text => [["tab", LOOK.log_tab], ["pill", LOOK.log_pill], ["row", LOOK.log_row]].filter(([, c]) => shown(c, text)).map(([k]) => k)
    for (const [what, text, expected] of [
        ["an open tab", tabText("Actions · 12", true), ["tab"]],
        ["a closed tab", tabText("Chat · 3", false), ["tab"]],
        ["a filter pill", pillText("Player · anyone", false), ["pill"]],
        ["a set filter", pillText("Kind · Moderation", true), ["pill"]],
        ["an entry", "§f§lFirelite§r §fbanned Steve\n§814:02 · griefing", ["row"]],
        ["Back", "§8< Back", ["row"]]
    ]) {
        check(`${what} shows as a ${expected.join(" and a ")}`, where(text), expected)
    }
    const underline = LOOK.log_tab_content.controls.map(c => Object.entries(c)[0]).find(([k]) => k === "underline")[1]
    check("only the open tab is underlined, in Admin+'s flowing gradient",
        [evaluate(visibleExpr(underline), { "#form_button_text": tabText("A", true) }), evaluate(visibleExpr(underline), { "#form_button_text": tabText("B", false) }), underline.texture, underline.keep_ratio],
        [true, false, "textures/ui/adminplus/flow", false])
    for (const [what, list] of [["the tabs", LOOK.log_tabs], ["the pills", LOOK.log_pills], ["the timeline", LOOK.log_rows]]) {
        check(`${what} are made from the form's buttons, like the game's list`,
            [list.collection_name, list.factory.name, list.bindings[0]],
            ["form_buttons", "buttons", { binding_name: "#form_button_contents", binding_name_override: "#collection_length", binding_condition: "visible" }])
    }
    check("a label on the timeline is a day marker", LOOK.log_rows.factory.control_ids.label, "@adminplus_beta.log_day")
    check("tabs and pills make nothing of labels, headers or dividers",
        [LOOK.log_tabs, LOOK.log_pills].flatMap(l => ["label", "header", "divider"].map(k => l.factory.control_ids[k])).every(id => id === "@adminplus_beta.nothing"), true)
    const row = Object.fromEntries(LOOK.log_row.controls.map(c => Object.entries(c)[0]))
    check("each entry sits on the line, with its kind's picture as the dot",
        [Object.keys(row).map(k => k.split("@")[0]), row.dot.bindings.some(b => b.binding_name === "#form_button_texture" && b.binding_name_override === "#texture")],
        [["rail", "dot", "entry"], true])
    check("an entry presses like the game's own form button", row["entry@adminplus_beta.dark_button"].$pressed_button_name, "button.form_button_click")
    check("three tabs and three pills share the width", [LOOK.log_tab.size[0], LOOK.log_pill.size[0]], ["33%", "33%"])
    const keys = ["moderation", "chatmod", "people", "staff", "server", "reports", "land", "signs", "blocks", "older", "newer", "undo", "clear", "search"]
    check("every timeline picture is in the pack", keys.map(logIcon).filter(t => !textureExists(t)), [])
    check("and drawn from scratch by the tool", keys.every(k => readFileSync(new URL("../tools/genlook.py", import.meta.url), "utf8").includes(`"${k}": (`)), true)
}

console.log("\n— Bot Guard's own frame —")
// 3.1.5, the user: "Bot guard should be its own unique UI look really
// animated and good, a pretty damn good layout too. And then with that we can
// sort it out and then we can fit 'Bot Moderation' and 'Detected Bots' in
// there." A banner with the shield and Bot Guard's status, then its two pages
// as cards. Worked out from the bindings themselves.
{
    const markers = [GUARD, GUARD_ON]
    check("its markers print nothing and restyle nothing", markers.every(m => /^(?:§[0-9a-jmnpqstuv])+$/.test(m)), true)
    check("lifting leaves them alone", markers.map(lift), markers)
    check("lit up is the frame's marker and one more code", [GUARD_ON.startsWith(GUARD), GUARD_ON.length - GUARD.length], [true, 2])
    const others = [MULTILINE, BETA_LOOK, TILES, TILE_LEFT, CARD, PROFILE, LOGS, TAB, TAB_ON, PILL, ...CHEST]
    check("they spell no other marker", markers.flatMap(m => others.filter(o => m.includes(o) || o.includes(m))), [])
    check("and no other title of ours spells them by accident",
        [lookTitle("x"), lookTitle("x", { tiles: true, profile: true }), lookTitle("x", { logs: true }), "x" + MULTILINE + BETA_LOOK].filter(t => t.includes(GUARD)), [])
    check("asked for, it goes last: lit, or not",
        [lookTitle("x", { guard: "on" }).endsWith(BETA_LOOK + GUARD_ON), lookTitle("x", { guard: "off" }).endsWith(BETA_LOOK + GUARD), lookTitle("x", { guard: "off" }).includes(GUARD_ON)], [true, true, false])
    check("never with tiles or the Logs timeline",
        [lookTitle("x", { tiles: true, guard: "on" }), lookTitle("x", { logs: true, guard: "on" })].some(t => t.includes(GUARD)), false)

    const scroll = panelsOf(LOOK.guard_scroll.controls)
    check("a banner, then the cards, then the rows", scroll.map(p => p.name), ["banner", "padding", "cards", "wrapping_panel"])
    const banner = Object.fromEntries(LOOK.guard_banner.controls.map(c => Object.entries(c)[0]).map(([k, v]) => [k.split("@")[0], v]))
    const emblem = Object.fromEntries(LOOK.guard_emblem.controls.map(c => Object.entries(c)[0]))
    check("the banner holds the shield, Bot Guard's status and its pill",
        Object.keys(banner), ["edge", "inside", "scan", "emblem", "status", "pill_on", "pill_off", "line"])
    check("its status is the form's body", banner.status.text, "#form_text")
    check("cut off before it runs out of the banner", banner.status.max_size[1] <= LOOK.guard_banner.size[1] - 4, true)
    check("and nothing moves outside it", LOOK.guard_banner.clips_children, true)

    const on = "§bBot Guard" + BETA_LOOK + GUARD_ON, off = "§bBot Guard" + BETA_LOOK + GUARD
    const lit = control => [evaluate(visibleExpr(control), { "#title_text": on }), evaluate(visibleExpr(control), { "#title_text": off })]
    for (const [what, control, expected] of [
        ["the shield in colour", emblem.shield, [true, false]],
        ["its glow", emblem.glow, [true, false]],
        ["the scan line", banner.scan, [true, false]],
        ["the flowing line under the banner", banner.line, [true, false]],
        ["WATCHING", LOOK.guard_pill_on, [true, false]],
        ["the grey shield", emblem.shield_off, [false, true]],
        ["OFF", LOOK.guard_pill_off, [false, true]]
    ]) {
        check(`${what} shows ${expected[0] ? "only while Bot Guard watches" : "only while it is off"}`, lit(control), expected)
    }
    check("the pills say so", [LOOK.guard_pill_on.controls[3].word.text, LOOK.guard_pill_off.controls[3].word.text], ["WATCHING", "OFF"])

    const anims = Object.fromEntries(Object.entries(LOOK).filter(([, v]) => v && typeof v === "object" && "anim_type" in v))
    const sweep = anims.anim_guard_scan, rest = anims.anim_guard_scan_rest
    check("the scan line rests off the banner's left edge, so a scan that never plays shows nothing",
        [banner.scan.offset, banner.scan.anchor_from, sweep.from], [[-16, 0], "left_middle", [-16, 0]])
    check("it sweeps all the way across, waits off the edge, and goes again",
        [sweep.to, rest.from, rest.to, sweep.next, rest.next], [["100%", 0], [-16, 0], [-16, 0], "@adminplus_beta.anim_guard_scan_rest", "@adminplus_beta.anim_guard_scan"])
    const glowDim = anims.anim_guard_glow_dim, glowBright = anims.anim_guard_glow_bright
    check("the glow pulses and keeps pulsing", [emblem.glow.anims, glowDim.next, glowBright.next],
        [["@adminplus_beta.anim_guard_glow_dim"], "@adminplus_beta.anim_guard_glow_bright", "@adminplus_beta.anim_guard_glow_dim"])
    check("without ever disappearing", Math.min(glowDim.from, glowDim.to, glowBright.from, glowBright.to) > 0, true)
    check("the shield slides in and ends where it belongs",
        [LOOK.guard_emblem.anims, anims.anim_guard_slide.to], [["@adminplus_beta.anim_guard_slide"], LOOK.guard_emblem.offset])
    check("WATCHING's dot pulses like a Logs day marker", LOOK.guard_pill_on.controls[2]["dot@adminplus_beta.fill"].anims, ["@adminplus_beta.anim_knot_dim"])

    const shown = (control, text) => evaluate(visibleExpr(control), { "#form_button_text": text })
    for (const [what, text, expected] of [
        ["Bot Moderation's card", cardText("§f§lBot Moderation§r\n§7Level, alerts and the limit"), ["card"]],
        ["Back", "§7< Back", ["row"]]
    ]) {
        check(`${what} shows as a ${expected.join(" and a ")}`, [["card", LOOK.guard_card], ["row", LOOK.row]].filter(([, c]) => shown(c, text)).map(([k]) => k), expected)
    }
    check("the cards are made from the form's buttons, like the game's list",
        [LOOK.guard_cards.collection_name, LOOK.guard_cards.factory.name, LOOK.guard_cards.bindings[0], Object.keys(LOOK.guard_cards.factory.control_ids)],
        ["form_buttons", "buttons", { binding_name: "#form_button_contents", binding_name_override: "#collection_length", binding_condition: "visible" }, ["button", "label", "header", "divider"]])
    check("a label, header or divider makes no card",
        ["label", "header", "divider"].every(k => LOOK.guard_cards.factory.control_ids[k] === "@adminplus_beta.nothing"), true)
    check("two side by side, half the width each", [LOOK.guard_cards.orientation, LOOK.guard_card.size[0]], ["horizontal", "50%"])
    const cardButton = LOOK["guard_card_button@adminplus_beta.dark_content_button"]
    check("a card presses like the game's own form button, and knows which it is",
        [cardButton.$pressed_button_name, cardButton.bindings.some(x => x.binding_type === "collection_details" && x.binding_collection_name === "form_buttons")], ["button.form_button_click", true])
    check("it fits in its slot", [cardButton.size[1] <= LOOK.guard_card.size[1], cardButton.$button_content], [true, "adminplus_beta.guard_card_content"])
    const face = Object.fromEntries(LOOK.guard_card_content.controls.map(c => Object.entries(c)[0]))
    check("its picture is the button's own, its words the button's text",
        [face.icon.bindings.some(b => b.binding_name === "#form_button_texture" && b.binding_name_override === "#texture"), face.text.text], [true, "#form_button_text"])
    check("and its words stop before the Open chip", face.text.offset[1] + face.text.max_size[1] <= cardButton.size[1] + face.open.offset[1] - face.open.size[1], true)

    const pictures = ["shield", "shield_off", "banner", "glow", "scan", "moderation", "detected"].map(guardIcon)
    check("every Bot Guard picture is in the pack", pictures.filter(t => !textureExists(t)), [])
    const tool = readFileSync(new URL("../tools/genlook.py", import.meta.url), "utf8")
    check("and drawn from scratch by the tool", ["guard_shield", "guard_banner", "guard_glow", "guard_scan", "guard_icon_moderation", "guard_icon_detected"].every(f => tool.includes(`def ${f}(`)), true)
}

console.log("\n— Admin+'s look moves —")
// 2.12.6, the user: "the second one that has animations, I mean everyone
// loves animation right?". Built only from patterns the game's own menus use
// (flip books like its loading bar, moves like its toasts, fades like its
// titles), and so that if one doesn't play, the menu still looks right.
{
    const anims = Object.fromEntries(Object.entries(LOOK).filter(([, v]) => v && typeof v === "object" && "anim_type" in v))
    const text = JSON.stringify(LOOK)
    const used = [...new Set([...text.matchAll(/"@adminplus_beta\.(anim_\w+)"/g)].map(m => m[1]))]
    check("every animation that is used is defined", used.filter(n => !anims[n]), [])
    check("of kinds the game's own menus use", Object.values(anims).map(a => a.anim_type).filter(t => !["offset", "flip_book", "alpha"].includes(t)), [])
    check("with easings the game's own menus use", Object.values(anims).map(a => a.easing).filter(e => e && !["out_cubic", "in_sine", "out_sine", "linear"].includes(e)), [])

    const rise = anims.anim_frame_rise
    check("a menu rises into place when it opens, ending where it belongs",
        [LOOK.frame.anims, rise.anim_type, rise.to, rise.duration <= 0.3], [["@adminplus_beta.anim_frame_rise"], "offset", [0, 0], true])

    const images = []
    const walk = (node, name) => {
        if (Array.isArray(node)) return node.forEach(n => walk(n, name))
        if (!node || typeof node !== "object") return
        if (node.type === "image" && typeof node.texture === "string") images.push([name, node])
        for (const [k, v] of Object.entries(node)) walk(v, k.split("@")[0])
    }
    walk(LOOK, "")
    check("no still gradient is left: every aqua-to-pink picture flows", images.filter(([, n]) => n.texture.endsWith("/gradient")).map(([k]) => k), [])
    const flowing = images.filter(([, n]) => n.texture.endsWith("/flow"))
    // 3.1.5 added Bot Guard's: a card's Open chip and the line under its banner.
    // 3.1.6 the shine along a wide tile's bottom edge.
    check("the bar, the BETA LOOK chip, a card's Select, the open tab, Bot Guard's Open, its banner's line and a wide tile's shine flow",
        flowing.map(([k, n]) => [k, n.uv, n.uv_size]).sort(),
        [["bar", "@adminplus_beta.anim_flow", [128, 2]], ["chip", "@adminplus_beta.anim_flow", [128, 2]], ["chip", "@adminplus_beta.anim_flow", [128, 2]], ["chip", "@adminplus_beta.anim_flow", [128, 2]], ["line", "@adminplus_beta.anim_flow", [128, 2]], ["shine", "@adminplus_beta.anim_flow", [128, 2]], ["underline", "@adminplus_beta.anim_flow", [128, 2]]])
    // The flip book steps frame_step pixels a frame. Which way it steps isn't
    // written down, so the texture holds every frame either way.
    const png = readFileSync(new URL("flow.png", TEXTURES))
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
    const flow = anims.anim_flow
    const reach = (flow.frame_count - 1) * flow.frame_step
    check("the flowing picture holds every frame, stepping across or down", [w >= 128 + reach, h >= 2 + reach], [true, true])
    check("one loop is one whole gradient, so it never jumps", flow.frame_count * flow.frame_step, 256)
    check("and it is drawn by the tool", readFileSync(new URL("../tools/genlook.py", import.meta.url), "utf8").includes("def flow_texture"), true)

    const knot = LOOK.log_day.controls.map(c => Object.entries(c)[0]).find(([k]) => k.startsWith("knot"))[1]
    const dim = anims.anim_knot_dim, bright = anims.anim_knot_bright
    check("a day marker on the Logs timeline pulses, and keeps pulsing",
        [knot.anims, dim.next, bright.next], [["@adminplus_beta.anim_knot_dim"], "@adminplus_beta.anim_knot_bright", "@adminplus_beta.anim_knot_dim"])
    check("without ever disappearing", Math.min(dim.from, dim.to, bright.from, bright.to) > 0, true)
    check("nothing fades in from nothing, so a menu is never left invisible",
        Object.entries(anims).filter(([, a]) => a.anim_type === "alpha" && a.from === 0).map(([k]) => k), [])
}

console.log("\n— each card shows once, above the rows —")
// 2.11.4: a button whose text ends in CARD is a card in the row across the top
// of the list frame; every other button stays a row under it. Worked out from
// the bindings themselves, as for the tiles.
{
    const visible = (control, text) => evaluate(visibleExpr(control), { "#form_button_text": text })
    for (const [what, text, expected] of [
        ["a template card", cardText("§f§lMod\n§7Keeps the peace day to day."), ["card"]],
        ["the Permissions button under the cards", "§bPermissions§r\n§8Pick each permission yourself", ["row"]],
        ["Back", "§8< Back", ["row"]],
        ["a tile's text", tileText("§f§lPlayers", 0), ["row"]]
    ]) {
        const shown = [["card", LOOK.card_slot], ["row", LOOK.row]].filter(([, c]) => visible(c, text)).map(([k]) => k)
        check(`${what} shows as a ${expected.join(" and a ")}`, shown, expected)
    }
    check("the cards are made from the form's buttons, like the rows",
        [LOOK.cards.collection_name, LOOK.cards.factory.name, LOOK.cards.bindings[0]],
        ["form_buttons", "buttons", { binding_name: "#form_button_contents", binding_name_override: "#collection_length", binding_condition: "visible" }])
    check("naming the same four parts as the game's list", Object.keys(LOOK.cards.factory.control_ids), ["button", "label", "header", "divider"])
    check("a label, header or divider makes no card",
        ["label", "header", "divider"].map(k => LOOK.cards.factory.control_ids[k]), ["@adminplus_beta.nothing", "@adminplus_beta.nothing", "@adminplus_beta.nothing"])
    check("they stand side by side, a quarter of the width each",
        [LOOK.cards.type, LOOK.cards.orientation, LOOK.card_slot.size[0]], ["stack_panel", "horizontal", "25%"])
    check("under the body text and above the rows",
        LOOK.list_scroll.controls.map(c => Object.keys(c)[0].split("@")[0]), ["intro", "padding", "cards", "wrapping_panel"])
    const cardButton = LOOK["card_button@adminplus_beta.dark_content_button"]
    check("a card presses like the game's own form button", cardButton.$pressed_button_name, "button.form_button_click")
    check("and knows which button of the list it is",
        cardButton.bindings.some(x => x.binding_type === "collection_details" && x.binding_collection_name === "form_buttons"), true)
    check("it fits in its slot", [cardButton.size[1] <= LOOK.card_slot.size[1], cardButton.$button_content], [true, "adminplus_beta.card_content"])
    const parts = Object.fromEntries(LOOK.card_content.controls.map(c => Object.entries(c)[0]))
    check("its strip stretches along the top edge", [parts.stripe.keep_ratio, parts.stripe.size], [false, ["100% - 2px", 3]])
    check("the strip is the button's own picture",
        parts.stripe.bindings.some(b => b.binding_name === "#form_button_texture" && b.binding_name_override === "#texture"), true)
    check("its words wrap to the card's width", [parts.text.size, parts.text.text], [["100% - 8px", "default"], "#form_button_text"])
    const chip = parts.select.controls.map(c => Object.entries(c)[0][1])
    check("Select sits at the bottom on Admin+'s flowing gradient", [parts.select.anchor_to, chip[0].texture, chip[0].keep_ratio, chip[1].text],
        ["bottom_middle", "textures/ui/adminplus/flow", false, "Select"])
    check("every template's strip is in the pack", ["mod", "admin", "manager", "owner"].map(cardStripe).filter(t => !textureExists(t)), [])
    // 2.11.5: the Owner card's words ran out of the bottom of a 160-tall card.
    check("a card is tall enough for the longest template, Owner", cardButton.size[1] >= 176, true)
    check("CARD prints nothing and restyles nothing", /^(?:§[0-9a-jmnpqstuv])+$/.test(CARD), true)
    check("lifting leaves it alone", lift(CARD), CARD)
    check("it spells no other marker",
        [MULTILINE, BETA_LOOK, TILES, TILE_LEFT, ...CHEST].filter(m => CARD.includes(m) || m.includes(CARD)), [])
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
    // 3.1.6: an owner sees Set up first while nothing has been changed.
    check("and its six buttons after Set up, without pictures",
        partsOf(panel, "button").map(p => [p[1].split("\n")[0].replace(/§./g, ""), p[2]]),
        [["Set up Admin+", undefined], ["Players", undefined], ["Ranks", undefined], ["Places", undefined], ["Logs", undefined], ["Server", undefined], ["Help", undefined]])

    await modal(boss, hubTitle("ranks", "Basics"), [
        { id: "name", type: "text", label: "§8Name", placeholder: "§8Example: §eHelper", default: "§8Mod", tooltip: COLOUR_CODE_TIP },
        { id: "colour", type: "dropdown", label: "§8Colour", options: ["§0Black", "§8Dark grey"] }
    ])
    const box = partsOf(lastForm(), "text")[0]
    check("a form keeps its title", titleOf(lastForm()), hubTitle("ranks", "Basics"))
    check("and its words", [box[1], box[2], box[3].defaultValue], ["§8Name", "§8Example: §eHelper", "§8Mod"])
    check("and its choices", partsOf(lastForm(), "dropdown")[0][2], ["§0Black", "§8Dark grey"])
}

console.log("\n— a menu of cards —")
{
    const CARD_SPEC = () => ({
        title: hubTitle("ranks", "Template"),
        body: "§8Start from a template.",
        layout: "cards",
        buttons: [
            { text: "§a§lMod§r\n§8Keeps the peace day to day.", card: { text: "§f§lMod\n§7Keeps the peace", icon: cardStripe("mod") }, run: () => {} },
            { text: "§bPermissions", run: () => {} }
        ],
        back: () => {}
    })
    setBeta(false)
    check("on Default, cards are never drawn", drawsCards(CARD_SPEC(), false), false)
    await menu(boss, CARD_SPEC())
    check("a menu of cards is a plain list on Default", partsOf(lastForm(), "button").map(p => [p[1], p[2]]),
        [["§a§lMod§r\n§8Keeps the peace day to day.", undefined], ["§bPermissions", undefined], ["§8< Back", undefined]])
    check("and its title carries no marker", titleOf(lastForm()), hubTitle("ranks", "Template"))
    setBeta(true)
    check("on Beta it is drawn as cards", drawsCards(CARD_SPEC(), true), true)
    await menu(boss, CARD_SPEC())
    const buttons = partsOf(lastForm(), "button")
    check("the card shows its card face, marked, with its strip", [buttons[0][1], buttons[0][2]],
        [cardText("§f§lMod\n§7Keeps the peace"), cardStripe("mod")])
    check("the other buttons and Back stay rows", buttons.slice(1).map(p => p[1].endsWith(CARD)), [false, false])
    check("a menu of cards keeps the list frame, not the tiles", titleOf(lastForm()).includes(TILES), false)
    setBeta(false)
}

console.log("\n— Bot Guard's menu —")
{
    const GUARD_SPEC = watching => ({
        title: hubTitle("settings", "Bot Guard"),
        body: "§f§lBot Guard§r\n§8Level Medium",
        layout: "guard",
        watching,
        buttons: [
            { text: "§bBot Moderation§r\n§8on", card: { text: "§f§lBot Moderation", icon: guardIcon("moderation") }, run: () => {} },
            { text: "§bDetected Bots (0)", card: { text: "§f§lDetected Bots", icon: guardIcon("detected") }, run: () => {} }
        ],
        back: () => {}
    })
    setBeta(false)
    await menu(boss, GUARD_SPEC(true))
    check("on Default it is the plain list it always was", [titleOf(lastForm()), partsOf(lastForm(), "button").map(p => [p[1], p[2]])],
        [hubTitle("settings", "Bot Guard"), [["§bBot Moderation§r\n§8on", null], ["§bDetected Bots (0)", null], ["§8< Back", null]]])
    setBeta(true)
    await menu(boss, GUARD_SPEC(true))
    check("on Beta, while it watches, it asks for Bot Guard's frame lit up", titleOf(lastForm()).endsWith(BETA_LOOK + GUARD_ON), true)
    const buttons = partsOf(lastForm(), "button")
    check("its pages are cards with their pictures", buttons.slice(0, 2).map(p => [p[1], p[2]]),
        [[cardText("§f§lBot Moderation"), guardIcon("moderation")], [cardText("§f§lDetected Bots"), guardIcon("detected")]])
    check("and Back stays a row", buttons[2][1], "§7< Back")
    check("its status is the body, lifted", partsOf(lastForm(), "body")[0][1], "§f§lBot Guard§r\n§7Level Medium")
    await menu(boss, GUARD_SPEC(false))
    check("switched off, the frame is asked for unlit", [titleOf(lastForm()).endsWith(BETA_LOOK + GUARD), titleOf(lastForm()).includes(GUARD_ON)], [true, false])
    setBeta(false)
}

console.log("\n— a long form in sections —")
{
    const FIELDS = [
        { type: "label", label: "§lFirst" },
        { id: "a", type: "toggle", label: "a", default: true },
        { type: "divider" },
        { type: "label", label: "§lSecond" },
        { id: "b", type: "toggle", label: "b" }
    ]
    __ui.answers.length = 0
    __ui.answers.push({ canceled: false, formValues: [undefined, true, undefined, undefined, false] })
    const kept = await modal(boss, "Sections", FIELDS, { submit: "Continue", strict: true })
    const form = lastForm()
    check("labels and dividers are drawn in order", form.parts.filter(p => ["label", "divider", "toggle"].includes(p[0])).map(p => p[0]),
        ["label", "toggle", "divider", "label", "toggle"])
    check("the button says Continue", partsOf(form, "submit")[0]?.[1], "Continue")
    check("answers are read past the labels and dividers", kept, { a: true, b: false })
    __ui.answers.push({ canceled: false, formValues: [true, false] })
    check("a game that drew no labels is read by the switches alone", await modal(boss, "Sections", FIELDS, { strict: true }), { a: true, b: false })
    __ui.answers.push({ canceled: false, formValues: [undefined, true, undefined] })
    check("answers that line up with nothing are refused", await modal(boss, "Sections", FIELDS, { strict: true }), INCOMPLETE)
    __ui.answers.push({ canceled: true })
    check("closing it is still nothing", await modal(boss, "Sections", FIELDS, { strict: true }), undefined)
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
    // 3.1.6: Set up spans both columns above the six while nothing has been changed.
    check("Set up comes first, across both columns, with its picture",
        [faces[0][1].split("\n")[0].replace(/§./g, ""), faces[0][1].endsWith(WIDE), faces[0][2]], ["Set up Admin+", true, tileIcon("setup")])
    check("six tiles", faces.slice(1).map(p => p[1].split("\n")[0].replace(/§./g, "")), ["Players", "Ranks", "Places", "Logs", "Server", "Help"])
    check("each with its picture", faces.slice(1).map(p => p[2]),
        ["players", "ranks", "places", "logs", "server", "help"].map(tileIcon))
    check("still starting on the left: Set up takes no place in the columns",
        faces.slice(1).map(p => p[1].endsWith(TILE_LEFT)), [true, false, true, false, true, false])
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
    check("/menu is drawn as tiles too", titleOf(lastForm()).includes(BETA_LOOK + TILES), true)
    check("with a picture on every tile", partsOf(lastForm(), "button").every(p => typeof p[2] === "string"), true)

    // 2.12.3, the user: "in /menu, you can see your skin and then right by it
    // it has your rank, and stuff". A Profile card above the tiles.
    check("/menu asks for a Profile card above its tiles", titleOf(lastForm()).endsWith(BETA_LOOK + TILES + PROFILE), true)
    check("its body is the card's words", partsOf(lastForm(), "body")[0]?.[1], lift(profileLines(member).join("\n")))
    check("starting with their name", plainText(profileLines(member)[0]), "Mia")
    check("then their tag", profileLines(member).map(plainText).includes("[Member]"), true)
    check("never more than the card holds", profileLines(member).length <= 6, true)
    check("/admin has no card", titleOf(panel).includes(PROFILE), false)
    setBeta(false)
    await openMenu(member)
    check("on Default, /menu has no card and the body it always had",
        [titleOf(lastForm()).includes(PROFILE), partsOf(lastForm(), "body")[0]?.[1]], [false, statsLines(member).join("\n")])
    setBeta(true)

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

console.log("\n— a menu builds only the layout that shows (3.1.7) —")
{
    // Every Admin+ menu carries every layout it might draw (six for buttons,
    // four for fields) and hides all but one. Before 3.1.7 each hidden copy
    // built every button too, and the three chest grids built 153 slots for
    // every menu: the stall the user felt opening /items and /invsee. The
    // game's own pattern is a length bound only while visible.
    const files = ["adminplus_beta.json", "adminplus_ui.json", "server_form.json"]
    const lengths = []
    const walk = (node, file) => {
        if (Array.isArray(node)) return node.forEach(n => walk(n, file))
        if (!node || typeof node !== "object") return
        for (const b of Array.isArray(node.bindings) ? node.bindings : []) {
            if (["#collection_length", "#maximum_grid_items"].includes(b?.binding_name_override)) lengths.push([file, b])
        }
        Object.values(node).forEach(v => walk(v, file))
    }
    for (const file of files) walk(JSON.parse(readFileSync(new URL(`../Admin+ RP/ui/${file}`, import.meta.url), "utf8")), file)
    check("every list and grid of ours is counted", lengths.length, 15)
    check("and builds only while it shows", lengths.filter(([, b]) => b.binding_condition !== "visible").map(([f]) => f), [])
    const form = JSON.parse(readFileSync(new URL("../Admin+ RP/ui/server_form.json", import.meta.url), "utf8"))
    check("the game's own button list and field list are copied with the same condition",
        [form.long_form_dynamic_buttons_panel?.collection_name, form.generated_contents?.collection_name], ["form_buttons", "custom_form"])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
