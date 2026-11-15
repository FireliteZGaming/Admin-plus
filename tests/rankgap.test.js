import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import {
    getRank, saveRank, deleteRank, moveRank, setRanks, heldRankIds, onPlayerJoin, applyPreset, rankState, rankType,
    canGiveNode, nodesBeyond, gainedBy, canReplaceRankList, allNodes, has, BUNDLES, PERMISSION_NODES,
    ranksTable, holdersTable
} from "../Admin+ BP/scripts/core/ranks.js"
import { rankScreen, createRankScreen, ranksScreen, presetsScreen, basicsScreen, playerRankScreen, ranksToGive } from "../Admin+ BP/scripts/features/ranksUI.js"
import { undoBlocked } from "../Admin+ BP/scripts/features/logsUI.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// THE RANK GAP (closed in 2.8.7). Anyone who could edit ranks could switch on
// a permission they did not have for a rank below them, then give that rank
// to themselves. The rule now: nobody below an owner or operator gives out a
// permission they don't have, and nobody raises their own power by changing
// ranks. Each door is tried here through the real screens.

const said = new Map()
function person(id, name, level = 0) {
    const p = {
        id, name, nameTag: name, commandPermissionLevel: level,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: m => said.get(id).push(String(m))
    }
    said.set(id, [])
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const plain = s => String(s ?? "").replace(/§./g, "")
const lastSaid = p => plain(said.get(p.id).at(-1))
const submit = (...formValues) => ({ canceled: false, formValues })
const press = selection => ({ canceled: false, selection })
const partsOf = (form, kind) => form.parts.filter(p => p[0] === kind)
const buttonsOf = form => partsOf(form, "button").map(p => plain(p[1]))
const titleOf = form => plain(partsOf(form, "title")[0]?.[1])
/** The first form shown since `from` whose title includes `text`. */
const formTitled = (text, from) => __ui.shown.slice(from).find(form => titleOf(form).includes(text))
// Staff tools: every section but the two any player's rank can have.
const ADMIN_GROUPS = Object.keys(PERMISSION_NODES).filter(group => !["Everyone", "Personalization"].includes(group))

applyPreset("server")
const boss = person("gap-boss", "Boss")
setRanks(boss.id, ["owner"], boss.name)

// Ally is an Admin who may also edit ranks. An Admin lacks a few things:
// permanent bans, Smite, Sudo, presets and two server switches.
saveRank("admin", { perms: [...getRank("admin").perms, "ranks.manage"] })
const ally = person("gap-ally", "Ally")
setRanks(ally.id, ["admin"], ally.name)
// A staff rank under Mod for Ally to edit, and a low rank the owner gave Smite.
saveRank("helper", { display: "§eHelper", type: "staff", weight: 45, perms: [] })
saveRank("jester", { display: "§dJester", type: "default", weight: 30, perms: ["admin.smite"] })
const pat = person("gap-pat", "Pat")

console.log("\n— what Ally has —")
{
    const lacking = allNodes().filter(node => !has(ally, node))
    check("an Admin lacks permanent bans and Smite", ["admin.banperm", "admin.smite"].every(n => lacking.includes(n)), true)
    check("so can't give them out", [canGiveNode(ally, "admin.banperm"), canGiveNode(ally, "admin.ban")], [false, true])
    check("a wildcard counts as everything it covers", [canGiveNode(ally, "*"), canGiveNode(ally, "chat.*")], [false, true])
    check("Jester gives one thing Ally lacks", nodesBeyond(ally, "jester"), ["admin.smite"])
    check("Mod gives nothing Ally lacks", nodesBeyond(ally, "mod"), [])
}

console.log("\n— the switches show only what the editor has —")
{
    // Ranks ▸ Helper ▸ Permissions ▸ Administrative ▸ Punishments, all on.
    const punish = PERMISSION_NODES["Punishments"]
    const from = __ui.shown.length
    __ui.answers.length = 0
    __ui.answers.push(press(1), press(1), press(1 + ADMIN_GROUPS.indexOf("Punishments")), submit(...punish.map(() => true)))
    await rankScreen(ally, "helper", () => {})
    const form = formTitled("Punishments", from)
    check("Permanent ban is left off the form", partsOf(form, "toggle").length, punish.length - 1)
    check("so Helper still can't permanently ban", rankState("helper", "admin.banperm"), "none")
    check("and what Ally has was saved", rankState("helper", "admin.ban"), "own")
    check("the message says one stayed as it was", lastSaid(ally).includes("The one you don't have stayed as it was."), true)
}

console.log("\n— ready-made sets switch on only what the presser has —")
{
    const keys = Object.keys(BUNDLES)
    const from = __ui.shown.length
    __ui.answers.push(press(1), press(1), press(0), press(keys.indexOf("everything")))
    await rankScreen(ally, "helper", () => {})
    check("Everything (*) is refused", getRank("helper").perms.includes("*"), false)
    check("and says why", lastSaid(ally).includes("You don't have these yourself"), true)
    const sets = formTitled("Ready-made sets", from)
    check("its button says so first", buttonsOf(sets).some(b => b.startsWith("Everything") && b.includes("you don't have")), true)

    // A set Ally only partly has. Server shape (Settings and Presets) was the
    // example until 2.12.9 hid presets (core/hold.js), which left it holding
    // Settings alone. Tidying up is the example now, with /lagclear denied to
    // Ally's rank for this check only.
    check("while presets are hidden, Server shape is Settings alone", BUNDLES.shape.nodes, ["admin.settings"])
    const adminPerms = [...getRank("admin").perms]
    saveRank("admin", { perms: [...adminPerms, "-admin.lagclear"] })
    __ui.answers.push(press(1), press(1), press(0), press(keys.indexOf("upkeep")))
    await rankScreen(ally, "helper", () => {})
    check("a mixed set switches on only what Ally has", ["admin.clearchat", "admin.lagclear"].map(n => getRank("helper").perms.includes(n)), [true, false])
    check("and says one stayed off", lastSaid(ally).includes("1 stayed off"), true)
    saveRank("admin", { perms: adminPerms })
}

console.log("\n— 'Also gets permissions from' lists only ranks Ally could give —")
{
    const from = __ui.shown.length
    __ui.answers.push(press(1), press(2))
    await rankScreen(ally, "helper", () => {})
    const names = partsOf(formTitled("Also gets permissions from", from), "toggle").map(p => plain(p[1]))
    check("Owner, Co-Owner, Manager and Jester can't be picked", names.filter(n => /Owner|Manager|Jester/.test(n)), [])
    check("Admin, Mod and Member can", ["Admin", "Mod", "Member"].every(n => names.includes(n)), true)
}

console.log("\n— a new rank can't start from more than its maker has —")
{
    const from = __ui.shown.length
    __ui.answers.length = 0
    // New rank as Staff, then Permissions (after the two templates Ally may use).
    __ui.answers.push(submit("§9Aide", false, false, 0, 1), press(2))
    await createRankScreen(ally, () => {})
    const picker = formTitled("Template", from)
    check("Ally is offered the Mod and Admin templates only", buttonsOf(picker).map(b => b.split("\n")[0]), ["Mod", "Admin", "Permissions", "< Back"])
    check("and told some were left out", plain(partsOf(picker, "body")[0]?.[1]).includes("aren't listed"), true)
    const list = formTitled("Permissions", from)
    const switches = partsOf(list, "toggle").map(p => plain(p[1]))
    check("the long list has no switch Ally can't give", ["smite", "sudo", "banperm", "server presets"].filter(s => switches.includes(s)), [])
    check("but has the ones Ally can", ["warn", "ban", "kick"].every(s => switches.includes(s)), true)
    check("and says some were left out", partsOf(list, "label").some(p => plain(p[1]).includes("aren't listed")), true)
    check("closing it makes nothing", !!getRank("aide"), false)

    // Create checks again: the Admin template stops being Ally's to give
    // while the screens are open.
    const adminPerms = [...getRank("admin").perms]
    __ui.answers.push(submit("§9Aide", false, false, 0, 1), press(1), submit(0), {
        canceled: false,
        get selection() { saveRank("admin", { perms: adminPerms.filter(n => n !== "admin.ban") }); return 1 }
    })
    await createRankScreen(ally, () => {})
    saveRank("admin", { perms: adminPerms })
    check("Create refuses a template that now gives more than the maker has", !!getRank("aide"), false)
    check("and says why", lastSaid(ally).includes("permissions you don't have"), true)
}

console.log("\n— giving ranks —")
{
    const ids = list => list.map(r => r.id)
    check("Ally can't give Jester to Pat", ids(ranksToGive(ally, pat.id)).includes("jester"), false)
    check("but can give Mod", ids(ranksToGive(ally, pat.id)).includes("mod"), true)
    check("nor take Jester for themselves", ids(ranksToGive(ally, ally.id)).includes("jester"), false)
    check("the owner can give Jester", ids(ranksToGive(boss, pat.id)).includes("jester"), true)
}

console.log("\n— nobody raises themselves by taking a rank off —")
// Chief leads (75: may edit ranks, says nothing about Ban), is muzzled (72:
// "-admin.ban") and is an Admin (70: Ban). The muzzle is what holds Ban back.
saveRank("lead", { display: "§9Lead", type: "staff", weight: 75, perms: ["ranks.manage", "ranks.grant", "admin.panel", "ranks.view"] })
saveRank("muzzle", { display: "§7Muzzle", type: "staff", weight: 72, perms: ["-admin.ban"] })
const chief = person("gap-chief", "Chief")
setRanks(chief.id, ["lead", "muzzle", "admin"], chief.name)
{
    check("the muzzle holds Ban back", has(chief, "admin.ban"), false)
    check("taking it off would free it", gainedBy(chief, { held: ["lead", "admin"] }), ["admin.ban"])

    // Players ▸ Chief ▸ Ranks ▸ Take a rank away, on themselves.
    const from = __ui.shown.length
    __ui.answers.push(press(1))
    await playerRankScreen(chief, chief.id, "Chief", () => {})
    // A rank button leads with its badge (a private-use glyph) since badges
    // became everyone's in 2.12.10, so the names are read without it.
    const offered = buttonsOf(formTitled("Take a rank away", from)).map(b => b.replace(/[-]\s*/g, "").trim())
    check("Muzzle is not offered", offered.some(b => b.startsWith("Muzzle")), false)
    check("Admin still is", offered.some(b => b.startsWith("Admin")), true)
}

console.log("\n— nor by deleting, moving or retyping the rank that holds them back —")
{
    const open = async () => {
        const from = __ui.shown.length
        await rankScreen(chief, "muzzle", () => {})
        return buttonsOf(__ui.shown[from])
    }
    const buttons = await open()
    __ui.answers.push(press(buttons.findIndex(b => b.startsWith("Delete"))), press(1))
    await rankScreen(chief, "muzzle", () => {})
    check("deleting Muzzle is refused", !!getRank("muzzle"), true)
    check("and names what it would free", lastSaid(chief).includes("which you don't have"), true)

    __ui.answers.push(press(buttons.findIndex(b => b.startsWith("▼ Move down"))))
    await rankScreen(chief, "muzzle", () => {})
    check("moving it under Admin is refused", (getRank("muzzle")?.weight ?? 0) > getRank("admin").weight, true)

    // Basics: name, bold, italic, font, font on tag/name/messages, type,
    // name colour, chat colour, starting rank. Type 2 is Cosmetic.
    __ui.answers.push(submit("§7Muzzle", false, false, 0, true, false, false, 2, 0, "", false))
    await basicsScreen(chief, "muzzle", () => {})
    check("making it cosmetic is refused", rankType(getRank("muzzle")), "staff")
    check("Chief still can't ban", has(chief, "admin.ban"), false)
}

console.log("\n— a what-if saves nothing —")
{
    const world = JSON.stringify([...__test.props])
    const ranks = JSON.stringify(ranksTable.data)
    const holders = JSON.stringify(holdersTable.data)
    check("it sees the gain from deleting", gainedBy(chief, { change: () => deleteRank("muzzle") }), ["admin.ban"])
    check("and from moving", gainedBy(chief, { change: () => moveRank("muzzle", 1) }), ["admin.ban"])
    check("and from emptying it", gainedBy(chief, { change: () => saveRank("muzzle", { perms: [] }) }), ["admin.ban"])
    check("nothing was written to the world", JSON.stringify([...__test.props]), world)
    check("the rank list is as it was", JSON.stringify(ranksTable.data), ranks)
    check("and so is who holds what", JSON.stringify(holdersTable.data), holders)
}

console.log("\n— the whole list: templates and putting it back —")
{
    const op = person("gap-op", "Op", 2)
    check("Ally can't replace the whole list", canReplaceRankList(ally), false)
    check("the top rank with every permission can", canReplaceRankList(boss), true)
    check("and so can an operator", canReplaceRankList(op), true)
    check("operators give out anything", canGiveNode(op, "*"), true)

    const from = __ui.shown.length
    await ranksScreen(ally, () => {})
    check("Ally's rank list has no Rank templates button", buttonsOf(__ui.shown[from]).some(b => b.startsWith("Rank templates")), false)
    const order = JSON.stringify(Object.keys(ranksTable.data).sort())
    await presetsScreen(ally, () => {})
    check("the templates screen turns Ally away", lastSaid(ally).includes("Only an operator"), true)
    check("and the list is untouched", JSON.stringify(Object.keys(ranksTable.data).sort()), order)
}

console.log("\n— undo in the logs needs what doing needed —")
{
    const moddy = person("gap-mod", "Moddy")
    setRanks(moddy.id, ["mod"], moddy.name)
    const entry = (kind, extra = {}, target = pat) =>
        ({ id: "e", action: "test", undo: { kind, ...extra }, target: { id: target.id, name: target.name } })

    check("a Mod can't lift a ban through the logs", undoBlocked(moddy, entry("ban")), "You need permission to ban players.")
    check("an Admin can", undoBlocked(ally, entry("ban")), "")
    check("a Mod can still undo a mute", undoBlocked(moddy, entry("mute")), "")
    check("a Mod without Give ranks can't undo a rank change", undoBlocked(moddy, entry("ranks", { ranks: ["member"] })), "You need permission to give ranks.")
    check("giving Pat back Co-Owner is refused", undoBlocked(ally, entry("ranks", { ranks: ["coowner"] })).startsWith("It gives back a rank you can't give"), true)
    check("and so is giving back Jester", undoBlocked(ally, entry("ranks", { ranks: ["jester"] })).startsWith("It gives back a rank you can't give"), true)
    check("giving Pat back Mod is fine", undoBlocked(ally, entry("ranks", { ranks: ["mod"] })), "")
    check("Chief can't undo their own muzzling", undoBlocked(chief, entry("ranks", { ranks: ["lead", "admin"] }, chief)), "It would give you permissions you don't have.")
    check("only the top puts the whole list back", undoBlocked(ally, { undo: { kind: "ladder" } }).startsWith("Only an operator"), true)
    check("which the owner can", undoBlocked(boss, { undo: { kind: "ladder" } }), "")
    check("nobody undoes anything to someone above them", undoBlocked(moddy, entry("mute", {}, ally)), "Ally outranks you.")
}

console.log("\n— owners lose nothing —")
{
    __ui.answers.push(press(1), press(1), press(1 + ADMIN_GROUPS.indexOf("Pranks")), submit(true, true))
    await rankScreen(boss, "helper", () => {})
    check("the owner can still switch on Smite and Sudo", ["admin.smite", "admin.sudo"].map(n => rankState("helper", n)), ["own", "own"])
    check("and their rank list held everyone's ranks the whole time", heldRankIds(chief.id), ["lead", "muzzle", "admin"])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
