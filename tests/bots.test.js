import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { acceptTerms } from "../Admin+ BP/scripts/features/terms.js"
import { onPlayerJoin, applyPreset, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting, overrides } from "../Admin+ BP/scripts/core/settings.js"
import {
    noteJoin, noteSpawn, noteChat, scoreOf, decide, recordOf, LOOKS_GENERATED, __resetBotcheck,
    botLevel, graceSeconds, LEVELS, levelForSeconds
} from "../Admin+ BP/scripts/core/botcheck.js"
import { checkBots, possibleBots, act, botSettingsScreen, botGuardScreen } from "../Admin+ BP/scripts/features/bots.js"
import { GUARD, GUARD_ON, CARD, guardIcon } from "../Admin+ BP/scripts/core/look.js"
import { isBanned } from "../Admin+ BP/scripts/core/moderation.js"
import { AUTOMOD_ON_HOLD, AUTOMOD_SECTION_ON_HOLD } from "../Admin+ BP/scripts/core/hold.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// 3.0.1, the user: bot detection as "the first semi-introduction to automod",
// with a /automod command, flag or flag-and-kick-or-ban, a possible bot list
// and a percentage. And their warning: a dead player (instant respawn off)
// and a player still joining can't be teleported to either.
// 3.0.3, the user: it works at 60 seconds, so it's named Bot Guard and the
// wait is a level: Low (slow servers), Medium 60 s, High 20 s, Max later.

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
// 3.1.6: an owner accepts Admin+'s terms before using its commands.
acceptTerms(staff)

console.log("\n— the holds: the old checks stay held, the section is back —")
check("ore alerts, fast breaking and chat flooding are still on hold", AUTOMOD_ON_HOLD, true)
check("the Automod section is back, for bot detection", AUTOMOD_SECTION_ON_HOLD, false)

console.log("\n— never judged: still joining, or already in the world —")
{
    __resetBotcheck()
    const t0 = 1_000_000
    noteJoin("p1", "RealPlayer", t0)
    check("a player still loading in isn't judged inside the wait (the user's warning)", scoreOf(recordOf("p1"), t0 + 30_000).score, 0)
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
    check("never entering after the 1-minute wait (Medium): 60%", scoreOf(recordOf("b1"), t0 + 65_000).score, 60)
    check("still not after two and a half waits (150 seconds): 80%", scoreOf(recordOf("b1"), t0 + 155_000).score, 80)
    noteJoin("b2", "CausedDawn1161", t0)
    noteChat("b2", "find all worlds on tpmultiplayer.xyz")
    const s = scoreOf(recordOf("b2"), t0 + 65_000)
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

console.log("\n— 3.0.3: the level, Low to High, with Max in progress —")
{
    __resetBotcheck()
    check("out of the box it's Medium: a minute", [botLevel().id, graceSeconds()], ["medium", 60])
    check("three levels to pick; Max isn't offered while it's in progress", LEVELS.map(l => l.id), ["low", "medium", "high"])
    const t0 = 3_000_000
    noteJoin("h1", "FastBot", t0)
    setSetting("automod.botLevel", "high")
    check("High judges after 20 seconds", [scoreOf(recordOf("h1"), t0 + 15_000).score, scoreOf(recordOf("h1"), t0 + 25_000).score], [0, 60])
    setSetting("automod.botLevel", "low")
    check("Low waits 2 minutes, for a slow server", [scoreOf(recordOf("h1"), t0 + 90_000).score, scoreOf(recordOf("h1"), t0 + 125_000).score], [0, 60])
    setSetting("automod.botLevel", "max")
    check("a level that isn't there yet reads as Medium", botLevel().id, "medium")
    resetSetting("automod.botLevel")
    check("old waits map to the nearest level", [20, 30, 60, 90, 120, 600].map(levelForSeconds), ["high", "high", "medium", "medium", "low", "low"])
    // A 3.0.1 or 3.0.2 world that chose a 5-minute wait.
    __resetBotcheck()
    setSetting("automod.botGrace", "300")
    check("a world on the old wait keeps about the same speed", botLevel().id, "low")
    checkBots()
    check("the first check moves it over to a level", [overrides()["automod.botLevel"], overrides()["automod.botGrace"]], ["low", undefined])
    resetSetting("automod.botLevel")
}

console.log("\n— the list, and staff told once per step —")
{
    __resetBotcheck()
    staff.inbox.length = 0
    __test.commands.length = 0
    noteJoin("b3", "AdBot", Date.now() - 6 * MIN)
    const told = checkBots()
    check("a bot 6 minutes in is flagged to staff", staff.inbox.some(m => m.includes("Bot Guard flagged AdBot") && m.includes("80%")), true)
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
    check("the screen: Bot Guard, its level, Alerts, then what to do at the limit", fields.slice(0, 4), ["Bot Guard", "Level", "Alerts", "At the limit"])
    // Save it on High: [label, on, level, alerts, action, limit].
    __ui.shown.length = 0
    __ui.answers.push({ canceled: false, formValues: [undefined, true, 2, true, 0, 80] })
    staff.inbox.length = 0
    await botSettingsScreen(staff, () => {})
    check("picking High saves the level", overrides()["automod.botLevel"], "high")
    check("and says so", staff.inbox.some(m => m.includes("Bot Guard") && m.includes("level high (20 seconds)")), true)
    resetSetting("automod.botLevel")
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
    check("with Bot Guard first, saying its level and what it does at the limit", names[0]?.startsWith("Bot Guard") && names[0].includes("Medium") && names[0].includes("80%"), true)
    // 3.1.4, the user: "Bot Guard and Chat Moderation should be the only 2".
    check("and only two sections: Bot Guard, then Chat Moderation", names.map(n => n.split("\n")[0]), ["Bot Guard", "Chat Moderation"])
}
{
    // Bot Guard holds its own two pages, the user's names.
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push({ canceled: false, selection: 0 })
    __test.invoke(`${NS}:automod`, staff)
    await settle()
    const guard = __ui.shown[1]
    check("Bot Guard opens its own page", titleOf(guard).includes("Bot Guard"), true)
    check("with Bot Moderation, then Detected Bots and how many", buttonsOf(guard).map(n => n.split("\n")[0].replace(/ \(\d+\)$/, " (n)")), ["Bot Moderation", "Detected Bots (n)", "< Back"])
}
{
    // 3.1.5, the user: "Bot guard should be its own unique UI look really
    // animated and good". In Admin+'s menus it asks for its own frame.
    const BETA_ITEM = { id: "adminplus:channel_beta" }
    __test.itemTypes.push(BETA_ITEM)
    const rawTitle = form => (form?.parts ?? []).find(p => p[0] === "title")?.[1] ?? ""
    const body = form => plain((form?.parts ?? []).find(p => p[0] === "body")?.[1])
    __ui.shown.length = 0; __ui.answers.length = 0
    await botGuardScreen(staff, () => {})
    const lit = __ui.shown[0]
    check("in Admin+'s menus Bot Guard asks for its own frame, lit while it watches", rawTitle(lit).endsWith(GUARD_ON), true)
    const cards = (lit?.parts ?? []).filter(p => p[0] === "button")
    check("its two pages are cards with their own pictures, then Back",
        cards.map(p => [plain(p[1]).split("\n")[0], p[1].endsWith(CARD), p[2] ?? null]),
        [["Bot Moderation", true, guardIcon("moderation")], ["Detected Bots", true, guardIcon("detected")], ["< Back", false, null]])
    check("its banner names the level, the wait and what happens at the limit",
        body(lit).split("\n"), ["Bot Guard", "Level Medium: 1 minute to enter", "At 80%: flag only · alerts on"])
    check("short enough to sit in the banner", body(lit).split("\n").length <= 3, true)
    setSetting("automod.bots", "false")
    await botGuardScreen(staff, () => {})
    const unlit = __ui.shown[1]
    check("switched off, the frame is unlit", [rawTitle(unlit).endsWith(GUARD), rawTitle(unlit).includes(GUARD_ON)], [true, false])
    check("and the banner says how to turn it on", body(unlit).includes("Off. Turn it on in Bot Moderation"), true)
    resetSetting("automod.bots")
    __test.itemTypes.splice(__test.itemTypes.indexOf(BETA_ITEM), 1)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
