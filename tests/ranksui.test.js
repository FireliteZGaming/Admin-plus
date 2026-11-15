import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { ladder, getRank, saveRank, setRanks, grantRank, heldRankIds, onPlayerJoin, applyPreset, nameFontFor, whereToGrant, nodeLabels, PERMISSION_NODES, topWeight } from "../Admin+ BP/scripts/core/ranks.js"
import { createRankScreen, basicsScreen, ranksScreen, rankScreen, playerRankScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
import { staffTemplate } from "../Admin+ BP/scripts/core/rankTemplates.js"
import { basicsMenu, openActionsFor } from "../Admin+ BP/scripts/features/actions.js"
import { getNickname, getNameFont } from "../Admin+ BP/scripts/core/identity.js"
import { FONT_IDS, applyFont } from "../Admin+ BP/scripts/core/fonts.js"
import { STYLE_IDS } from "../Admin+ BP/scripts/core/nametag.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The rank editor as a person uses it: a typed name with its colour codes,
// Bold and Italic switches, a font, a type and a place on the list. Driven
// through the real forms, with answers queued in the order the forms open.

const boss = {
    id: "rui-boss", name: "Boss", nameTag: "Boss", commandPermissionLevel: 0,
    getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
}
__test.players.push(boss)
onPlayerJoin(boss)
applyPreset("server")
setRanks(boss.id, ["owner"], boss.name)

const submit = (...formValues) => ({ canceled: false, formValues })
const press = selection => ({ canceled: false, selection })
const order = () => ladder().map(r => r.id)
const at = id => ladder().findIndex(r => r.id === id)
const font = id => FONT_IDS.indexOf(id)
const TYPE = { default: 0, staff: 1, cosmetic: 2, unlisted: 3 }
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const partsOf = (form, kind) => form.parts.filter(p => p[0] === kind).map(p => p[1])

// + New rank in short steps (2.11.4, the user's design of 2026-11-13):
//   New rank (name, bold, italic, font, type) ▸ Template (staff only) ▸
//   Permissions (one long list) ▸ Where it goes ▸ Create this rank?
// Answers are queued in the order the forms open. The name form's answers
// are name, bold, italic, font, type. Create this rank? is Back (0) then
// Create (1).
const said = []
boss.sendMessage = m => said.push(String(m))
const lastSaid = () => (said.at(-1) ?? "").replace(/§./g, "")
const titleOf = form => (form.parts.find(p => p[0] === "title")?.[1] ?? "").replace(/§./g, "")
const shownSince = from => __ui.shown.slice(from).map(titleOf)
const CREATE = press(1), BACK = press(0)
const BASICS = PERMISSION_NODES.Everyone
// What any player's rank can be given: the basics and, since 2.12.0, Personalization.
const MEMBER_SECTIONS = ["Everyone", "Personalization"]
/** The places a new rank can go for Boss: every rank below theirs, as the form lists them. */
const places = () => ladder().filter(r => (r.weight ?? 0) < topWeight(boss))
const above = id => places().findIndex(r => r.id === id)
const AT_THE_BOTTOM = () => places().length
/**
 * The long Permissions form answered as the game would: a place for each label
 * and divider, then a value per switch, section by section. Boss can give
 * everything, so every switch is on the form.
 */
function permissions(staff, on = node => BASICS.includes(node)) {
    const values = []
    const groups = staff ? Object.keys(PERMISSION_NODES) : MEMBER_SECTIONS
    groups.forEach((group, i) => {
        if (i) values.push(undefined)
        values.push(undefined)
        for (const node of PERMISSION_NODES[group]) values.push(on(node))
    })
    return submit(...values)
}
const name = (text, type = TYPE.default, o = {}) => submit(text, o.bold ?? false, o.italic ?? false, o.font ?? 0, type)
/** A Default rank all the way through: name, permissions, place, Create. */
function makeDefault(text, o = {}, place = () => above("member")) {
    __ui.answers.push(name(text, TYPE.default, o), permissions(false), submit(place()), CREATE)
}

console.log("\n— a new rank in short steps —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    makeDefault("§eHelper")
    await createRankScreen(boss, () => {})

    const first = __ui.shown[from]
    check("the first step is New rank", titleOf(first), "Admin+ | New rank")
    check("asking name, bold, italic, font and type", first.parts.filter(p => ["text", "toggle", "dropdown"].includes(p[0])).map(p => p[0]),
        ["text", "toggle", "toggle", "dropdown", "dropdown"])
    check("with no 'Also gets everything from' or 'Put it just below'",
        first.parts.some(p => /Also gets everything|just below/.test(String(p[1]))), false)
    check("and a Continue button", first.parts.find(p => p[0] === "submit")?.[1], "Continue")
    check("a Default rank goes name, permissions, where it goes, Create",
        shownSince(from).slice(0, 4), ["Admin+ | New rank", "Admin+ | Permissions · Helper", "Admin+ | Where it goes", "Admin+ | Create this rank?"])

    const made = getRank("helper")
    check("the rank exists, its id made from the letters", !!made, true)
    check("the § code colours it", made?.display, "§eHelper")
    check("and what was typed is kept for the box", made?.text, "§eHelper")
    check("it starts with the basics, copied once", made?.perms, BASICS)
    check("and gets nothing from another rank", made?.inherits, [])
    check("it sits just above the rank picked", order().indexOf("helper"), order().indexOf("member") - 1)
    check("a Default rank is not staff", made?.staff, false)
    check("and its type is Default", made?.type, "default")
}

console.log("\n— the steps say what they ask —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    __ui.answers.push(name("§eLook"), permissions(false))
    await createRankScreen(boss, () => {})
    const perms = __ui.shown[from + 1]
    check("the basics start on, from the new players' rank",
        perms.parts.filter(p => p[0] === "toggle").map(p => p[2]?.defaultValue), [...BASICS.map(() => true), ...PERMISSION_NODES.Personalization.map(() => false)])
    check("under a section title", perms.parts.find(p => p[0] === "label")?.[1], "§lWhat they can use")
    check("its button says Continue", perms.parts.find(p => p[0] === "submit")?.[1], "Continue")
    const place = __ui.shown[from + 2]
    const choices = place.parts.find(p => p[0] === "dropdown")
    check("Where it goes lists the ranks below yours, then At the bottom",
        choices?.[2].map(o => o.replace(/§./g, "")), [...places().map(r => r.display.replace(/§./g, "")), "At the bottom"])
    check("and starts just above the new players' rank", choices?.[3]?.defaultValueIndex, above("member"))
    check("closing a step makes nothing", !!getRank("look"), false)
}

console.log("\n— Bold, Italic and fonts —")
{
    makeDefault("§eBold one", { bold: true })
    await createRankScreen(boss, () => {})
    check("Bold puts §l after the colour", getRank("bold_one")?.display, "§e§lBold one")

    makeDefault("§c§lStrong")
    await createRankScreen(boss, () => {})
    check("a name typed with its own §l stays bold with the switch left off", getRank("strong")?.display, "§c§lStrong")

    makeDefault("Plain", { italic: true })
    await createRankScreen(boss, () => {})
    check("no colour typed shows white, and Italic adds §o", getRank("plain")?.display, "§f§oPlain")
    check("the box keeps it without the white", getRank("plain")?.text, "§oPlain")

    makeDefault("§bTiny", { font: font("smallcaps") })
    await createRankScreen(boss, () => {})
    check("a font changes the letters on the tag", getRank("tiny")?.display, `§b${applyFont("Tiny", "smallcaps")}`)
    check("but the box keeps the letters as typed", getRank("tiny")?.text, "§bTiny")
    check("and the id comes from the typed letters", !!getRank("tiny"), true)
    check("a new rank's font goes on its tag only", [getRank("tiny")?.fontTag, getRank("tiny")?.fontName, getRank("tiny")?.fontChat], [true, false, false])
}

console.log("\n— a staff rank from a template —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    __ui.answers.push(name("§9Guard", TYPE.staff), press(0), submit(above("member")), CREATE)
    await createRankScreen(boss, () => {})
    const picker = __ui.shown[from + 1]
    check("a Staff rank asks for a template next", titleOf(picker), "Admin+ | Template")
    check("Mod, Admin, Manager and Owner, then Permissions and Back",
        partsOf(picker, "button").map(b => b.split("\n")[0].replace(/§./g, "")), ["Mod", "Admin", "Manager", "Owner", "Permissions", "< Back"])
    check("with a template it skips Permissions",
        shownSince(from).slice(0, 4), ["Admin+ | New rank", "Admin+ | Template", "Admin+ | Where it goes", "Admin+ | Create this rank?"])
    const guard = getRank("guard")
    check("Staff is staff", guard?.staff, true)
    check("and in the order, just above the rank picked", order().indexOf("guard"), order().indexOf("member") - 1)
    check("it gets the template's permissions", guard?.perms, [...staffTemplate("mod").perms])
    check("which include the basics", BASICS.every(n => guard?.perms.includes(n)), true)
    check("and wears the template's badge", guard?.meta?.badge, "hammer")
    check("copied, not linked", guard?.inherits, [])

    __ui.answers.push(name("§4Second", TYPE.staff), press(3), submit(above("coowner")), CREATE)
    await createRankScreen(boss, () => {})
    check("the Owner template gives everything", getRank("second")?.perms, ["*"])

    // 2.11.5, from the user's screenshot of the cards in game: bold carried
    // from each card's name into every line under it, and Owner's words ran
    // out of the bottom of its card.
    const BETA_ITEM = { id: "adminplus:channel_beta" }
    __test.itemTypes.push(BETA_ITEM)
    __ui.answers.length = 0
    const at = __ui.shown.length
    __ui.answers.push(name("§9Look", TYPE.staff))
    await createRankScreen(boss, () => {})
    const cards = partsOf(__ui.shown[at + 1], "button").slice(0, 4)
    check("in Beta each card's name closes its bold, so the lines under it stay plain",
        cards.map(c => c.split("\n")[0].endsWith("§r")), [true, true, true, true])
    check("and Owner's warning is the short one", cards[3]?.includes("Only for someone you fully trust."), true)
    __test.itemTypes.splice(__test.itemTypes.indexOf(BETA_ITEM), 1)
    check("and the crown", getRank("second")?.meta?.badge, "crown")
    check("and it can go just under the maker's own rank", order().indexOf("second"), order().indexOf("owner") + 1)
}

console.log("\n— a staff rank picked switch by switch —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    const picked = ["warp.use", "admin.warn", "admin.kick"]
    __ui.answers.push(name("§3Warden", TYPE.staff), press(4), permissions(true, n => picked.includes(n)), submit(AT_THE_BOTTOM()), CREATE)
    await createRankScreen(boss, () => {})
    check("Permissions comes after the template step",
        shownSince(from).slice(0, 5), ["Admin+ | New rank", "Admin+ | Template", "Admin+ | Permissions · Warden", "Admin+ | Where it goes", "Admin+ | Create this rank?"])
    const list = __ui.shown[from + 2]
    check("every section is on one form, a title each",
        partsOf(list, "label"), Object.keys(PERMISSION_NODES).map(g => `§l${g === "Everyone" ? "What they can use" : g}`))
    check("split by dividers", list.parts.filter(p => p[0] === "divider").length, Object.keys(PERMISSION_NODES).length - 1)
    check("with a switch for every permission", list.parts.filter(p => p[0] === "toggle").length, Object.values(PERMISSION_NODES).flat().length)
    check("it gets exactly the switches turned on", getRank("warden")?.perms, picked)
    check("At the bottom puts it under every rank", order().at(-1), "warden")
    check("with no template there is no badge picked", getRank("warden")?.meta, {})
}

console.log("\n— cosmetic and unlisted ranks —")
{
    __ui.answers.length = 0
    let from = __ui.shown.length
    __ui.answers.push(name("§6Builder", TYPE.cosmetic), CREATE)
    await createRankScreen(boss, () => {})
    check("Cosmetic goes straight to Create this rank?", shownSince(from).slice(0, 2), ["Admin+ | New rank", "Admin+ | Create this rank?"])
    check("which offers Back, then Create", partsOf(__ui.shown[from + 1], "button").map(b => b.replace(/§./g, "")), ["< Back", "Create"])
    const builder = getRank("builder")
    check("Cosmetic has no place in the order", order().includes("builder"), false)
    check("weighs nothing", builder?.weight, 0)
    check("and has no permissions", [builder?.perms, builder?.inherits], [[], []])

    from = __ui.shown.length
    __ui.answers.push(name("§7Tester", TYPE.unlisted), permissions(false), CREATE)
    await createRankScreen(boss, () => {})
    check("Unlisted skips Where it goes", shownSince(from).slice(0, 3), ["Admin+ | New rank", "Admin+ | Permissions · Tester", "Admin+ | Create this rank?"])
    const tester = getRank("tester")
    check("Unlisted has no place in the order either", order().includes("tester"), false)
    check("but gives permissions", tester?.perms, BASICS)
}

console.log("\n— Back keeps what you chose —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    __ui.answers.push(name("§aScout"), permissions(false), submit(above("mod")), BACK, submit(above("member")), CREATE)
    await createRankScreen(boss, () => {})
    const again = __ui.shown.slice(from).filter(f => titleOf(f) === "Admin+ | Where it goes")[1]
    check("Back shows the step before", !!again, true)
    check("with the place picked still picked", again?.parts.find(p => p[0] === "dropdown")?.[3]?.defaultValueIndex, above("mod"))
    check("and the second choice is the one kept", order().indexOf("scout"), order().indexOf("member") - 1)

    const start = __ui.shown.length
    __ui.answers.push(name("§bRanger", TYPE.staff, { bold: true }), press(5))
    await createRankScreen(boss, () => {})
    const named = __ui.shown[start + 2]
    check("Back from the templates shows New rank again", titleOf(named), "Admin+ | New rank")
    check("with the name typed", named?.parts.find(p => p[0] === "text")?.[3]?.defaultValue, "§bRanger")
    check("and the switches as they were", named?.parts.filter(p => p[0] === "toggle").map(p => p[2]?.defaultValue), [true, false])
    check("and nothing is made until Create", !!getRank("ranger"), false)
}

console.log("\n— a short answer saves nothing —")
{
    __ui.answers.length = 0
    __ui.answers.push(name("§eShort"), submit(true, true))
    await createRankScreen(boss, () => {})
    check("answers that don't line up with the switches make nothing", !!getRank("short"), false)
    check("and it says so", lastSaid().includes("Not every switch came back"), true)
}

console.log("\n— the same name twice, and a blank one —")
{
    makeDefault("§aHelper")
    await createRankScreen(boss, () => {})
    check("a second Helper gets its own id rather than overwriting the first", !!getRank("helper2"), true)
    check("and the first is untouched", getRank("helper")?.display, "§eHelper")

    const before = order()
    __ui.answers.length = 0
    __ui.answers.push(name("  §c  "))
    await createRankScreen(boss, () => {})
    check("a name that is only codes makes nothing", order(), before)
    check("and asks for a name", lastSaid().endsWith("Give the rank a name."), true)
}

// Basics on a rank in the order, in field order: name, bold, italic, font,
// apply to tag, apply to name, apply to messages, type, chat colour, new
// players get it. No Name colour since 2.12.10 (2.12.3 in Beta): players
// choose their own in /menu, behind the rank's Name effect switch.
const basics = (o = {}) => submit(
    o.name ?? "§eHelper", o.bold ?? false, o.italic ?? false, o.font ?? 0,
    o.fontTag ?? true, o.fontName ?? false, o.fontChat ?? false,
    o.type ?? TYPE.default, o.chat ?? "", o.isDefault ?? false)

console.log("\n— Basics: the name, its switches and its font —")
{
    __ui.answers.push(basics({ name: "§cHelpers" }))
    await basicsScreen(boss, "helper", () => {})
    check("the name is retyped in the box", getRank("helper")?.display, "§cHelpers")
    check("the id does not change with the name, so holders keep it", !!getRank("helper"), true)

    // The box opens with what was typed, and the switches read it.
    saveRank("vipplus", { display: "§e§lVIP§6+", text: undefined })
    __ui.answers.push(basics({ name: "§e§lVIP§6+", bold: true }))
    await basicsScreen(boss, "vipplus", () => {})
    const form = lastForm()
    check("an old rank's box shows its name with § codes", form.parts.find(p => p[0] === "text")?.[3]?.defaultValue, "§e§lVIP§6+")
    check("and Bold starts on, because the name has §l", form.parts.filter(p => p[0] === "toggle")[0]?.[2]?.defaultValue, true)
    check("left as it was, the name keeps its own codes", getRank("vipplus")?.display, "§e§lVIP§6+")

    __ui.answers.push(basics({ name: "§e§lVIP§6+", bold: false }))
    await basicsScreen(boss, "vipplus", () => {})
    check("Bold switched off takes every §l out", getRank("vipplus")?.display, "§eVIP§6+")

    __ui.answers.push(basics({ name: "§eVIP§6+", bold: true }))
    await basicsScreen(boss, "vipplus", () => {})
    check("Bold switched on reaches every colour in the name", getRank("vipplus")?.display, "§e§lVIP§6§l+")

    __ui.answers.push(basics({ name: "", bold: true }))
    await basicsScreen(boss, "vipplus", () => {})
    check("an emptied box keeps the old name", getRank("vipplus")?.display, "§e§lVIP§6§l+")

    __ui.answers.push(basics({ name: "§cHelpers", font: font("circled"), fontTag: false, fontName: true }))
    await basicsScreen(boss, "helper", () => {})
    check("the font can stay off the tag", getRank("helper")?.display, "§cHelpers")
    check("and still be saved for names", [getRank("helper")?.font, getRank("helper")?.fontName], ["circled", true])
    const holder = {
        id: "rui-holder", name: "Hal", nameTag: "Hal", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
    }
    __test.players.push(holder)
    onPlayerJoin(holder)
    grantRank(holder.id, "helper", holder.name)
    check("so its players' names use it", nameFontFor(holder), "circled")

    __ui.answers.push(basics({ name: "§cHelpers", font: font("circled"), fontTag: true }))
    await basicsScreen(boss, "helper", () => {})
    check("on the tag, the tag's letters change", getRank("helper")?.display, `§c${applyFont("Helpers", "circled")}`)
}

console.log("\n— Basics: the chat colour, and no name colour —")
{
    __ui.answers.push(basics({ chat: "§e" }))
    await basicsScreen(boss, "helper", () => {})
    const form = __ui.shown[__ui.shown.length - 1]
    check("Basics has no Name colour since 2.12.10", form.parts.some(p => String(p[1] ?? "").includes("Name colour")), false)
    check("the chat colour is typed as a code", getRank("helper")?.meta?.["chat.colour"], "e")

    __ui.answers.push(basics({ chat: "b" }))
    await basicsScreen(boss, "helper", () => {})
    check("the letter alone works too", getRank("helper")?.meta?.["chat.colour"], "b")

    __ui.answers.push(basics({ chat: "§l" }))
    await basicsScreen(boss, "helper", () => {})
    check("bold is not a colour, so it clears the chat colour", "chat.colour" in (getRank("helper")?.meta ?? {}), false)
}

console.log("\n— Basics: the type —")
{
    __ui.answers.push(basics({ type: TYPE.staff }))
    await basicsScreen(boss, "helper", () => {})
    check("the type list replaces the staff switch", getRank("helper")?.staff, true)

    __ui.answers.push(basics({ type: TYPE.cosmetic }))
    await basicsScreen(boss, "helper", () => {})
    check("made cosmetic, it leaves the order", order().includes("helper"), false)

    // A cosmetic rank's form asks only what applies to it: name, bold,
    // italic, font, apply to the tag, type.
    __ui.answers.push(submit("§cHelpers", false, false, 0, true, TYPE.default))
    await basicsScreen(boss, "helper", () => {})
    const cosmeticForm = __ui.shown[__ui.shown.length - 1]
    check("a cosmetic rank's Basics has six fields", cosmeticForm.parts.filter(p => ["text", "toggle", "dropdown", "slider"].includes(p[0])).length, 6)
    check("made Default again, it rejoins the order", order().includes("helper"), true)
    check("at the bottom, the safe end", order()[order().length - 1], "helper")

    const member = getRank("member")
    check("(the starting rank is Member)", member?.default, true)
    __ui.answers.push(basics({ name: "§7Member", type: TYPE.cosmetic, isDefault: true }))
    await basicsScreen(boss, "member", () => {})
    check("the starting rank cannot leave the order", getRank("member")?.type ?? "default", "default")
}

console.log("\n— the rank list is split in two —")
{
    __ui.answers.push(press(0))
    await ranksScreen(boss, () => {})
    const list = __ui.shown[__ui.shown.length - 2]
    // Bold labels, not headers: a header drew far too big between the
    // dividers (the user, 2026-11-12).
    check("no headers, they draw too big", partsOf(list, "header"), [])
    const titles = partsOf(list, "label").filter(text => text.startsWith("§l"))
    check("two sections, ranks in the order first", titles, ["§lIn the order", "§lCosmetic and unlisted"])
    check("with a divider between them", list.parts.some(p => p[0] === "divider"), true)
    const buttons = partsOf(list, "button")
    const firstCosmetic = buttons.findIndex(text => text.includes("cosmetic ·"))
    const lastRanked = buttons.map(text => /^§8\d+\. /.test(text)).lastIndexOf(true)
    check("every ranked button comes before every cosmetic one", lastRanked < firstCosmetic, true)
    // Badges are on for everyone since 2.12.10, and a staff rank wears its
    // badge (a private-use glyph) instead of the word staff.
    check("each button says its type, in words or by its badge",
        buttons[0].includes("\n§8staff") || /[\uE000-\uF8FF]/.test(buttons[0]), true)
    // The sections are not buttons, so the first button is still rank 1.
    check("pressing the first button opens the strongest rank", lastForm().parts.find(p => p[0] === "title")?.[1]?.includes("Owner"), true)
}

console.log("\n— a player's Basics: Display or Ranks —")
{
    const nova = {
        id: "rui-nova", name: "Nova", nameTag: "Nova", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
    }
    __test.players.push(nova)
    onPlayerJoin(nova)

    const start = __ui.shown.length
    __ui.answers.push(press(0), submit("§b§lStar", font("smallcaps")))
    await basicsMenu(boss, nova, () => {})
    const menuForm = __ui.shown[start]
    check("Basics offers Display and Ranks", partsOf(menuForm, "button").map(t => t.split("\n")[0]), ["§bDisplay", "§bRanks", "§8< Back"])
    check("Display sets the name, & codes and all", getNickname(nova), "§b§lStar")
    check("and the font", getNameFont(nova), "smallcaps")

    __ui.answers.push(press(0), submit("Nova", 0))
    await basicsMenu(boss, nova, () => {})
    check("their own gamertag, typed plain, means no display name", getNickname(nova), undefined)
    check("Normal means no font of their own", getNameFont(nova), "normal")

    __ui.answers.push(press(1))
    await basicsMenu(boss, nova, () => {})
    check("Ranks opens their ranks", lastForm().parts.find(p => p[0] === "title")?.[1]?.includes("Nova"), true)
}

console.log("\n— a player's tag order skips their unlisted ranks —")
{
    const kit = {
        id: "rui-kit", name: "Kit", nameTag: "Kit", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
    }
    __test.players.push(kit)
    onPlayerJoin(kit)
    saveRank("artist", { display: "§dArtist", type: "cosmetic" })
    setRanks(kit.id, ["member", "builder", "tester", "artist"], kit.name)

    // Their screen, Change the tag order, the third shown tag (Artist), Move up.
    __ui.answers.push(press(2), press(2), press(0))
    await playerRankScreen(boss, kit.id, kit.name, () => {})
    const held = heldRankIds(kit.id)
    check("Artist moved above Builder", held.indexOf("artist") < held.indexOf("builder"), true)
    check("past the hidden Tester, which stays put", held.indexOf("tester"), 2)
}

console.log("\n— \"switch it on here\" names the real buttons —")
// "Ranks ▸ the rank ▸ Permissions ▸ Administrative ▸ Pranks ▸ smite", not
// "admin.smite". Moved here from the orbital test when that went in 2.8.2, and
// walked through the real screens, so the path and the buttons cannot drift.
{
    const at = "Ranks ▸ the rank ▸ Permissions ▸ "
    check("a prank node", whereToGrant("admin.smite"), `${at}Administrative ▸ Pranks ▸ smite`)
    check("a punishment node", whereToGrant("admin.banperm"), `${at}Administrative ▸ Punishments ▸ banperm`)
    check("the switch for /clock and /sky", whereToGrant("admin.commands"), `${at}Administrative ▸ Server settings ▸ time and weather`)
    check("an everyday node sits under Member", whereToGrant("warp.use"), `${at}Member ▸ What they can use ▸ warp`)
    check("a node nobody lists still gets an answer", whereToGrant("made.up"), `${at}made.up`)
    for (const [group, nodes] of Object.entries(PERMISSION_NODES)) {
        const labels = nodeLabels(nodes)
        const half = group === "Everyone" ? "Member ▸ What they can use" : `Administrative ▸ ${group}`
        const wrong = nodes.filter((n, i) => whereToGrant(n) !== `${at}${half} ▸ ${labels[i]}`)
        check(`${group}: every node points at its button`, wrong, [])
    }

    // And the buttons really are called that. A rank ▸ Permissions ▸ Member.
    // Found by name: a Badge button joins the rank screen when badges are on
    // (everyone's since 2.12.10), which moves Permissions down one.
    const permissionsAt = async rankId => {
        __ui.answers.push({ canceled: true })
        await rankScreen(boss, rankId, () => {})
        return partsOf(lastForm(), "button").findIndex(b => b.includes("Permissions"))
    }
    __ui.answers.push(press(await permissionsAt("member")), press(0))
    await rankScreen(boss, "member", () => {})
    check("Permissions ▸ Member opens on What they can use",
        partsOf(lastForm(), "button")[0].includes("What they can use"), true)
    // A staff rank ▸ Permissions ▸ Administrative:
    __ui.answers.push(press(await permissionsAt("mod")), press(1))
    await rankScreen(boss, "mod", () => {})
    const groups = partsOf(lastForm(), "button")
    check("Permissions ▸ Administrative lists every staff group",
        Object.keys(PERMISSION_NODES).filter(g => !MEMBER_SECTIONS.includes(g)).filter(g => !groups.some(b => b.includes(g))), [])
}

console.log("\n— a player's screen: Basics, Actions, then Inventory and Warnings —")
// Asked for on 2026-11-12: teleport, gamemode, kick and ban under Actions,
// with warnings and inventory still at the bottom.
{
    const zed = {
        id: "rui-zed", name: "Zed", nameTag: "Zed", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {},
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension, getGameMode: () => "survival"
    }
    __test.players.push(zed)
    onPlayerJoin(zed)
    const words = form => form.parts.filter(p => p[0] === "button")
        .map(p => String(p[1]).split("\n")[0].replace(/§./g, "").replace(/ ·.*$/, "").trim())

    const start = __ui.shown.length
    __ui.answers.push(press(1))
    await openActionsFor(boss, zed.id, zed.name, () => {})
    const screen = __ui.shown[start], actions = __ui.shown[start + 1]
    check("the player screen", words(screen), ["Basics", "Actions", "Inventory", "Warnings", "< Back"])
    check("the Actions button lists what is inside",
        String(screen.parts.filter(p => p[0] === "button")[1][1]).split("\n")[1].replace(/§./g, ""),
        "teleport, gamemode, freeze, TPA, mute, kick, ban")
    check("Actions holds the rest, mildest first",
        words(actions), ["Teleport", "Gamemode", "❄ Freeze", "Close their TPA", "Mute", "Kick", "Ban", "< Back"])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
