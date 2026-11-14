import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { onPlayerJoin, setRanks, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { record, clear } from "../Admin+ BP/scripts/core/logs.js"
import { noteChat } from "../Admin+ BP/scripts/core/chatlog.js"
import { noteCommand } from "../Admin+ BP/scripts/core/cmdlog.js"
import { routedPrefixes } from "../Admin+ BP/scripts/features/logsUI.js"
import { openLogs, logbookScreen, entryScreen, phraseOf, sentenceOf, actorOf, kindOfEntry, actionsFor } from "../Admin+ BP/scripts/features/logbook.js"
import { BETA_LOOK, LOGS, TAB, TAB_ON, PILL, logIcon } from "../Admin+ BP/scripts/core/look.js"

// The Logs, overhauled (2.12.5, Beta). The user, 2026-11-13: "do a complete
// overhaul on logs and do what you think is honestly best, in both style and
// layout ... I want something distinct for logs too, not close to the
// template one". It opens on the timeline: three tabs, three filter pills,
// then the entries, each one plain sentence. Default keeps the old screens.

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
let nextId = 1
function player(name, ranks) {
    const p = { id: `lb${nextId++}`, name, nameTag: name, commandPermissionLevel: 0, getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {} }
    __test.players.push(p)
    onPlayerJoin(p)
    setRanks(p.id, ranks, p.name)
    return p
}
const plain = s => String(s ?? "").replace(/§./g, "")
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const buttonsOf = form => form.parts.filter(p => p[0] === "button")
const press = selection => ({ canceled: false, selection })
const titleOf = form => form.parts.find(p => p[0] === "title")?.[1]
const bodyOf = form => form.parts.find(p => p[0] === "body")?.[1] ?? ""

applyPreset("server")
const boss = player("Firelite", ["owner"])
const modder = player("Modder", ["mod"])
const nova = player("Nova", ["member"])
clear()

console.log("\n— every action the pack writes has a plain sentence —")
// Every action id written anywhere in the scripts, both sides of a ternary
// included, under a prefix the Logs can reach.
{
    const routed = routedPrefixes()
    const ids = new Set()
    const walk = dir => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = `${dir}/${entry.name}`
            if (entry.isDirectory()) walk(path)
            else if (entry.name.endsWith(".js")) {
                for (const line of readFileSync(path, "utf8").split("\n")) {
                    if (!line.includes("record(")) continue
                    for (const m of line.matchAll(/["'`]([a-z]+)\.([a-zA-Z]+(?:\.[a-zA-Z]+)?)["'`]/g)) {
                        if (routed.has(m[1])) ids.add(`${m[1]}.${m[2]}`)
                    }
                }
            }
        }
    }
    walk(fileURLToPath(new URL("../Admin+ BP/scripts", import.meta.url)))
    check("the scripts write a good many kinds of action", ids.size > 60, true)
    const withTarget = id => phraseOf({ action: id, actor: { id: "a", name: "Staffer" }, target: { id: "t", name: "Steve" }, detail: "x" })
    const without = id => phraseOf({ action: id, actor: { id: "a", name: "Staffer" }, detail: "x" })
    check("none falls back to the bare \"made a change\"", [...ids].filter(id => withTarget(id) === "made a change" && without(id) === "made a change"), [])
    check("none shows a code like mod.ban", [...ids].filter(id => /\b[a-z]+\.[a-z]+/i.test(withTarget(id)) || /\b[a-z]+\.[a-z]+/i.test(without(id))), [])
    check("none says \"undefined\" when nobody was on the receiving end", [...ids].filter(id => without(id).includes("undefined")), [])
    check("only sudo names the tool, as the staff line does", [...ids].filter(id => withTarget(id).startsWith("used ")), ["player.sudo"])
}

console.log("\n— the sentence —")
{
    const ban = { action: "mod.ban", actor: { id: boss.id, name: "Firelite" }, target: { id: nova.id, name: "Nova" }, detail: "grief" }
    check("who, then what, as a person says it", plain(sentenceOf(ban)), "Firelite banned Nova")
    check("the server itself, never \"console\"", actorOf({ action: "config.edit", actor: { name: "console" } }), "The server")
    check("automod by name", actorOf({ action: "automod.spam", actor: { name: "console" } }), "Automod")
    check("a rank given says which", phraseOf({ action: "rank.grant", actor: { id: "a" }, target: { id: "t", name: "Nova" }, detail: "§2Mod" }), "gave Nova §2Mod")
    check("a change of their own reads as their own", phraseOf({ action: "mod.gamemode", actor: { id: "a" }, target: { id: "a", name: "Firelite" }, detail: "Creative" }), "set own game mode to Creative")
    check("spam: muted or warned, as it happened",
        [phraseOf({ action: "automod.spam", target: { name: "Nova" }, detail: "muted 5m · strike 2" }), phraseOf({ action: "automod.spam", target: { name: "Nova" }, detail: "warned · 6 in 10s" })],
        ["muted Nova for spam", "warned Nova for spam"])
    check("each kind has its picture", [kindOfEntry(ban), kindOfEntry({ action: "rank.grant" }), kindOfEntry({ action: "cmdblock.placed" }), kindOfEntry({ action: "claim.created" })],
        ["moderation", "people", "blocks", "land"])
}

// A small world's worth of log.
const banEntry = record(boss, "mod.ban", nova, "grief at spawn", { kind: "ban" })
record(modder, "mod.mute", nova, "caps · 10m", { kind: "mute" })
record(boss, "rank.grant", modder, "§2Mod", { kind: "ranks", ranks: ["member"] })
record(boss, "config.edit", undefined, "Name colours: on", { kind: "config", overrides: {} })
noteChat(nova, "hello there", undefined)
noteChat(modder, "welcome", undefined)
noteCommand(nova, "tpa", ["Modder"])
noteCommand(nova, "kick", ["Modder"], "no permission")

console.log("\n— Default keeps the old Logs —")
{
    setBeta(false)
    __ui.answers.length = 0
    await openLogs(boss, () => {})
    check("the six doors, as before", buttonsOf(lastForm()).map(b => plain(b[1]).split("\n")[0]).slice(0, 6), ["Actions", "Chat", "Commands", "Players", "Filter", "Search"])
    check("in the game's frame", titleOf(lastForm()).includes(LOGS), false)
}

console.log("\n— in Beta it opens on the timeline —")
{
    setBeta(true)
    __ui.answers.length = 0
    await openLogs(boss, () => {})
    const form = lastForm()
    check("drawn in the Logs frame", titleOf(form).endsWith(BETA_LOOK + LOGS), true)
    const buttons = buttonsOf(form)
    check("three tabs first, Actions open", buttons.slice(0, 3).map(b => [plain(b[1]).replace(/ · \d+$/, ""), b[1].endsWith(TAB_ON)]),
        [["Actions", true], ["Chat", false], ["Commands", false]])
    check("each tab counts what it holds", buttons.slice(0, 3).map(b => plain(b[1])), ["Actions · 4", "Chat · 2", "Commands · 2"])
    check("then three filter pills", buttons.slice(3, 6).map(b => [plain(b[1]), b[1].endsWith(PILL)]),
        [["Player · anyone", true], ["Kind · all", true], ["Search", true]])
    const entries = buttons.slice(6).filter(b => b[2])
    check("then the entries, newest first, one sentence each", entries.map(b => plain(b[1]).split("\n")[0]),
        ["Firelite changed settings", "Firelite gave Modder Mod", "Modder muted Nova", "Firelite banned Nova"])
    check("each with its kind's picture", entries.map(b => b[2]), [logIcon("server"), logIcon("people"), logIcon("moderation"), logIcon("moderation")])
    check("and when, the details, and whether it can be undone", plain(entries[3][1]).split("\n")[1].replace(/^\d\d:\d\d/, "HH:MM"), "HH:MM · grief at spawn · can be undone")
    check("a day marker before them", form.parts.filter(p => p[0] === "label").map(p => p[1]), ["Today"])
    check("no tab, pill or entry shows a code like mod.ban", buttons.some(b => /\bmod\.\w+/.test(b[1])), false)
}

console.log("\n— one tap opens an entry —")
{
    __ui.answers.length = 0
    const from = __ui.shown.length
    // Tabs 0-2, pills 3-5, then entries: the ban is the fourth entry.
    __ui.answers.push(press(9))
    await openLogs(boss, () => {})
    const entry = __ui.shown[from + 1]
    check("it opens straight away", plain(bodyOf(entry)).split("\n")[0], "Firelite banned Nova")
    check("in words, never the code", bodyOf(entry).includes("mod.ban"), false)
    check("with its kind, details and undo", plain(bodyOf(entry)).split("\n").filter(l => /^(Kind|Details|Undo):/.test(l)),
        ["Kind: Moderation", "Details: grief at spawn", "Undo: yes, below"])
    check("Undo it, then everything about each person in it", buttonsOf(entry).map(b => plain(b[1]).split("\n")[0]),
        ["Undo it", "Everything about Nova", "Everything about Firelite", "< Back"])
    check("in the Logs frame too", titleOf(entry).endsWith(LOGS), true)
}

console.log("\n— the filters —")
{
    __ui.answers.length = 0
    await logbookScreen(boss, () => {}, { tab: "actions", kind: "people" })
    check("Kind narrows the timeline", buttonsOf(lastForm()).slice(6).filter(b => b[2]).map(b => plain(b[1]).split("\n")[0]), ["Firelite gave Modder Mod"])
    check("and its pill says so, lit", [plain(buttonsOf(lastForm())[4][1]), buttonsOf(lastForm())[4][1].startsWith("§b")], ["Kind · Ranks and names", true])

    await logbookScreen(boss, () => {}, { tab: "actions", player: { id: nova.id, name: "Nova" } })
    const tabs = buttonsOf(lastForm()).slice(0, 3).map(b => plain(b[1]))
    check("Player works on all three tabs at once", tabs, ["Actions · 2", "Chat · 1", "Commands · 2"])
    check("Actions: what was done to them, or by them", buttonsOf(lastForm()).slice(6).filter(b => b[2]).map(b => plain(b[1]).split("\n")[0]), ["Modder muted Nova", "Firelite banned Nova"])

    await logbookScreen(boss, () => {}, { tab: "actions", text: "banned" })
    check("Search matches the sentence, not only names", actionsFor(boss, { text: "banned" }).map(e => e.id), [banEntry.id])
    await logbookScreen(boss, () => {}, { tab: "actions", text: "nothing like this" })
    check("nothing matching says so", plain(bodyOf(lastForm())), "Nothing matches these filters.")
}

console.log("\n— Chat and Commands read as text —")
{
    __ui.answers.length = 0
    await logbookScreen(boss, () => {}, { tab: "chat" })
    check("chat lines in the body, under the day", plain(bodyOf(lastForm())).split("\n").map(l => l.replace(/^\d\d:\d\d /, "")),
        ["Today", "[Chat] Modder: welcome", "[Chat] Nova: hello there"])
    check("the Chat tab is open", buttonsOf(lastForm())[1][1].endsWith(TAB_ON), true)
    await logbookScreen(boss, () => {}, { tab: "commands" })
    check("commands too, refusals marked", plain(bodyOf(lastForm())).includes("refused: no permission"), true)
    await logbookScreen(boss, () => {}, { tab: "commands", kind: "refused" })
    check("Kind narrows commands to refusals", plain(buttonsOf(lastForm())[0][1]), "Actions · 4")
    check("only the refused one", plain(bodyOf(lastForm())).split("\n").filter(l => l.includes("[Cmd]")).length, 1)
}

console.log("\n— the same reading rules —")
{
    // A moderator never reads back what someone above them did.
    __ui.answers.length = 0
    await logbookScreen(modder, () => {}, { tab: "actions" })
    const seen = buttonsOf(lastForm()).slice(6).filter(b => b[2]).map(b => plain(b[1]).split("\n")[0])
    // Anything you were part of is yours to read: that is how an appeal starts.
    check("a mod sees what they did and what was done to them, not the owner's other work", seen, ["Firelite gave Modder Mod", "Modder muted Nova"])
    await entryScreen(modder, banEntry.id, () => {})
    check("nor can they open one by its id", __ui.shown.length && titleOf(lastForm()).includes("Log entry") && plain(bodyOf(lastForm())).startsWith("Firelite banned"), false)
}

console.log("\n— pages —")
{
    for (let i = 0; i < 14; i++) record(boss, "mod.kick", nova, `afk ${i}`)
    __ui.answers.length = 0
    await logbookScreen(boss, () => {}, { tab: "actions" })
    const rows = buttonsOf(lastForm()).slice(6)
    check("ten entries to a page", rows.filter(b => b[2] && b[2] !== logIcon("older") && b[2] !== logIcon("newer")).length, 10)
    check("then Older", rows.some(b => plain(b[1]).startsWith("Older")), true)
    check("the body says which ones", plain(bodyOf(lastForm())), "1 to 10 of 18, newest first")
    await logbookScreen(boss, () => {}, { tab: "actions", page: 1 })
    check("page two has Newer, and the rest", [buttonsOf(lastForm()).some(b => plain(b[1]).startsWith("Newer")), plain(bodyOf(lastForm()))], [true, "11 to 18 of 18, newest first"])
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
