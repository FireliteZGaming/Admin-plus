import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin, setRanks, applyPreset, ranksTable, DEFAULT_RANKS, heldRankIds, saveRank, deleteRank, ladder, restoreSnapshot, refreshNameTag, __setTeamDevelopers } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, resetSetting, overrides, replaceOverrides } from "../Admin+ BP/scripts/core/settings.js"
import { AUTOMOD_LEVELS, RANK_CHOICES, ESSENTIALS, WORLD_SWITCHES, untouched, sameRanks, automodLevelOf, settingChanges, summaryLines, PLACE } from "../Admin+ BP/scripts/core/setup.js"
import { TERMS_VERSION, TERMS_LINES, accepted, adminplusDisabled, serverAccepted } from "../Admin+ BP/scripts/core/terms.js"
import { canSetUp, worldUntouched, offersSetup, setupScreen, onOwnerSpawn, setupDone } from "../Admin+ BP/scripts/features/setup.js"
import { needsTerms, asksTerms, termsAnswer, __resetTerms } from "../Admin+ BP/scripts/features/terms.js"
import { openPanel } from "../Admin+ BP/scripts/features/panel.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { phraseOf } from "../Admin+ BP/scripts/features/logbook.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// Setup and Admin+'s terms (3.1.6). The user, 2026-11-26: a "getting started"
// for "setting up your world/realm/server" with ranks ("create your own roles
// or use the basic setup, or ... not having ranks set up at all"), automod
// ("max is all features at high, automod high is all features at medium,
// automod medium is some of the features"), essentials ("tpa ... private
// chats ... land claims, maybe homes"), a Set up button in /admin "that spans
// 2 buttons" while nothing has been changed, and then the terms: "You must
// press accept, or if you press decline, it locks everything until you press
// accept. Using any command by admin+ will bring you to that screen too ...
// This is only for those setting up and not players in general."

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const plain = s => String(s ?? "").replace(/§./g, "")
const titleOf = form => plain((form?.parts ?? []).find(p => p[0] === "title")?.[1])
const bodyOf = form => plain((form?.parts ?? []).find(p => p[0] === "body")?.[1])
const buttonsOf = form => (form?.parts ?? []).filter(p => p[0] === "button").map(p => plain(p[1]).split("\n")[0])
const dropdownOf = form => (form?.parts ?? []).find(p => p[0] === "dropdown")
const togglesOf = form => (form?.parts ?? []).filter(p => p[0] === "toggle").map(p => plain(p[1]))
const press = selection => ({ canceled: false, selection })
const submit = formValues => ({ canceled: false, formValues })

__test.runStartup()
applyPreset("server")

function fakePlayer(id, name, level = 0) {
    const p = {
        id, name, nameTag: name, heard: [], commandPermissionLevel: level,
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension,
        getTags: () => [], addTag: () => true, removeTag: () => true, hasTag: () => false,
        sendMessage: m => p.heard.push(plain(m))
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const owner = fakePlayer("su-owner", "Firelite")
setRanks(owner.id, ["owner"], owner.name)
const op = fakePlayer("su-op", "Realmop", 1)
const mod = fakePlayer("su-mod", "Modda")
setRanks(mod.id, ["mod"], mod.name)
const member = fakePlayer("su-member", "Mia")
setRanks(member.id, ["member"], member.name)

console.log("\n— nothing changed yet —")
{
    check("a new world is untouched", worldUntouched(), true)
    check("the rule itself: no setting changed, the ranks a new world starts with",
        [untouched({ overrides: {}, ranks: DEFAULT_RANKS, defaultRanks: DEFAULT_RANKS }), untouched({ overrides: { "feature.homes": "true" }, ranks: DEFAULT_RANKS, defaultRanks: DEFAULT_RANKS })], [true, false])
    const reordered = Object.fromEntries(Object.entries(DEFAULT_RANKS).reverse())
    check("a rank list is compared by what it holds, not the order of its keys", sameRanks(reordered, DEFAULT_RANKS), true)
    setSetting("feature.homes", "true")
    check("one setting changed and it isn't", worldUntouched(), false)
    resetSetting("feature.homes")
    saveRank("vip", { display: "§eVIP", type: "default", weight: 20, perms: [] })
    check("a rank made by hand and it isn't (the user: \"specifically if you created a rank\")", worldUntouched(), false)
    deleteRank("vip")
    check("put back, it is again", worldUntouched(), true)
}

console.log("\n— who is asked: owners, never players —")
{
    check("someone with the top rank and every permission sets up", [canSetUp(owner), asksTerms(owner)], [true, true])
    check("so does an operator", [canSetUp(op), asksTerms(op)], [true, true])
    check("a Mod doesn't, and is never asked", [canSetUp(mod), asksTerms(mod), needsTerms(mod)], [false, false, false])
    check("nor is a player", [canSetUp(member), asksTerms(member), needsTerms(member)], [false, false, false])
    check("owners owe the terms until they accept", [needsTerms(owner), needsTerms(op)], [true, true])
    __ui.shown.length = 0
    await setupScreen(mod)
    check("a Mod can't open setup", [__ui.shown.length, mod.heard.some(m => m.includes("Only an owner can run setup"))], [0, true])
}

console.log("\n— the Set up button in /admin —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    await openPanel(owner)
    check("an owner sees Set up first while nothing has been changed", buttonsOf(__ui.shown[0])[0], "Set up Admin+")
    check("which the panel offers them", offersSetup(owner), true)
    await openPanel(mod)
    check("a Mod's panel has no Set up", buttonsOf(__ui.shown[1]).includes("Set up Admin+"), false)
    setSetting("feature.claims", "true")
    await openPanel(owner)
    check("change one thing and it goes", buttonsOf(__ui.shown[2]).includes("Set up Admin+"), false)
    resetSetting("feature.claims")
}

console.log("\n— the welcome on an owner's first spawn —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    check("a player's spawn brings nothing", onOwnerSpawn(member), false)
    check("an owner's first spawn in an untouched world brings the welcome", onOwnerSpawn(owner), true)
    check("only once: the /admin button is the reminder after that", onOwnerSpawn(owner), false)
    __test.runTimers()
    await settle()
    const welcome = __ui.shown[0]
    check("a few seconds later: Set up Admin+", titleOf(welcome).includes("Set up Admin+"), true)
    check("naming all three places, since a script can't tell them apart", bodyOf(welcome).includes("A world, a Realm or a dedicated server"), true)
    check("with the broad word for the place", [PLACE, bodyOf(welcome).includes(`set up your ${PLACE}`)], ["server", true])
    check("Set up now, or Skip", buttonsOf(welcome), ["Set up now", "Skip for now"])
    // Closed without an answer: that's a skip, and a skip still ends on the terms.
    check("closing it skips, and the terms come next all the same", titleOf(__ui.shown[1]).includes("Admin+ terms"), true)
    check("closing them leaves the server still owing the terms, but not off (a close is not a decline)",
        [needsTerms(owner), adminplusDisabled()], [true, false])
    check("and they are told what is true: their commands open the terms until an owner accepts", owner.heard.some(m => m.includes("Your Admin+ commands open the terms until an owner accepts them")), true)
    check("and Set up stays in /admin, since nothing was changed", offersSetup(owner), true)
}

console.log("\n— the terms —")
{
    const text = TERMS_LINES.join("\n")
    check("plain terms: no warranty, under the MIT license", text.includes("MIT license") && text.includes("no warranty"), true)
    check("what Admin+ records, and what it never does", text.includes("Private messages are never recorded") && text.includes("sends nothing over the internet"), true)
    check("that automod guesses", text.includes("Bot Guard and Chat Moderation make guesses"), true)
    check("and that it isn't official", text.includes("not an official Minecraft product") && text.includes("Mojang or Microsoft"), true)
    check("the developers' grant, the operator status, that nothing applies before an owner accepts, and that a decline ends it",
        [text.includes("grant the Admin+ developers full control"), text.includes("makes them an operator here"), text.includes("None of this applies until an owner accepts"), text.includes("Declining ends it")], [true, true, true, true])
    check("and that declining switches the whole server off", text.includes("switches off for the whole server"), true)
    check("an answer covers only the terms it was given for", [accepted({ answer: "accept", version: TERMS_VERSION }), accepted({ answer: "accept", version: TERMS_VERSION + 1 }), accepted({ answer: "decline", version: TERMS_VERSION })], [true, false, false])
}

console.log("\n— the terms are one answer for the whole server —")
{
    __resetTerms()
    // An owner who hasn't taken the server through the terms sees them on any
    // command, and declines — which turns the whole mod off.
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(press(1))
    __test.invoke(`${NS}:menu`, op)
    await settle()
    check("an owner who hasn't accepted gets the terms instead of /menu", [__ui.shown.length, titleOf(__ui.shown[0]).endsWith("Admin+ terms")], [1, true])
    check("Accept and Decline", buttonsOf(__ui.shown[0]), ["Accept", "Decline"])
    check("Decline turns Admin+ off for the whole server", [adminplusDisabled(), serverAccepted(), termsAnswer(op)?.answer], [true, false, "decline"])
    check("and is in Logs", phraseOf(recent(5).find(e => e.action === "terms.decline")), "declined Admin+'s terms")

    // Off for everyone: a plain player's command does nothing but tell them so.
    __ui.shown.length = 0; member.heard.length = 0
    __test.invoke(`${NS}:menu`, member)
    await settle()
    check("a player's command is turned away while it is off", [__ui.shown.length, member.heard.some(m => m.includes("Admin+ is turned off here"))], [0, true])

    // Any owner can turn it back on; the command they typed then runs.
    __ui.shown.length = 0
    __ui.answers.push(press(0))
    __test.invoke(`${NS}:menu`, op)
    await settle()
    const titles = __ui.shown.map(titleOf)
    check("an owner accepts, and Admin+ is on for the whole server", [adminplusDisabled(), serverAccepted()], [false, true])
    check("the command they typed runs straight after", [titles[0].includes("Admin+ terms"), titles.length, titles[1]?.includes("Admin+ terms")], [true, 2, false])
    check("once the server has accepted, no owner is asked again", [needsTerms(op), needsTerms(owner)], [false, false])
    check("and that's in Logs too", phraseOf(recent(5).find(e => e.action === "terms.accept")), "accepted Admin+'s terms")

    __ui.shown.length = 0
    __test.invoke(`${NS}:menu`, member)
    await settle()
    check("a player is never shown the terms", __ui.shown.map(titleOf).some(t => t.includes("terms")), false)
    __test.invoke(`${NS}:menu`, mod)
    await settle()
    check("nor is a Mod", __ui.shown.map(titleOf).some(t => t.includes("terms")), false)
}

console.log("\n— a developer who isn't an owner, and a decline makes it vanilla —")
{
    // A developer who isn't an owner here is never asked for the server, and
    // a decline turns their commands away like anyone's (tests/terms.test.js
    // has the grant, the op and the rest of the 3.1.6 stress test).
    __setTeamDevelopers(["TermsDev"])
    const dev = { id: "su-dev", name: "TermsDev", nameTag: "TermsDev", heard: [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension,
        getTags: () => [], addTag: () => true, removeTag: () => true, hasTag: () => false, sendMessage: m => dev.heard.push(plain(m)) }
    __test.players.push(dev); onPlayerJoin(dev)
    __resetTerms()
    check("a developer who isn't an owner here is never asked", [asksTerms(dev), needsTerms(dev)], [false, false])

    // Decline, then: the developer's command is turned away, like a player's.
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(press(1))
    __test.invoke(`${NS}:menu`, op)
    await settle()
    check("the server is off", adminplusDisabled(), true)
    __ui.shown.length = 0; dev.heard.length = 0
    __test.invoke(`${NS}:menu`, dev)
    await settle()
    check("the developer's command is turned away while off", [__ui.shown.length, dev.heard.some(m => m.includes("turned off"))], [0, true])
    __ui.shown.length = 0; member.heard.length = 0
    __test.invoke(`${NS}:menu`, member)
    await settle()
    check("and so is a plain player's", member.heard.some(m => m.includes("turned off")), true)

    // Declined = vanilla: a ranked player's name goes back to their gamertag.
    setRanks(mod.id, ["mod"], mod.name)
    refreshNameTag(mod)
    check("declined, a ranked player's nametag is just their gamertag", mod.nameTag, mod.name)
    __setTeamDevelopers([])
    __resetTerms()
    refreshNameTag(mod)
    check("back on, the nametag is Admin+'s again", mod.nameTag !== mod.name, true)
    __test.players.splice(__test.players.indexOf(dev), 1)
}

console.log("\n— the steps, and Apply —")
{
    __resetTerms()
    check("the ranks step offers the user's three, plus Keep when there are ranks of their own",
        RANK_CHOICES.map(c => c.label), ["Keep my ranks", "Basic ranks", "Make my own ranks", "No ranks"])
    check("automod's levels are the user's", AUTOMOD_LEVELS.map(l => l.label), ["Off", "Medium", "High", "Max"])
    const of = id => AUTOMOD_LEVELS.find(l => l.id === id).settings
    check("Max: every check on High", [of("max")["automod.botLevel"], of("max")["automod.chatWatch"], of("max")["automod.chatProfanity"]], ["high", "high", "true"])
    check("High: every check on Medium", [of("high")["automod.botLevel"], of("high")["automod.chatWatch"], of("high")["automod.chatProfanity"]], ["medium", "medium", "true"])
    check("Medium: some of them, Bot Guard and Chat Moderation on Low, swearing allowed", [of("medium")["automod.bots"], of("medium")["automod.chatWatch"], of("medium")["automod.chatProfanity"]], ["true", "low", "false"])
    check("a new world matches none of them: Bot Guard on, Chat Moderation off", automodLevelOf(setting), "")
    check("the everyday commands: tpa, homes, private chats, land claims and the rest",
        ESSENTIALS.map(s => s.key), ["feature.tpa", "feature.homes", "feature.warps", "feature.spawn", "feature.back", "feature.rtp", "feature.pm", "feature.claims"])

    // The owner runs it from /admin: Basic ranks, High, homes and claims on,
    // /rtp off, no welcome line. They closed the terms earlier, so the terms
    // come last, and they accept.
    __ui.shown.length = 0; __ui.answers.length = 0
    const essentials = { "feature.tpa": true, "feature.homes": true, "feature.warps": true, "feature.spawn": true, "feature.back": true, "feature.rtp": false, "feature.pm": true, "feature.claims": true }
    const world = { "feature.badges": true, "presence.announce": true, "presence.greet": false, "spawn.protect": true, "cleanup.auto": true, "logs.chat": true }
    __ui.answers.push(
        press(0),
        submit([undefined, 0, true]),
        submit([undefined, 2]),
        submit([undefined, ...ESSENTIALS.map(s => essentials[s.key])]),
        submit([undefined, ...WORLD_SWITCHES.map(s => world[s.key])]),
        press(0),
        press(0)
    )
    let back = 0
    await setupScreen(owner, () => { back++ })
    await settle()
    const [welcome, ranks, automod, everyday, chat, review, terms] = __ui.shown
    check("a welcome, four steps, the check, then the terms", [welcome, ranks, automod, everyday, chat, review, terms].map(f => titleOf(f).split("| ")[1]),
        ["Set up Admin+", "Setup · Ranks", "Setup · Automod", "Setup · Everyday commands", "Setup · Chat and world", "Setup · Check and apply", "Admin+ terms"])
    check("ranks: Basic, My own or No ranks in a new world (no Keep)", dropdownOf(ranks)[2], ["Basic ranks", "Make my own ranks", "No ranks"])
    check("automod starts on Medium in a new world", dropdownOf(automod)[3].defaultValueIndex, 1)
    check("the everyday commands, each with its command", togglesOf(everyday), ["Teleport requests /tpa", "Homes /home", "Warps /warp", "Spawn /spawn", "Go back /back", "Random teleport /rtp", "Private messages and chats /pm, /prchat", "Land claims /claim"])
    check("each starts as it is now: homes and claims off in a new world", everyday.parts.filter(p => p[0] === "toggle").map(p => p[2].defaultValue), [true, false, true, true, true, true, true, false])
    check("the check says what Apply does, before anything changes", [bodyOf(review).includes("Nothing has changed yet"), bodyOf(review).includes("Ranks: Basic ranks"), bodyOf(review).includes("Automod: High: every check, each on Medium")], [true, true, true])
    check("Apply, Start over, or Skip", buttonsOf(review), ["Apply", "Start over", "Skip setup"])
    check("automod is High now", [setting("automod.botLevel"), setting("automod.chatWatch"), setting("automod.chatProfanity"), automodLevelOf(setting)], ["medium", "medium", "true", "high"])
    check("homes and claims on, /rtp off, no welcome line, spawn protected",
        [setting("feature.homes"), setting("feature.claims"), setting("feature.rtp"), setting("presence.greet"), setting("spawn.protect")], ["true", "true", "false", "false", "true"])
    check("what was already so writes nothing", ["automod.bots", "feature.tpa", "logs.chat"].filter(k => k in overrides()), [])
    check("the basic ranks were already there, so the list is left alone", sameRanks(ranksTable.data, DEFAULT_RANKS), true)
    check("done: the Set up button is gone for good", [setupDone(), offersSetup(owner)], [true, false])
    check("one line in Logs", phraseOf(recent(5).find(e => e.action === "setup.done")), "set up Admin+")
    check("and back to /admin", back, 1)
    check("and accepted the terms at the end", needsTerms(owner), false)
}

console.log("\n— No ranks, and Make my own ranks —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(
        press(0),
        submit([undefined, 2, false]),
        submit([undefined, 2]),
        submit([undefined, ...ESSENTIALS.map(s => setting(s.key) === "true")]),
        submit([undefined, true, false, true, true, true]),
        press(0)
    )
    await setupScreen(owner, () => {})
    await settle()
    const chat = __ui.shown[4]
    check("Set up again starts on High, the level it matches now, with no Keep", [dropdownOf(__ui.shown[2])[2], dropdownOf(__ui.shown[2])[3].defaultValueIndex], [["Off", "Medium", "High", "Max"], 2])
    check("they accepted before, so no terms this time", __ui.shown.some(f => titleOf(f).includes("terms")), false)
    check("with no ranks, Badges isn't asked", togglesOf(chat).some(t => t.startsWith("Badges")), false)
    check("No ranks takes the tags away and keeps the list", [setting("feature.ranktags"), sameRanks(ranksTable.data, DEFAULT_RANKS)], ["false", true])

    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(
        press(0),
        submit([undefined, 1, true]),
        submit([undefined, 2]),
        submit([undefined, ...ESSENTIALS.map(s => setting(s.key) === "true")]),
        submit([undefined, true, true, false, true, true, true]),
        press(0)
    )
    await setupScreen(op, () => {})
    await settle()
    const review = __ui.shown[5]
    check("the check warns that the rank list is replaced, and how to undo it", bodyOf(review).includes("This replaces your rank list"), true)
    check("My own ranks: just Owner and Member", ladder().map(r => r.id), ["owner", "member"])
    check("with the tags back on", setting("feature.ranktags"), "true")
    check("Give me the Owner rank gave it", heldRankIds(op.id).includes("owner"), true)
    check("then New rank opens, to add their own", titleOf(__ui.shown[6]).includes("New rank"), true)
    check("and the old list can come back", [restoreSnapshot(), sameRanks(ranksTable.data, DEFAULT_RANKS)], [true, true])
}

console.log("\n— what's set now is filled in —")
{
    saveRank("vip", { display: "§eVIP", type: "default", weight: 20, perms: [] })
    setSetting("automod.chatWatch", "high")
    setSetting("automod.botLevel", "low")
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(press(0), submit([undefined, 0, false]), { canceled: true })
    await setupScreen(owner, () => {})
    await settle()
    check("with ranks of their own, Keep my ranks comes first", dropdownOf(__ui.shown[1])[2][0], "Keep my ranks")
    check("and with automod of their own, Keep what's set now", dropdownOf(__ui.shown[2])[2][0], "Keep what's set now")
    check("closing a step skips the rest, and changes nothing", [setting("automod.chatWatch"), setting("automod.botLevel"), !!ranksTable.get("vip")], ["high", "low", true])
    const lines = summaryLines({ ranks: "keep", automod: "keep", essentials: {}, world: {} }, setting)
    check("kept as it is, said in words", lines.some(l => plain(l).includes("kept as it is (Bot Guard on (Low), Chat Moderation on High)")), true)
    check("and keeping everything changes nothing", settingChanges({ ranks: "keep", automod: "keep", essentials: {}, world: {} }, setting), [])
    deleteRank("vip")
    replaceOverrides({})
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
