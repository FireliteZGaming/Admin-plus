import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin, applyPreset, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { noteJoin, noteSpawn, noteChat, scoreOf, decide, recordOf, LOOKS_GENERATED, __resetBotcheck } from "../Admin+ BP/scripts/core/botcheck.js"
import { checkBots, possibleBots, act, botSettingsScreen } from "../Admin+ BP/scripts/features/bots.js"
import { isBanned } from "../Admin+ BP/scripts/core/moderation.js"
import { AUTOMOD_ON_HOLD, AUTOMOD_SECTION_ON_HOLD } from "../Admin+ BP/scripts/core/hold.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// 3.0.1, the user: bot detection as "the first semi-introduction to automod",
// with a /automod command, flag or flag-and-kick-or-ban, a possible bot list
// and a percentage. And their warning: a dead player (instant respawn off)
// and a player still joining can't be teleported to either.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const plain = s => String(s ?? "").replace(/§./g, "")
const titleOf = form => plain((form?.parts ?? []).find(p => p[0] === "title")?.[1])
const buttonsOf = form => (form?.parts ?? []).filter(p => p[0] === "button").map(p => plain(p[1]))
const MIN = 60 * 1000

__test.runStartup()
applyPreset("server")
const staff = {
    id: "bot-staff", name: "Staff", nameTag: "Staff", inbox: [], commandPermissionLevel: 0,
    location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" },
    getTags: () => [], addTag: () => true, removeTag: () => true, hasTag: () => false,
    sendMessage: m => staff.inbox.push(plain(m))
}
__test.players.push(staff)
onPlayerJoin(staff)
setRanks(staff.id, ["owner"], "Staff")

console.log("\n— the holds: the old checks stay held, the section is back —")
check("ore alerts, fast breaking and chat flooding are still on hold", AUTOMOD_ON_HOLD, true)
check("the Automod section is back, for bot detection", AUTOMOD_SECTION_ON_HOLD, false)

console.log("\n— never judged: still joining, or already in the world —")
{
    __resetBotcheck()
    const t0 = 1_000_000
    noteJoin("p1", "RealPlayer", t0)
    check("a player still loading in isn't judged (the user's warning)", scoreOf(recordOf("p1"), t0 + 1 * MIN).score, 0)
    noteSpawn("p1", t0 + 30_000)
    check("once they've entered the world, never", scoreOf(recordOf("p1"), t0 + 30 * MIN).score, 0)
    noteJoin("p2", "Diver", t0)
    noteSpawn("p2", t0 + 20_000)
    check("a player on the death screen spawned before, so they're never flagged either", scoreOf(recordOf("p2"), t0 + 10 * MIN).score, 0)
}

console.log("\n— the score: never entering, then the extra signs —")
{
    const t0 = 2_000_000
    noteJoin("b1", "quietbot", t0)
    check("never entering after the 2-minute wait: 60%", scoreOf(recordOf("b1"), t0 + 2 * MIN + 5000).score, 60)
    check("still not after two and a half waits (5 minutes): 80%", scoreOf(recordOf("b1"), t0 + 5 * MIN + 5000).score, 80)
    noteJoin("b2", "CausedDawn1161", t0)
    noteChat("b2", "find all worlds on tpmultiplayer.xyz")
    const s = scoreOf(recordOf("b2"), t0 + 2 * MIN + 5000)
    check("chatting (+15), a link (+10) and a made-up name (+5) add up: 90%", s.score, 90)
    check("and each reason is said in words", s.reasons.slice(1), ["chatted once without entering", "posted a link", "a name like Xbox's made-up ones"])
    check("made-up looking names: word, word, digits", [LOOKS_GENERATED.test("CausedDawn1161"), LOOKS_GENERATED.test("Steve")], [true, false])
    check("never more than 100%", scoreOf(recordOf("b2"), t0 + 10 * MIN).score, 100)
}

console.log("\n— what to do: flag only, unless the server chose kick or ban —")
check("out of the box it only flags, whatever the score", decide(100), "none")
setSetting("automod.botAction", "kick")
check("with Kick chosen, below the limit (80%) it still only flags", decide(75), "none")
check("at the limit it kicks", decide(80), "kick")
setSetting("automod.botActAt", "95")
check("the limit can be raised", decide(90), "none")
resetSetting("automod.botActAt")
resetSetting("automod.botAction")

console.log("\n— the list, and staff told once per step —")
{
    __resetBotcheck()
    staff.inbox.length = 0
    __test.commands.length = 0
    noteJoin("b3", "AdBot", Date.now() - 6 * MIN)
    const told = checkBots()
    check("a bot 6 minutes in is flagged to staff", staff.inbox.some(m => m.includes("Possible bot: AdBot") && m.includes("80%")), true)
    check("and put on the possible bots list", possibleBots().find(b => b.name === "AdBot")?.score, 80)
    check("with no action taken out of the box", __test.commands.some(c => c.includes("kick")), false)
    const before = staff.inbox.length
    checkBots()
    check("the same score isn't announced twice", staff.inbox.length, before)
    check("one alert the first time", told.length, 1)
}

console.log("\n— kick and ban go by name, since the bot never spawned —")
{
    setSetting("automod.botAction", "kick")
    __test.commands.length = 0
    noteJoin("b4", "SpamBot", Date.now() - 6 * MIN)
    checkBots()
    await settle()
    check("at the limit, Automod kicks it by name", __test.commands.some(c => c.startsWith('kick "SpamBot"')), true)
    check("and the list says so", possibleBots().find(b => b.name === "SpamBot")?.action, "kicked")
    resetSetting("automod.botAction")
    const entry = possibleBots().find(b => b.name === "AdBot")
    await act(entry, "ban", staff)
    check("staff can ban one from the list, and it holds on every join", isBanned("b3"), true)
    check("the list says banned", possibleBots().find(b => b.name === "AdBot")?.action, "banned")
}

console.log("\n— 3.0.2: the Alerts switch, before the action —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    await botSettingsScreen(staff, () => {})
    const fields = (__ui.shown[0]?.parts ?? []).filter(p => ["toggle", "dropdown", "slider"].includes(p[0])).map(p => plain(p[1]))
    check("the screen: Bot detection, Alerts, then what to do at the limit", fields.slice(0, 3), ["Bot detection", "Alerts", "At the limit"])
    setSetting("automod.botAlerts", "false")
    staff.inbox.length = 0
    noteJoin("b6", "SilentBot", Date.now() - 6 * MIN)
    checkBots()
    check("with alerts off, staff aren't told", staff.inbox.some(m => m.includes("SilentBot")), false)
    check("but it still goes on the list", possibleBots().some(b => b.name === "SilentBot"), true)
    setSetting("automod.botAction", "kick")
    __test.commands.length = 0
    noteJoin("b7", "QuietKickBot", Date.now() - 6 * MIN)
    checkBots()
    await settle()
    check("and the chosen action still happens", __test.commands.some(c => c.startsWith('kick "QuietKickBot"')), true)
    check("still without a word to staff", staff.inbox.some(m => m.includes("QuietKickBot")), false)
    resetSetting("automod.botAction")
    resetSetting("automod.botAlerts")
}

console.log("\n— switched off, it does nothing —")
{
    setSetting("automod.bots", "false")
    noteJoin("b5", "LaterBot", Date.now() - 10 * MIN)
    check("no flag", checkBots().length, 0)
    check("and nothing new on the list", possibleBots().some(b => b.name === "LaterBot"), false)
    resetSetting("automod.bots")
}

console.log("\n— /automod —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.invoke(`${NS}:automod`, staff)
    await settle()
    const hub = __ui.shown[0]
    const names = buttonsOf(hub)
    check("opens Automod", titleOf(hub).includes("Automod"), true)
    check("with Bot detection first, saying what it does at the limit", names[0]?.startsWith("Bot detection") && names[0].includes("80%"), true)
    check("then the possible bots, with how many", names[1]?.startsWith("Possible bots ("), true)
    check("and the held checks greyed out, on hold", names.some(n => n.startsWith("Ore alerts and fast breaking") && n.includes("On hold")), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
