import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin, setRanks, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, resetSetting, DEFAULTS, flag } from "../Admin+ BP/scripts/core/settings.js"
import { CHAT_AUTOMOD_ON_HOLD } from "../Admin+ BP/scripts/core/hold.js"
import { heldCount, clearHeld } from "../Admin+ BP/scripts/core/heldchat.js"
import { mute, unmute, isMuted } from "../Admin+ BP/scripts/core/moderation.js"
import { startPair, endPair } from "../Admin+ BP/scripts/core/privatechat.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { recentChat, recentSigns, __resetChatLog } from "../Admin+ BP/scripts/core/chatlog.js"
import { forgetPlayer, forgetStrikes } from "../Admin+ BP/scripts/core/automod.js"
import { FEATURE_VERSION, featuresOf } from "../Admin+ BP/scripts/core/toxfeatures.js"
import { TOX_MODEL } from "../Admin+ BP/scripts/core/toxmodel.js"
import { loadModel, scoreMessage, verdict, closest, pushes, pushTries, lineFor, LEVELS, HOLDS } from "../Admin+ BP/scripts/core/toxicity.js"
import { wordListMatch } from "../Admin+ BP/scripts/core/chatfilter.js"
import { CATEGORIES, LEVEL_RULES, noteSwearing, spamAction, caughtFor, SWEAR_WINDOW, WARNING_LASTS } from "../Admin+ BP/scripts/core/chatmod.js"
import { modelState, loadChatModel, modLevel, chatModerationScreen, chatSettingsScreen, testScreen, testReport, chatSummary, CHAT_FIELDS, ASK_TEXT } from "../Admin+ BP/scripts/features/chatcheck.js"
import { __forgetSwearing } from "../Admin+ BP/scripts/features/chatmod.js"
import { chatReadLine } from "../Admin+ BP/scripts/features/logsUI.js"
import { automodHubScreen } from "../Admin+ BP/scripts/features/automodUI.js"

// /automod ▸ Chat Moderation (3.1.4), and the chat model under it (3.1.0 on).
// The user's layout, 2026-11-26: "Chat Moderation", with "the simple Low
// Medium High", a switch for confirming with the player first, then the
// categories, "common categories but not too many", and "spam should be a
// fifth switch of course". Profanity: "the light warn if used too much, then
// muted, never really kicked unless spamming it, that would be on medium, low
// would never actually kick". Spam: "get rid of it before it actually sends".
// Signs: "if it catches it on a side, it could just completely clear the
// sign". All of it "logged in logs (chat)". Everything below goes through the
// real chat, forms, model and settings.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

__test.runStartup()

let nextId = 1
function fakePlayer(name, { op = false } = {}) {
    const tags = new Set()
    const p = {
        id: `cc${nextId++}`, name, nameTag: name, inbox: [],
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(typeof m === "string" ? m : JSON.stringify(m)),
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const clean = s => String(s ?? "").replace(/§./g, "")
const firstLine = s => clean(s).split("\n")[0]
const press = selection => ({ canceled: false, selection })
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const told = (player, words) => player.inbox.some(m => clean(m).includes(words))
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** console.log, caught: what the pack writes to the content log. */
const logged = []
function capture(fn) {
    const real = console.log
    logged.length = 0
    console.log = (...args) => { logged.push(args.join(" ")) }
    try { return fn() } finally { console.log = real }
}

const INPUTS = ["toggle", "slider", "text", "dropdown"]
const fieldParts = form => form.parts.filter(p => !["title", "submit", "body", "button"].includes(p[0]))
function defaultOf(part) {
    switch (part[0]) {
        case "toggle": return !!part[2]?.defaultValue
        case "slider": return part[4]?.defaultValue
        case "text": return part[3]?.defaultValue ?? ""
        case "dropdown": return part[3]?.defaultValueIndex ?? 0
        default: return undefined
    }
}
/** Every answer the form would send back unchanged, with `changes` (by label's first line) applied. */
const answersFor = (form, changes = {}) =>
    fieldParts(form).map(p => INPUTS.includes(p[0]) && firstLine(p[1]) in changes ? changes[firstLine(p[1])] : defaultOf(p))

applyPreset("server")
const boss = fakePlayer("Boss", { op: true })
setRanks(boss.id, ["owner"], boss.name)
const member = fakePlayer("Chatty")
const reader = fakePlayer("Reader")

/** Open a modal screen once, unanswered, and return it. */
async function readForm(open) {
    __ui.answers.length = 0
    __ui.shown.length = 0
    await open()
    return lastForm()
}
/** Fill a modal screen and submit. Returns every form shown after. */
async function fill(open, changes, then = []) {
    const page = await readForm(open)
    __ui.answers.length = 0
    __ui.shown.length = 0
    __ui.answers.push({ canceled: false, formValues: answersFor(page, changes) }, ...then)
    boss.inbox.length = 0
    await open()
    return [...__ui.shown]
}
const saveSettings = changes => fill(() => chatSettingsScreen(boss, () => {}), changes)
const runTest = (line, then = []) => fill(() => testScreen(boss, () => {}), { Message: line }, then)
const reset = () => { for (const p of [boss, member, reader]) p.inbox.length = 0; __ui.answers.length = 0; __ui.shown.length = 0 }

console.log("\n— the shipped model —")
{
    // 3.1.3: round 5, with threats, slurs, death wishes and racism, and features v2.
    check("it is the game-chat retrain, round 5", TOX_MODEL.name, "b16-e2-game5")
    check("built for the features this pack computes", TOX_MODEL.featureVersion, FEATURE_VERSION)
    check("five outputs, in the order the levels expect", TOX_MODEL.outputs, ["toxic", "discrimination", "sexual", "hostility", "profanity"])
    const descending = TOX_MODEL.outputs.every(name => {
        const lines = LEVELS.map(l => lineFor(TOX_MODEL, name, l.id)).filter(x => x !== undefined)
        return lines.every((x, i) => i === 0 || lines[i - 1] >= x)
    })
    check("each output's lines get lower from Low to High", descending, true)
    check("High has a line for every output that can hold",
        TOX_MODEL.outputs.filter(n => HOLDS.has(n)).every(n => lineFor(TOX_MODEL, n, "high") !== undefined), true)
    check("only discrimination, sexual content and hostility can hold", [...HOLDS], ["discrimination", "sexual", "hostility"])
    const notices = readFileSync(new URL("../THIRD-PARTY-NOTICES.md", import.meta.url), "utf8")
    check("THIRD-PARTY-NOTICES credits every training set the model names",
        ["Civil Comments", "Measuring Hate Speech", "HateXplain"].every(set => TOX_MODEL.trainedOn.includes(set) && notices.includes(set)), true)
    check("and names the weights file", notices.includes("core/toxmodel.js"), true)

    const m = loadModel(TOX_MODEL)
    const v = line => verdict(m, scoreMessage(m, line))
    check("a friendly line is held by no level", LEVELS.map(l => v("gg well played")[l.id].length), [0, 0, 0])
    check("a clear insult at a player is held even at Low", v("you are an idiot").low.some(h => h.name === "hostility"), true)
    const atTheGame = ["oh shit i lost everything", "fuck this creeper", "holy shit diamonds"]
    check("swearing at the game is held by no level", atTheGame.map(line => LEVELS.map(l => v(line)[l.id].length)), atTheGame.map(() => [0, 0, 0]))
    check("though the swearing score still sees it", atTheGame.every(line =>
        scoreMessage(m, line)[m.outputs.indexOf("profanity")] > lineFor(m, "profanity", "high")), true)
    check("PvP talk with the game named is held by no level", LEVELS.map(l => v("i will kill you in pvp")[l.id].length), [0, 0, 0])
    check("two words of swearing at the lag are held by neither Low nor Medium", [v("damn lag").low.length, v("damn lag").medium.length], [0, 0])
    check("a bare swear word is held by neither Low nor Medium", [v("fuck").low.length, v("fuck").medium.length], [0, 0])
}

/** A model of 2^16 rows and three outputs, zero except the rows given. */
function modelWith(rows = {}, bias = [1.5, 5, 5]) {
    const w = new Int8Array((1 << 16) * 3)
    for (const [row, values] of Object.entries(rows)) values.forEach((value, j) => { w[row * 3 + j] = value })
    return loadModel({
        featureVersion: FEATURE_VERSION, bits: 16, outputs: ["hostility", "profanity", "toxic"], scales: [0.1, 0.1, 0.1], bias,
        levels: { hostility: { low: 2, medium: 1, high: 0 }, profanity: { low: 0, medium: 0, high: 0 }, toxic: { low: 0, medium: 0, high: 0 } },
        data: Buffer.from(w.buffer).toString("base64")
    })
}

console.log("\n— the model's levels, and why —")
{
    const m = modelWith()
    const scores = scoreMessage(m, "anything")
    const v = verdict(m, scores)
    check("Low's line is over the score, Medium's and High's under it", [v.low.length, v.medium.length, v.high.length], [0, 1, 1])
    check("a hit names its output, its score and the line", v.medium[0], { name: "hostility", score: 1.5, line: 1 })
    check("swearing and toxic over every line still hold nothing",
        [...v.low, ...v.medium, ...v.high].some(h => h.name === "profanity" || h.name === "toxic"), false)
    check("why Low didn't hold it: the closest output, and how far off", closest(m, scores, "low"), { name: "hostility", score: 1.5, line: 2, gap: 0.5 })
    const { hashes, counts } = featuresOf("kill")
    const piece = hashes[counts[0]]
    const weighted = modelWith({ [piece & 0xffff]: [piece >>> 31 ? -100 : 100, 0, 0] }, [0, 0, 0])
    const top = pushes(weighted, "i will kill you", "hostility")
    check("pushes() puts the weighted word first", top[0]?.word, "kill")
    check("words that push nothing up aren't listed", top.some(t => t.word === "you"), false)
    check("the why tries every word of a short line", pushTries("you are so bad at this"), 6)
    check("but only the first few of a long one, to stay near 50 ms in Bedrock", pushTries("word ".repeat(60)), 5)
}

console.log("\n— Chat Moderation's rules (core/chatmod.js) —")
{
    check("five switches, Twitch's four and Spam, in the page's order", CATEGORIES.map(c => c.label), ["Harassment", "Hate speech", "Sexual content", "Profanity", "Spam"])
    check("Spam is the old chat flooding switch", CATEGORIES.at(-1).key, "automod.spam")

    // Profanity at Medium: warned after 5 in 2 minutes, then muted after 3 more.
    const rules = LEVEL_RULES.medium
    let state, actions = []
    for (let i = 0; i < 8; i++) { const r = noteSwearing(state, 1000 * i, rules); state = r.state; actions.push(r.action) }
    check("Medium: a warning on the 5th swearing line in 2 minutes, a mute 3 lines later",
        actions, ["none", "none", "none", "none", "warn", "none", "none", "mute"])
    check("Low takes 8 before a warning, High 3", [LEVEL_RULES.low.swearWarnAt, LEVEL_RULES.high.swearWarnAt], [8, 3])
    const slow = [0, SWEAR_WINDOW, 2 * SWEAR_WINDOW, 3 * SWEAR_WINDOW, 4 * SWEAR_WINDOW]
    state = undefined
    const spread = slow.map(t => { const r = noteSwearing(state, t, rules); state = r.state; return r.action })
    check("swearing spread out over minutes never adds up", spread, ["none", "none", "none", "none", "none"])
    state = { times: [], warnedAt: 0 }
    check("a warning fades after 10 quiet minutes", noteSwearing(state, WARNING_LASTS + 1, rules).state.warnedAt, undefined)

    // Spam: the ladder, then a kick at the levels that kick.
    const ladder = [0, 60, 300, 600]
    check("strike 1 is a warning, then mutes in order", [1, 2, 3, 4].map(n => spamAction(n, ladder, rules).kind), ["warn", "mute", "mute", "mute"])
    check("Medium and High kick a player still spamming after the longest mute",
        [spamAction(5, ladder, LEVEL_RULES.medium).kind, spamAction(5, ladder, LEVEL_RULES.high).kind], ["kick", "kick"])
    check("Low never kicks: it repeats the longest mute", spamAction(9, ladder, LEVEL_RULES.low), { kind: "mute", seconds: 600 })

    // What's caught: the model at the level, or the word list, for switches that are on.
    const hit = [{ name: "hostility", score: 3, line: 1 }]
    const all = () => true
    check("the model's catch, with its category", caughtFor(hit, [], all).map(c => [c.category.id, c.by]), [["harassment", "model"]])
    check("the word list catches too", caughtFor([], [{ category: "sexual", term: "nudes" }], all).map(c => [c.category.id, c.by, c.term]), [["sexual", "list", "nudes"]])
    check("a switched-off category is never caught", caughtFor(hit, [], c => c.id !== "harassment"), [])
    check("Profanity and Spam never hold a line", caughtFor([], [{ category: "profanity", term: "fuck" }], all), [])
}

console.log("\n— the model loads only when something needs it —")
{
    check("Chat Moderation starts off", [DEFAULTS["automod.chatWatch"].value, modLevel()], ["off", undefined])
    check("asking the player first starts on, and every switch is on", [DEFAULTS["automod.chatAsk"].value, CATEGORIES.every(c => flag(c.key))], ["true", true])
    reset()
    __test.emitChat(member, "you are an idiot")
    check("off, chat isn't read and nothing loads", [__test.jobs.length, modelState().percent], [0, 0])
    check("the line posts as always", told(reader, "you are an idiot"), true)

    setSetting("automod.chatWatch", "medium")
    __test.runTimers()   // the look a moment after the world opens
    check("with a level set, opening the world starts the load", __test.jobs.length, 1)
    check("in a job, a slice at a time", modelState().ready, false)

    // Before the model is ready the word list works alone.
    reset()
    __ui.answers.push(press(1))
    __test.emitChat(member, "just kys")
    await flush()
    check("while it loads, the word list still catches", [told(reader, "just kys"), __ui.shown.length], [false, 1])
    __test.emitChat(member, "you are an idiot")
    await flush()
    check("and a line only the model would catch posts", told(reader, "you are an idiot"), true)

    const shown = await runTest("you are an idiot")
    check("Test a message says it's still loading", told(boss, "still loading"), true)
    check("and keeps the line in the box", [shown.length, lastForm().parts.find(p => p[0] === "text")?.[3]?.defaultValue], [2, "you are an idiot"])
}

console.log("\n— the load, a step at a time —")
{
    const steps = capture(() => __test.runJobs())
    check("it took many steps, like ticks in a world", steps > 10, true)
    check("then the model is ready", modelState(), { ready: true, percent: 100, error: "" })
    check("and says so in the content log", logged.some(l => l.includes(`Chat model ${TOX_MODEL.name} ready in `)), true)
    check("asking again starts nothing", [loadChatModel()?.ready, __test.jobs.length], [true, 0])
}

console.log("\n— Test a message —")
{
    reset()
    const shown = await runTest("you are an idiot")
    const result = shown[shown.length - 1]
    const body = clean(result.parts.find(p => p[0] === "body")?.[1])
    check("the answer opens on its own screen", firstLine(result.parts.find(p => p[0] === "title")?.[1]).includes("Test a message"), true)
    check("it shows the line", body.includes("\"you are an idiot\""), true)
    check("Low would ask the player first, and says for what and from where", /Low: would ask the player first, for [^\n]*harassment \d+ \(caught from \d+\)/.test(body), true)
    check("in category words: Harassment, Hate speech, Sexual content", ["Harassment", "Hate speech", "Sexual content"].every(name => body.includes(name)), true)
    check("says whether it has swear words", body.includes("Profanity: no swear words."), true)
    check("why: what the top score falls to without a word of the line", /falls to \d+ without "(you|are|an|idiot)"/.test(body), true)
    check("the word list's answer is there too", body.includes("The word list"), true)
    check("Test another, then Back", result.parts.filter(p => p[0] === "button").map(p => firstLine(p[1])), ["Test another", "< Back"])
    check("nothing was sent to chat", told(reader, "you are an idiot"), false)

    const friendly = clean(testReport("gg well played"))
    check("a friendly line: every level lets it through", ["Low", "Medium", "High"].every(l => friendly.includes(`${l}: lets it through`)), true)
    check("and nothing to explain", friendly.includes("nothing to explain"), true)
    const kys = clean(capture(() => testReport("just kys")))
    check("the word list's catch is named", kys.includes("Catches it for harassment (kys)"), true)
    check("the content log gets a speed number, not the words",
        [logged.some(l => /Test a message: \d+ scorings in \d+ ms/.test(l)), logged.some(l => l.includes("kys"))], [true, false])
    const swear = clean(testReport("oh shit"))
    check("swearing is counted, not held", swear.includes("Profanity: swearing (shit)"), true)

    setSetting("automod.chatAsk", "false")
    check("with asking off, it says it would hold it for staff", clean(testReport("you are an idiot")).includes("would hold it for staff"), true)
    resetSetting("automod.chatAsk")
    setSetting("automod.chatHarassment", "false")
    const off = clean(testReport("you are an idiot"))
    check("a switched-off category doesn't count, and the screen says so", [off.includes("Low: lets it through"), off.includes("Switched off, so never caught: Harassment")], [true, true])
    resetSetting("automod.chatHarassment")
}

console.log("\n— colour codes —")
{
    const m = loadChatModel()
    check("a code inside a word scores like the plain word",
        Array.from(scoreMessage(m, "you are an §kid§ciot")), Array.from(scoreMessage(m, "you are an idiot")))
    const raw = testReport("you are an §kidiot")
    check("Test a message shows the line without its codes", [raw.includes("§k"), clean(raw).includes("\"you are an idiot\"")], [false, true])
    check("the word list reads through codes too", wordListMatch("just k§cys")?.category, "aggression")
}

console.log("\n— the settings page —")
{
    const page = await readForm(() => chatSettingsScreen(boss, () => {}))
    const dropdowns = page.parts.filter(p => p[0] === "dropdown")
    const toggles = page.parts.filter(p => p[0] === "toggle").map(p => firstLine(p[1]))
    check("one dropdown, the level: Off, Low, Medium, High", dropdowns.map(p => [firstLine(p[1]), p[2]]), [["Level", ["Off", "Low", "Medium", "High"]]])
    check("then Ask the player first, then the five switches", toggles, ["Ask the player first", "Harassment", "Hate speech", "Sexual content", "Profanity", "Spam"])
    check("each switch says what it covers", page.parts.filter(p => p[0] === "toggle").every(p => clean(p[1]).includes("\n")), true)
    check("the switches sit under What it catches", page.parts.some(p => p[0] === "label" && clean(p[1]) === "What it catches"), true)
    check("and the page quotes the box's words", page.parts.some(p => clean(p[1]).includes(ASK_TEXT)), true)
    check("its settings' home is this page", CHAT_FIELDS.map(f => f.key),
        ["automod.chatWatch", "automod.chatAsk", "automod.chatHarassment", "automod.chatHate", "automod.chatSexual", "automod.chatProfanity", "automod.spam"])

    await saveSettings({ Level: 1, "Sexual content": false })
    check("Save stores the level and the switch", [setting("automod.chatWatch"), flag("automod.chatSexual")], ["low", false])
    check("says what's on now", told(boss, "Chat Moderation: Low, asking the player first"), true)
    check("and Logs have it", recent(10).find(e => e.action === "automod.config")?.detail.startsWith("Chat Moderation: level low"), true)
    check("the hub's line says the level, how, and how many switches", clean(chatSummary()), "Low · asks first · 4 of 5 on")
    await saveSettings({ "Sexual content": true })
}

console.log("\n— Ask the player first —")
{
    // The user, 2026-11-26: "Are you sure you want to send this message? It
    // was flagged by our Automod system.", with a Send and a Cancel button.
    const LINE = "you are an idiot"
    const box = () => __ui.shown.find(f => clean(f.parts.find(p => p[0] === "body")?.[1]).includes(ASK_TEXT))
    __resetChatLog()

    reset()
    __ui.answers.push(press(0))
    __test.emitChat(member, LINE)
    await flush()
    check("a line Low would catch opens the box for its sender, in the user's words", !!box(), true)
    check("with the line in it, then Send and Cancel",
        [clean(box()?.parts.find(p => p[0] === "body")?.[1]).includes(`"${LINE}"`), box()?.parts.filter(p => p[0] === "button").map(p => clean(p[1]))], [true, ["Send", "Cancel"]])
    check("Send posts it", told(reader, LINE), true)
    check("staff hear they sent it anyway", told(boss, "sent it anyway"), true)
    check("and Logs ▸ Chat notes it on the line", recentChat(1)[0]?.mod?.includes("sent anyway"), true)

    reset()
    __ui.answers.push(press(1))
    __test.emitChat(member, LINE)
    await flush()
    check("Cancel drops it, and the sender is told", [told(reader, LINE), told(member, "Your message wasn't sent.")], [false, true])
    check("Logs ▸ Chat keeps the line it stopped, marked never sent",
        [recentChat(1)[0]?.text, recentChat(1)[0]?.unsent, recentChat(1)[0]?.mod?.includes("cancelled it")], [LINE, true, true])
    check("the reading view shows what Chat Moderation did", clean(chatReadLine(recentChat(1)[0]).join("\n")).includes("Chat Moderation: asked first"), true)

    reset()
    __ui.answers.push({ canceled: true, cancelationReason: "UserBusy" }, press(0))
    __test.emitChat(member, LINE)
    await flush()
    check("while the sender's chat is open, the line waits unposted", told(reader, LINE), false)
    __test.emitChat(member, LINE)
    await flush()
    check("one box at a time: a second flagged line isn't sent", told(member, "still asking about your last one"), true)
    __test.runTimers()
    await flush()
    await flush()
    check("when chat closes the box shows, and Send posts the first line", told(reader, LINE), true)

    reset()
    for (let i = 0; i < 21; i++) __ui.answers.push({ canceled: true, cancelationReason: "UserBusy" })
    __test.emitChat(member, LINE)
    for (let i = 0; i < 30; i++) { __test.runTimers(); await flush() }
    check("chat open for 10 seconds: not sent, and the sender is told why",
        [told(reader, LINE), told(member, "couldn't ask you about it while chat was open")], [false, true])

    reset()
    __test.emitChat(member, "gg well played")
    await flush()
    check("a line nothing catches posts at once, with no box", [told(reader, "gg well played"), __ui.shown.length], [true, 0])
}

console.log("\n— held for staff, with asking off —")
{
    setSetting("automod.chatAsk", "false")
    clearHeld()
    reset()
    __test.emitChat(member, "you are an idiot")
    await flush()
    check("the line is held for staff", heldCount(), 1)
    check("nobody else sees it", told(reader, "you are an idiot"), false)
    check("the sender sees it as if it went out", told(member, "you are an idiot"), true)
    check("staff are told where to find it", told(boss, "Held messages"), true)
    check("Logs ▸ Chat marks it held", [recentChat(1)[0]?.unsent, recentChat(1)[0]?.mod?.startsWith("held for staff: harassment")], [true, true])
    resetSetting("automod.chatAsk")
    clearHeld()
}

console.log("\n— switches off —")
{
    setSetting("automod.chatHarassment", "false")
    reset()
    __test.emitChat(member, "you are an idiot")
    await flush()
    check("Harassment off: an insult posts", [told(reader, "you are an idiot"), __ui.shown.length], [true, 0])
    resetSetting("automod.chatHarassment")
}

console.log("\n— Profanity: a light warning, then a mute, never a kick —")
{
    setSetting("automod.chatWatch", "medium")
    setSetting("automod.spam", "false")   // keep the count about swearing only
    __forgetSwearing()
    reset()
    __resetChatLog()
    for (let i = 0; i < 5; i++) __test.emitChat(member, "fuck")
    await flush()
    check("swearing still posts", reader.inbox.filter(m => clean(m).includes("fuck")).length, 5)
    check("the 5th swearing line at Medium brings a light warning", told(member, "Easy on the swearing"), true)
    check("staff hear it, and Logs ▸ Chat notes it", [told(boss, "warned for swearing too much"), recentChat(1)[0]?.mod], [true, "profanity: warned for swearing too much"])
    check("Logs ▸ Actions has it in plain words", recent(10).some(e => e.action === "automod.chat" && e.detail.startsWith("warned")), true)
    for (let i = 0; i < 3; i++) __test.emitChat(member, "fuck")
    await flush()
    check("3 more after the warning: muted for 5 minutes", [isMuted(member), told(member, "Muted for 5m")], [true, true])
    check("recorded as a mute for swearing", recent(10).some(e => e.action === "automod.chat" && e.detail.startsWith("muted")), true)
    unmute(member)
    resetSetting("automod.spam")
    __forgetSwearing()
}

console.log("\n— Spam: dropped before it sends —")
{
    // The user: "we could technically use a method to get rid of it before it actually sends right?"
    setSetting("automod.chatWatch", "medium")
    forgetPlayer(member.id)
    forgetStrikes(member)
    reset()
    __resetChatLog()
    for (let i = 1; i <= 12; i++) __test.emitChat(member, `hello ${i}`)
    await flush()
    const posted = n => told(reader, `hello ${n}`)
    check("the first 10 in 10 seconds post", [1, 5, 10].map(posted), [true, true, true])
    check("the 11th and 12th never reach chat", [posted(11), posted(12)], [false, false])
    check("crossing the line is a strike: first a warning", told(member, "Stop spamming"), true)
    check("a fast typist was told to slow down first", told(member, "typing quickly"), true)
    check("Logs ▸ Chat keeps the dropped lines, marked", recentChat(2).every(e => e.unsent && e.mod.startsWith("dropped as spam")), true)

    // Keep spamming through the ladder: a warning, 1, 5 and 10 minute mutes, then a kick at Medium.
    for (let round = 2; round <= 5; round++) {
        forgetPlayer(member.id)
        unmute(member)
        for (let i = 1; i <= 11; i++) __test.emitChat(member, `spam ${round} ${i}`)
    }
    await flush()
    check("after the longest mute, Medium kicks", recent(20).some(e => e.action === "automod.chat" && e.detail.startsWith("kicked")), true)
    check("and staff hear why", told(boss, "kicked for spamming after the longest mute"), true)
    unmute(member)
    forgetPlayer(member.id)
    forgetStrikes(member)
}

console.log("\n— who is never checked —")
{
    setSetting("automod.chatWatch", "low")
    reset()
    __test.emitChat(boss, "you are an idiot")
    await flush()
    check("staff are never checked", [told(reader, "you are an idiot"), __ui.shown.length], [true, 0])

    startPair(member, reader)
    reset()
    __test.emitChat(member, "you are an idiot")
    await flush()
    check("private chat is left out", __ui.shown.length, 0)
    endPair(member)

    mute(member, 60000, "test", undefined)
    reset()
    __test.emitChat(member, "you are an idiot")
    await flush()
    check("a muted player's line goes nowhere, so it isn't checked", __ui.shown.length, 0)
    unmute(member)
}

console.log("\n— signs: a caught side clears the whole sign —")
{
    /** A sign whose text changes between looks, as in tests/signlog.test.js. */
    function fakeSign(text, at) {
        const block = {
            location: at, dimension: __test.dimension, text,
            getComponent: id => id === "minecraft:sign" ? { getText: () => block.text, setText: t => { block.text = t } } : undefined
        }
        return __test.putBlock(block)
    }
    setSetting("automod.chatWatch", "medium")
    __resetChatLog()
    reset()
    const bad = fakeSign("", { x: 1, y: 64, z: 1 })
    __test.emitPlaceBlock(member, bad)
    bad.text = "you are an idiot"
    __test.runTimers()
    check("the sign is cleared", bad.text, "")
    check("its writer is told, by category", told(member, "Chat Moderation cleared your sign (harassment)"), true)
    check("staff hear where", told(boss, "cleared a sign by Chatty at 1, 64, 1"), true)
    check("Logs ▸ Chat keeps what it said, marked cleared", [recentSigns(1)[0]?.text, recentSigns(1)[0]?.mod?.startsWith("cleared the sign")], ["you are an idiot", true])

    const fine = fakeSign("", { x: 2, y: 64, z: 1 })
    __test.emitPlaceBlock(member, fine)
    fine.text = "welcome to spawn"
    __test.runTimers()
    check("a clean sign stays", fine.text, "welcome to spawn")

    const staffs = fakeSign("", { x: 3, y: 64, z: 1 })
    __test.emitPlaceBlock(boss, staffs)
    staffs.text = "you are an idiot"
    __test.runTimers()
    check("staff signs are never checked", staffs.text, "you are an idiot")

    resetSetting("automod.chatWatch")
    const off = fakeSign("", { x: 4, y: 64, z: 1 })
    __test.emitPlaceBlock(member, off)
    off.text = "you are an idiot"
    __test.runTimers()
    check("Chat Moderation off: signs are left alone", off.text, "you are an idiot")
}

console.log("\n— the old screening stays on hold —")
{
    check("the hold still keeps the old engines shut", CHAT_AUTOMOD_ON_HOLD, true)
    clearHeld()
    reset()
    __test.emitChat(member, "just kys")
    await flush()
    check("so with Chat Moderation off, nothing is held or asked", [heldCount(), __ui.shown.length, told(reader, "just kys")], [0, 0, true])
}

console.log("\n— /automod ▸ Chat Moderation —")
{
    reset()
    await automodHubScreen(boss, () => {})
    const row = lastForm().parts.filter(p => p[0] === "button").map(p => clean(p[1])).find(t => t.startsWith("Chat Moderation"))
    check("the hub's row says it's off", row, "Chat Moderation\noff · Test a message")
    reset()
    await chatModerationScreen(boss, () => {})
    check("its page: Settings, Test a message, Held messages",
        lastForm().parts.filter(p => p[0] === "button").map(p => firstLine(p[1]).replace(/ \(\d+\)$/, "")), ["Settings", "Test a message", "Held messages", "< Back"])
    member.inbox.length = 0
    await chatModerationScreen(member, () => {})
    check("a player who can't change automod can't open it", told(member, "You can't change automod"), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
