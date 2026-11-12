import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { ladder, getRank, saveRank, setRanks, onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { createRankScreen, basicsScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
import { STYLE_IDS } from "../Admin+ BP/scripts/core/nametag.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The rank editor as a person uses it: a name, a colour from a list, and a
// place on the list. No ids and no § codes to type. Driven through the real
// forms, with answers queued in the order the forms open.

const boss = {
    id: "rui-boss", name: "Boss", nameTag: "Boss", commandPermissionLevel: 0,
    getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
}
__test.players.push(boss)
onPlayerJoin(boss)
applyPreset("server")
setRanks(boss.id, ["owner"], boss.name)

const submit = (...formValues) => ({ canceled: false, formValues })
const order = () => ladder().map(r => r.id)
const at = id => ladder().findIndex(r => r.id === id)

console.log("\n— a new rank from a name and a colour —")
{
    const usable = ladder()
    // Name, colour (7 is Yellow), bold, staff, "also gets everything from"
    // (index 0 is "no other rank", so ranks start at 1), "put it just below".
    __ui.answers.length = 0
    __ui.answers.push(submit("Helper", 7, true, false, at("member") + 1, at("mod")))
    await createRankScreen(boss, () => {})

    const made = getRank("helper")
    check("the rank exists, its id made from the name", !!made, true)
    check("drawn in the colour picked from the list, bold", made?.display, "§e§lHelper")
    check("it gets everything the chosen rank has", made?.inherits, ["member"])
    check("and it sits just below the rank picked", order().indexOf("helper"), order().indexOf("mod") + 1)
    check("so it is still above the new players' rank", at("helper") < at("member"), true)
    check("it is not staff unless asked", made?.staff, false)
}

console.log("\n— the same name twice, and codes typed by hand —")
{
    __ui.answers.push(submit("Helper", 0, false, false, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("a second Helper gets its own id rather than overwriting the first", !!getRank("helper2"), true)
    check("and the first is untouched", getRank("helper")?.display, "§e§lHelper")
    check("\"No other rank\" means it starts with nothing", getRank("helper2")?.inherits, [])

    __ui.answers.push(submit("§c§lBuilder", 10, false, true, 0, at("member")))
    await createRankScreen(boss, () => {})
    check("§ codes typed into the name are dropped; the colour list decides",
        getRank("builder")?.display, "§bBuilder")
    check("and a staff rank is staff", getRank("builder")?.staff, true)

    const before = order()
    __ui.answers.push(submit("   ", 0, false, false, 0, 0))
    await createRankScreen(boss, () => {})
    check("a blank name makes nothing", order(), before)
}

// Basics, in field order: name, rank colour, bold, name colour, chat colour,
// staff, new players get it.
console.log("\n— changing the name and colour later, in Basics —")
{
    // One colour: the list can redraw it exactly.
    __ui.answers.push(submit("Helpers", 4, false, 0, 0, false, false))
    await basicsScreen(boss, "helper", () => {})
    check("a simple rank is redrawn from the list", getRank("helper")?.display, "§cHelpers")
    check("the id does not change with the name, so holders keep it", !!getRank("helper"), true)

    // Two colours, like VIP+: offered as "keep the current colours".
    saveRank("vipplus", { display: "§e§lVIP§6+" })
    __ui.answers.push(submit("VIP+", 0, true, 0, 0, false, false))
    await basicsScreen(boss, "vipplus", () => {})
    check("kept exactly when nothing else changed", getRank("vipplus")?.display, "§e§lVIP§6+")

    // The list is shifted by one there, so Red (fifth colour) is option 5.
    __ui.answers.push(submit("VIP+", 5, true, 0, 0, false, false))
    await basicsScreen(boss, "vipplus", () => {})
    check("and redrawn in one colour when a colour is picked", getRank("vipplus")?.display, "§c§lVIP+")
}

console.log("\n— name colour and chat colour live in Basics —")
{
    // Name colour options: Default, the 16 plain colours, then the moving
    // effects, in STYLE_IDS order. Chat colour: Default, then the 16 colours.
    const aqua = STYLE_IDS.indexOf("colour_aqua")
    const rainbow = STYLE_IDS.indexOf("rainbow")
    __ui.answers.push(submit("Helpers", 4, false, aqua, 8, false, false))
    await basicsScreen(boss, "helper", () => {})
    check("a plain name colour is stored as a still style", getRank("helper")?.meta?.["nametag.style"], "colour_aqua")
    check("and the chat colour as its colour code (Yellow is e)", getRank("helper")?.meta?.["chat.colour"], "e")

    __ui.answers.push(submit("Helpers", 4, false, rainbow, 0, false, false))
    await basicsScreen(boss, "helper", () => {})
    check("a moving effect is the same list, further down", getRank("helper")?.meta?.["nametag.style"], "rainbow")
    check("Default chat colour removes the value rather than storing one",
        "chat.colour" in (getRank("helper")?.meta ?? {}), false)

    __ui.answers.push(submit("Helpers", 4, false, 0, 0, false, false))
    await basicsScreen(boss, "helper", () => {})
    check("Default name colour removes it too, so a lower rank's can show through",
        "nametag.style" in (getRank("helper")?.meta ?? {}), false)

    __ui.answers.push(submit("Helpers", 4, false, 0, 0, true, false))
    await basicsScreen(boss, "helper", () => {})
    check("the staff switch lives in Basics", getRank("helper")?.staff, true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
