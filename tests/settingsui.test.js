import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setting, setSetting, resetSetting, flag, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { GROUPS, settingKeys, settingsScreen, pageScreen } from "../Admin+ BP/scripts/features/settingsUI.js"
import { automodHubScreen, screeningScreen } from "../Admin+ BP/scripts/features/automodUI.js"
import { openPanel } from "../Admin+ BP/scripts/features/panel.js"
import { creditsScreen } from "../Admin+ BP/scripts/features/credits.js"
import { CONFIG } from "../Admin+ BP/scripts/config.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// /admin ▸ Server, as the user laid it out on 2026-11-12: Settings (every
// switch, in groups that say what they hold), Automod, and Advanced, plus
// Server presets, which fits none of the three.

const boss = {
    id: "set-boss", name: "Boss", nameTag: "Boss", commandPermissionLevel: 0,
    getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
}
__test.players.push(boss)
onPlayerJoin(boss)
applyPreset("server")
setRanks(boss.id, ["owner"], boss.name)

const submit = (...formValues) => ({ canceled: false, formValues })
const press = selection => ({ canceled: false, selection })
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => p[1])
const pageOf = (groupId, label) => GROUPS.find(g => g.id === groupId).pages.find(p => p.label === label)

console.log("\n— Server holds Settings, Automod, Server presets and Advanced —")
{
    __ui.answers.length = 0
    await openPanel(boss)
    const panel = buttonsOf(lastForm())
    const serverAt = panel.findIndex(text => text.includes("Server"))
    __ui.answers.push(press(serverAt))
    await openPanel(boss)
    const server = buttonsOf(lastForm()).map(text => text.split("\n")[0].replace(/§./g, ""))
    // Automation joined Server in 2.10.0 (the user: "our own automation setting under server").
    check("those five, in that order", server, ["Settings", "Automod", "Automation", "Server presets", "Advanced", "< Back"])
}

console.log("\n— the groups say what they hold —")
{
    check("seven groups", GROUPS.map(g => g.label), ["Travel", "Chat", "Names and tags", "Moderation", "Player extras", "Omnitool", "Automation"])
    // A group's button text is its hint. Every page inside should be named in
    // it, or near enough, so nobody has to open a group to find out.
    check("every group and page has a hint", GROUPS.flatMap(g => [g, ...g.pages]).filter(x => !x.hint).map(x => x.label), [])
    check("Travel holds the travel features, TPA and RTP included",
        pageOf("travel", "Teleport requests").fields.map(f => f.key), ["feature.tpa", "tpa.expire"])
    check("and Random teleport carries its own distances",
        pageOf("travel", "Random teleport").fields.map(f => f.key), ["feature.rtp", "rtp.minimum", "rtp.range", "rtp.tries"])
}

console.log("\n— every slider can show its shipped value —")
{
    const sliders = GROUPS.flatMap(g => g.pages.flatMap(p => p.fields)).filter(f => f.kind === "slider")
    const outside = sliders.filter(f => {
        const v = Number(DEFAULTS[f.key].value)
        return !(v >= f.min && v <= f.max) || (v - f.min) % f.step !== 0
    }).map(f => f.key)
    check("each default sits inside its range, on a step", outside, [])
    check("every switch is a true/false setting",
        GROUPS.flatMap(g => g.pages.flatMap(p => p.fields)).filter(f => f.kind === "toggle" && !["true", "false"].includes(DEFAULTS[f.key].value)).map(f => f.key), [])
    check("and no key is listed twice", settingKeys().length, new Set(settingKeys()).size)
}

console.log("\n— a page holds everything about one thing —")
{
    // Settings ▸ Travel ▸ Teleport requests: the switch, and how long a request lasts.
    const travel = GROUPS.findIndex(g => g.id === "travel")
    const tpa = GROUPS[travel].pages.findIndex(p => p.label === "Teleport requests")
    __ui.answers.push(press(travel), press(tpa), submit(false, 120))
    await settingsScreen(boss, () => {})
    check("one form turns TPA off", flag("feature.tpa"), false)
    check("and sets how long a request lasts", setting("tpa.expire"), "120")
    resetSetting("feature.tpa"); resetSetting("tpa.expire")
}

console.log("\n— only what moved is written —")
{
    // Set out of range somewhere else, shown clamped here, and left alone.
    setSetting("rtp.range", "50000")
    const page = pageOf("travel", "Random teleport")
    __ui.answers.push(submit(true, 256, 20000, 24))
    await pageScreen(boss, page, () => {})
    check("an unmoved slider does not rewrite an out-of-range value", setting("rtp.range"), "50000")
    resetSetting("rtp.range")

    __ui.answers.push(submit(true, 256, 6000, 24))
    await pageScreen(boss, page, () => {})
    check("a moved one does", setting("rtp.range"), "6000")
    resetSetting("rtp.range")

    // An answer that never came back keeps the old value rather than reading as off.
    __ui.answers.push(submit(undefined, 256, 4000, 24))
    await pageScreen(boss, page, () => {})
    check("an unanswered switch keeps its value", flag("feature.rtp"), true)
}

console.log("\n— names above heads, handed back —")
{
    const other = {
        id: "set-other", name: "Other", nameTag: "§c[Mod] Other", commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {}
    }
    __test.players.push(other)
    __ui.answers.push(submit(false))
    await pageScreen(boss, pageOf("names", "Names above heads"), () => {})
    check("switched off", flag("feature.nametags"), false)
    check("and every name goes back to the gamertag once", other.nameTag, "Other")
    resetSetting("feature.nametags")
}

console.log("\n— Automod is its own door —")
{
    // Checks, then Chat screening, which is greyed out while chat automod is
    // on hold (tests/hold.test.js). Held messages shows only when one waits.
    __ui.answers.length = 0
    await automodHubScreen(boss, () => {})
    const hub = buttonsOf(lastForm()).map(t => t.split("\n")[0].replace(/§./g, ""))
    check("Checks and Chat screening, and no empty held queue", hub, ["Checks", "Chat screening", "< Back"])
    // The screening settings still work, for the day the hold lifts.
    __ui.answers.push(submit(true, 0, 2, 2, 1, 2, 10, true))
    await screeningScreen(boss, () => {})
    check("ordinary swearing set to whole words", setting("filter.profanity"), "1")
    check("a held message now also mutes", setting("filter.action"), "mute")
    check("for ten minutes", setting("filter.muteSeconds"), "600")
    for (const key of ["filter.profanity", "filter.action", "filter.muteSeconds"]) resetSetting(key)
}

console.log("\n— Server presets asks for ideas on the Discord —")
// The user, 2026-11-12: "when people click on it it says join the discord to
// suggest ideas for presets".
{
    __ui.answers.length = 0
    await openPanel(boss)
    const serverAt = buttonsOf(lastForm()).findIndex(text => text.includes("Server"))
    __ui.answers.push(press(serverAt))
    await openPanel(boss)
    const presetsAt = buttonsOf(lastForm()).findIndex(text => text.includes("Server presets"))
    __ui.answers.push(press(serverAt), press(presetsAt))
    await openPanel(boss)
    const screen = lastForm()
    const body = String(screen.parts.find(p => p[0] === "body")?.[1] ?? "")
    check("it is the presets screen", String(screen.parts.find(p => p[0] === "title")?.[1]).includes("Server presets"), true)
    check("it asks for ideas on the Discord", body.includes("Join the Discord to suggest ideas"), true)
    check("and offers no old preset to pick", buttonsOf(screen).map(t => t.replace(/§./g, "")), ["< Back"])
    check("with no link set, it says one is coming", body.includes("link is coming soon"), true)

    CONFIG.brand.discord = "discord.gg/example"
    __ui.answers.push(press(serverAt), press(presetsAt))
    await openPanel(boss)
    check("with a link set, it prints the link",
        String(lastForm().parts.find(p => p[0] === "body")?.[1] ?? "").includes("discord.gg/example"), true)

    await creditsScreen(boss, () => {})
    const credits = String(lastForm().parts.find(p => p[0] === "body")?.[1] ?? "")
    check("Credits has a place for the Discord", credits.includes("§fDiscord") && credits.includes("discord.gg/example"), true)
    CONFIG.brand.discord = ""
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
