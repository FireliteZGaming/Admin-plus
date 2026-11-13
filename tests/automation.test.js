import { __test, world } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { onPlayerJoin, setRanks, saveRank, applyPreset, heldRankIds, getRank } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { saveWarp } from "../Admin+ BP/scripts/core/warps.js"
import { expiryOf } from "../Admin+ BP/scripts/core/grants.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { parse, triggerLabel, LIMITS } from "../Admin+ BP/scripts/core/automation.js"
import {
    saveAutomation, fire, chatAutomations, tickTimers, getAutomation, automationList,
    setAutomationOn, deleteAutomation, previewAutomation, installAutomation
} from "../Admin+ BP/scripts/features/automation.js"
import { automationScreen } from "../Admin+ BP/scripts/features/automationUI.js"
import { installChat } from "../Admin+ BP/scripts/features/chat.js"

// Automation, 2.10.0. Asked for by the user on 2026-11-12: "sort of like how
// automated shortcuts work on apple, we can have our own automation setting
// under server", written in a text editor "and instructions on how to use on
// top", targeted and script-like: if({Rank} == "blah blah blah") {.
// Everything here runs through the real code.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name, { op = false } = {}) {
    const tags = new Set()
    const p = {
        id: `t${nextId++}`, name, nameTag: name, inbox: [], titles: [], bars: [], sounds: [], moves: [],
        location: { x: 0, y: 64, z: 0 },
        commandPermissionLevel: op ? 2 : 0,
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) },
        getTags: () => [...tags], hasTag: t => tags.has(t),
        addTag: t => { tags.add(t); return true }, removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(typeof m === "string" ? m : JSON.stringify(m)),
        playSound: id => p.sounds.push(id),
        teleport: (to) => p.moves.push(to),
        onScreenDisplay: {
            setTitle: (text, options) => p.titles.push([text, options?.subtitle ?? ""]),
            setActionBar: text => p.bars.push(text)
        }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const clean = s => String(s).replace(/§./g, "")
const said = []
world.sendMessage = message => said.push(String(message))
const press = selection => ({ canceled: false, selection })
const submit = (...formValues) => ({ canceled: false, formValues })
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const textOf = (form, kind) => form.parts.filter(p => p[0] === kind).map(p => p[1])

applyPreset("server")
saveRank("vip", { display: "§eVIP", type: "cosmetic", perms: [] })
saveRank("writer", { display: "§3Writer", type: "staff", weight: 40, perms: ["admin.panel", "admin.automation"] })
const owner = fakePlayer("Owner", { op: true })
const member = fakePlayer("Member")
const steve = fakePlayer("Steve")
const writer = fakePlayer("Writer")
setRanks(writer.id, ["writer"], writer.name)
installAutomation()
installChat()

console.log("\n— the language reads what the user wrote —")
const welcome = `// Owners get a gold welcome. Everyone else gets a tip.
when join {
    if ({Rank} == "Owner") {
        say "§6The owner {NAME} is here!"
    } else {
        tell "Welcome, {NAME}. Type /menu to start."
    }
}`
check("the design's first example", parse(welcome).ok, true)
check("the user's own form, no space after if", parse(`when join { if({Rank} == "blah blah blah") { tell "x" } }`).ok, true)
check("every block says when it runs", parse(`every 20 minutes { say "x" }\nwhen first join { tell "y" }`).blocks.map(triggerLabel),
    ["every 20 minutes", "when first join"])
check("phone quotes work too", parse(`when join { tell “hi” }`).ok, true)
check("notes and semicolons are fine", parse(`// a note\nwhen join { tell "a"; tell "b" }`).ok, true)
check("an empty box is empty, not a mistake", parse("  // only a note\n").empty, true)

console.log("\n— a mistake names its line —")
const errorOf = src => parse(src).error
check("an open quote", errorOf(`when join {\n  tell "hi\n}`), "Line 2: this quote is never closed.")
check("a typo gets a suggestion", errorOf(`when join {\n  tel "hi"\n}`), "Line 2: I don't know 'tel'. Did you mean tell?")
check("a timer too fast", errorOf(`every 5 seconds { say "x" }`), `Line 1: every needs ${LIMITS.minEverySeconds} seconds or more.`)
check("replace outside chat", errorOf(`when join { replace "x" }`), "Line 1: replace only works in when chat.")
check("{MSG} outside chat", errorOf(`when join { tell "{MSG}" }`), "Line 1: {MSG} only works in when chat.")
check("an unknown word in braces", errorOf(`when join { tell "{NAM}" }`), "Line 1: I don't know {NAM}. Did you mean {NAME}?")
check("a missing }", errorOf(`when join { tell "x"`), "Line 1: this { has no } to close it.")
check("a value without quotes", errorOf(`when join { if ({RANK} == Owner) { tell "x" } }`), "Line 1: put Owner in quotes: \"Owner\".")
check("cancel after a wait", errorOf(`when chat {\n wait 2 seconds\n cancel\n}`), "Line 3: cancel can't come after wait, because the message is already sent by then.")
check("a player line in a timer", errorOf(`every 1 minute { tell "x" }`).startsWith("Line 1: tell needs a player"), true)
check("a single =", errorOf(`when join { if ({RANK} = "x") { } }`), "Line 1: use == to compare.")
check("a wrong trigger", errorOf(`when jion { }`), "Line 1: when jion? Did you mean when join?")

console.log("\n— it runs, aimed at the right players —")
check("(saved)", saveAutomation(owner, { name: "Welcome owners", source: welcome }).ok, true)
setRanks(owner.id, ["owner"], owner.name)
fire("join", { id: owner.id, name: owner.name, player: owner })
check("the owner gets the gold line, to everyone", said.at(-1), "§6The owner Owner is here!")
fire("join", { id: member.id, name: member.name, player: member })
check("a member gets the tip, to them alone", member.inbox.at(-1), "Welcome, Member. Type /menu to start.")
check("which nobody else hears", said.includes("Welcome, Member. Type /menu to start."), false)

console.log("\n— chat: an answer, a changed message, a stopped one —")
saveAutomation(owner, { name: "Lag answer", source: `when chat {\n if ({RANK} == "Member" and {MSG} contains "lag") {\n  tell "Staff know about the lag."\n }\n}` })
member.inbox.length = 0
__test.emitChat(member, "so much LAG today")
check("a member who says lag gets the answer", member.inbox.some(m => m === "Staff know about the lag."), true)
check("and their message still goes out", steve.inbox.some(m => clean(m).includes("so much LAG today")), true)

saveAutomation(owner, { name: "Steve's words", source: `when chat {\n if ({NAME} == "Steve") { replace "I love this server!" }\n}` })
member.inbox.length = 0
__test.emitChat(steve, "this server is bad")
check("Steve's message comes out changed", member.inbox.some(m => clean(m).includes("I love this server!")), true)
check("and the real words never reach chat", member.inbox.some(m => clean(m).includes("this server is bad")), false)
const replaced = recent(20).find(e => e.action === "automation.replace")
check("Logs keep the real words", clean(replaced?.detail ?? "").includes("this server is bad"), true)

setSetting("automation.chatEdit", "false")
member.inbox.length = 0
__test.emitChat(steve, "honest words")
check("with chat changes switched off, the words stay as typed", member.inbox.some(m => clean(m).includes("honest words")), true)
resetSetting("automation.chatEdit")

saveAutomation(owner, { name: "No caps", source: `when chat { if ({MSG} contains "shout") { cancel } }` })
member.inbox.length = 0
__test.emitChat(steve, "I SHOUT now")
check("cancel stops the message", member.inbox.some(m => clean(m).includes("SHOUT")), false)

console.log("\n— timers and waits —")
const reminder = saveAutomation(owner, { name: "Reminder", source: `every 20 minutes {\n if ({ONLINE} >= 2) { say "Vote at /warp contest" }\n}` }).record
said.length = 0
tickTimers(0)
check("a timer waits its first 20 minutes", said.includes("Vote at /warp contest"), false)
tickTimers(20 * 60 * 1000)
check("then runs", said.includes("Vote at /warp contest"), true)
said.length = 0
tickTimers(25 * 60 * 1000)
check("and not again until the next 20", said.includes("Vote at /warp contest"), false)
setAutomationOn(owner, reminder.id, false)

saveAutomation(owner, { name: "Later", source: `when respawn {\n tell "now"\n wait 5 seconds\n tell "later"\n}` })
member.inbox.length = 0
fire("respawn", { id: member.id, name: member.name, player: member })
check("before a wait, it runs at once", member.inbox.includes("now") && !member.inbox.includes("later"), true)
__test.runTimers()
check("after it, the rest runs", member.inbox.includes("later"), true)

console.log("\n— what it can do to a player —")
saveWarp("spawn", { display: "§aSpawn" }, owner)
saveAutomation(owner, { name: "Newcomers", source: `when first join {\n warp "Spawn"\n title "Welcome!" "Read the rules"\n actionbar "Hi"\n sound "random.levelup"\n give rank "VIP" for 1 day\n}` })
fire("first join", { id: steve.id, name: steve.name, player: steve })
check("warp sends them", steve.moves.length, 1)
check("title, with its small line", steve.titles.at(-1), ["Welcome!", "Read the rules"])
check("actionbar and sound", [steve.bars.at(-1), steve.sounds.at(-1)], ["Hi", "random.levelup"])
check("give rank gives it", heldRankIds(steve).includes("vip"), true)
check("for a day", Math.round(((expiryOf(steve.id, "vip") ?? 0) - Date.now()) / 3600000), 24)
check("and staff can read it in Logs", recent(20).some(e => e.action === "automation.rank" && e.target?.name === "Steve"), true)
fire("first join", { id: owner.id, name: owner.name, player: owner })
check("but never for the person who saved it", heldRankIds(owner).includes("vip"), false)

console.log("\n— it can only do what its saver can do —")
const refused = saveAutomation(writer, { name: "Shout", source: `when join {\n say "hello all"\n}` })
check("no Broadcast, no say", refused.error, "Line 2: you can't send a message to everyone, so this automation can't either.")
const tooHigh = saveAutomation(writer, { name: "Promote", source: `when join { give rank "Admin" }` })
check("no giving a rank they can't give", tooHigh.ok, false)
check("and nothing was saved", automationList().some(a => a.name === "Shout" || a.name === "Promote"), false)
const fine = saveAutomation(writer, { name: "Hello", source: `when join { tell "hello" }` })
check("what they can do saves", fine.ok, true)

saveRank("writer", { display: "§3Writer", type: "staff", weight: 40, perms: ["admin.panel", "admin.automation", "admin.broadcast"] })
const loud = saveAutomation(writer, { name: "Loud", source: `when respawn { say "loud" }` }).record
saveRank("writer", { display: "§3Writer", type: "staff", weight: 40, perms: ["admin.panel", "admin.automation"] })
said.length = 0
fire("respawn", { id: member.id, name: member.name, player: member })
check("losing Broadcast later stops its say", said.includes("loud"), false)
check("and says why", (getAutomation(loud.id)?.lastError ?? "").includes("can't send a message to everyone any more"), true)

console.log("\n— limits —")
const noisy = saveAutomation(owner, { name: "Noisy", source: `when death {\n${Array.from({ length: 25 }, (_, i) => ` tell "n${i}"`).join("\n")}\n}` }).record
member.inbox.length = 0
fire("death", { id: member.id, name: member.name, player: member })
check(`one run does ${LIMITS.actionsPerRun} things at most`, member.inbox.filter(m => /^n\d+$/.test(m)).length, LIMITS.actionsPerRun)
check("and says it stopped", (getAutomation(noisy.id)?.lastError ?? "").includes(`stopped after ${LIMITS.actionsPerRun}`), true)
fire("death", { id: member.id, name: member.name, player: member })
fire("death", { id: member.id, name: member.name, player: member })
check("three problems in a row turn it off", getAutomation(noisy.id)?.on, false)
check("and Logs say why", recent(30).some(e => e.action === "automation.error"), true)

setSetting("feature.automation", "false")
member.inbox.length = 0
fire("join", { id: member.id, name: member.name, player: member })
check("with Automation switched off, nothing runs", member.inbox.length, 0)
resetSetting("feature.automation")

console.log("\n— Try it on me does nothing —")
const promo = saveAutomation(owner, { name: "Promo", source: `when join { give rank "VIP" }` }).record
const preview = previewAutomation(member, promo.id)
check("it says what would happen", preview[0], "when join: would give you the rank VIP")
check("and gives nothing", heldRankIds(member).includes("vip"), false)

console.log("\n— the screens —")
__ui.answers.length = 0
__ui.shown.length = 0
await automationScreen(member, () => {})
check("someone without the permission is turned away", member.inbox.some(m => clean(m).includes("You can't change automations")), true)

const before = automationList().length
__ui.answers.push(press(0), submit("Greeter"), submit(`when join {\n  tel "oops"\n}`), submit(`when join {\n  tell "hi there"\n}`))
await automationScreen(owner, () => {})
const editors = __ui.shown.filter(f => textOf(f, "title")[0]?.includes("Automation · Greeter"))
check("the editor opened, with the instructions on top", String(editors[0]?.parts.find(p => p[0] === "text")?.[1] ?? "").includes("When: join, first join, leave, chat"), true)
check("a new automation starts from an example, not a blank box", String(editors[0]?.parts.find(p => p[0] === "text")?.[3]?.defaultValue ?? "").includes("when join"), true)
check("a mistake opened it again, with the line", String(editors[1]?.parts.find(p => p[0] === "text")?.[1] ?? "").includes("Line 2: I don't know 'tel'. Did you mean tell?"), true)
check("keeping what was typed", String(editors[1]?.parts.find(p => p[0] === "text")?.[3]?.defaultValue ?? ""), `when join {\n  tel "oops"\n}`)
check("the fixed one saved", automationList().length, before + 1)
const greeter = automationList().find(a => a.name === "Greeter")
check("and it's on", greeter?.on, true)

__ui.answers.length = 0
__ui.shown.length = 0
const at = automationList().findIndex(a => a.id === greeter.id) + 1
__ui.answers.push(press(at), press(4), press(1))
await automationScreen(owner, () => {})
check("Delete asks, then deletes", getAutomation(greeter.id), undefined)

deleteAutomation(owner, promo.id)
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
