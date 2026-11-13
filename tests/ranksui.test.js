import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { ladder, getRank, saveRank, setRanks, grantRank, heldRankIds, onPlayerJoin, applyPreset, nameFontFor, whereToGrant, nodeLabels, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
import { createRankScreen, basicsScreen, ranksScreen, rankScreen, playerRankScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
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

// New rank, in field order: name, bold, italic, font, type, "also gets
// everything from" (0 is "no other rank", so ranks start at 1), "put it just
// below".
console.log("\n— a new rank from a typed name —")
{
    __ui.answers.length = 0
    __ui.answers.push(submit("§eHelper", false, false, 0, TYPE.default, at("member") + 1, at("mod")))
    await createRankScreen(boss, () => {})

    const made = getRank("helper")
    check("the rank exists, its id made from the letters", !!made, true)
    check("the & code colours it", made?.display, "§eHelper")
    check("and what was typed is kept for the box", made?.text, "§eHelper")
    check("it gets everything the chosen rank has", made?.inherits, ["member"])
    check("it sits just below the rank picked", order().indexOf("helper"), order().indexOf("mod") + 1)
    check("so it is still above the new players' rank", at("helper") < at("member"), true)
    check("a Default rank is not staff", made?.staff, false)
    check("and its type is Default", made?.type, "default")
}

console.log("\n— Bold, Italic and fonts —")
{
    __ui.answers.push(submit("§eBold one", true, false, 0, TYPE.default, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("Bold puts §l after the colour", getRank("bold_one")?.display, "§e§lBold one")

    __ui.answers.push(submit("§c§lStrong", false, false, 0, TYPE.default, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("a name typed with its own §l stays bold with the switch left off", getRank("strong")?.display, "§c§lStrong")

    __ui.answers.push(submit("Plain", false, true, 0, TYPE.default, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("no colour typed shows white, and Italic adds §o", getRank("plain")?.display, "§f§oPlain")
    check("the box keeps it without the white", getRank("plain")?.text, "§oPlain")

    __ui.answers.push(submit("§bTiny", false, false, font("smallcaps"), TYPE.default, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("a font changes the letters on the tag", getRank("tiny")?.display, `§b${applyFont("Tiny", "smallcaps")}`)
    check("but the box keeps the letters as typed", getRank("tiny")?.text, "§bTiny")
    check("and the id comes from the typed letters", !!getRank("tiny"), true)
    check("a new rank's font goes on its tag only", [getRank("tiny")?.fontTag, getRank("tiny")?.fontName, getRank("tiny")?.fontChat], [true, false, false])
}

console.log("\n— the four rank types —")
{
    __ui.answers.push(submit("§9Guard", false, false, 0, TYPE.staff, at("member") + 1, at("mod")))
    await createRankScreen(boss, () => {})
    check("Staff is staff", getRank("guard")?.staff, true)
    check("and in the order", order().includes("guard"), true)

    __ui.answers.push(submit("§6Builder", false, false, 0, TYPE.cosmetic, at("member") + 1, 0))
    await createRankScreen(boss, () => {})
    const builder = getRank("builder")
    check("Cosmetic has no place in the order", order().includes("builder"), false)
    check("weighs nothing", builder?.weight, 0)
    check("and inherits nothing, even when a rank was picked", builder?.inherits, [])

    __ui.answers.push(submit("§7Tester", false, false, 0, TYPE.unlisted, at("member") + 1, 0))
    await createRankScreen(boss, () => {})
    const tester = getRank("tester")
    check("Unlisted has no place in the order either", order().includes("tester"), false)
    check("but can start with another rank's permissions", tester?.inherits, ["member"])
}

console.log("\n— the same name twice, and a blank one —")
{
    __ui.answers.push(submit("§aHelper", false, false, 0, TYPE.default, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("a second Helper gets its own id rather than overwriting the first", !!getRank("helper2"), true)
    check("and the first is untouched", getRank("helper")?.display, "§eHelper")

    const before = order()
    __ui.answers.push(submit("  §c  ", false, false, 0, TYPE.default, 0, 0))
    await createRankScreen(boss, () => {})
    check("a name that is only codes makes nothing", order(), before)
}

// Basics on a rank in the order, in field order: name, bold, italic, font,
// apply to tag, apply to name, apply to messages, type, name colour, chat
// colour, new players get it.
const basics = (o = {}) => submit(
    o.name ?? "§eHelper", o.bold ?? false, o.italic ?? false, o.font ?? 0,
    o.fontTag ?? true, o.fontName ?? false, o.fontChat ?? false,
    o.type ?? TYPE.default, o.nameColour ?? 0, o.chat ?? "", o.isDefault ?? false)

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

console.log("\n— Basics: name colour and chat colour —")
{
    const aqua = STYLE_IDS.indexOf("colour_aqua")
    const rainbow = STYLE_IDS.indexOf("rainbow")
    __ui.answers.push(basics({ nameColour: aqua, chat: "§e" }))
    await basicsScreen(boss, "helper", () => {})
    check("a plain name colour is stored as a still style", getRank("helper")?.meta?.["nametag.style"], "colour_aqua")
    check("the chat colour is typed as a code", getRank("helper")?.meta?.["chat.colour"], "e")

    __ui.answers.push(basics({ nameColour: rainbow, chat: "b" }))
    await basicsScreen(boss, "helper", () => {})
    check("a moving effect is the same list, further down", getRank("helper")?.meta?.["nametag.style"], "rainbow")
    check("the letter alone works too", getRank("helper")?.meta?.["chat.colour"], "b")

    __ui.answers.push(basics({ chat: "§l" }))
    await basicsScreen(boss, "helper", () => {})
    check("bold is not a colour, so it clears the chat colour", "chat.colour" in (getRank("helper")?.meta ?? {}), false)
    check("and Default name colour removes the value", "nametag.style" in (getRank("helper")?.meta ?? {}), false)
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
    check("each button says its type", buttons[0].includes("\n§8staff"), true)
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

    // And the buttons really are called that. A rank ▸ Permissions ▸ Member:
    __ui.answers.push(press(1), press(0))
    await rankScreen(boss, "member", () => {})
    check("Permissions ▸ Member opens on What they can use",
        partsOf(lastForm(), "button")[0].includes("What they can use"), true)
    // A staff rank ▸ Permissions ▸ Administrative:
    __ui.answers.push(press(1), press(1))
    await rankScreen(boss, "mod", () => {})
    const groups = partsOf(lastForm(), "button")
    check("Permissions ▸ Administrative lists every staff group",
        Object.keys(PERMISSION_NODES).filter(g => g !== "Everyone").filter(g => !groups.some(b => b.includes(g))), [])
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
