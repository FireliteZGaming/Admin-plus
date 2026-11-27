import { system } from "@minecraft/server"
import { TOX_MODEL } from "../core/toxmodel.js"
import {
    prepareModel, loadJob, scoreMessage, percent, verdict, lineFor, pushes, pushTries, LEVELS
} from "../core/toxicity.js"
import { wordListCategories } from "../core/chatfilter.js"
import { setting, setSetting, resetSetting, overrides, flag } from "../core/settings.js"
import { fieldFor, applyField } from "../core/settingFields.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { menu, modal, INCOMPLETE } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { guardIcon, chatIcon } from "../core/look.js"
import { ok, info, err } from "../core/util.js"
import { heldWaiting, heldScreen } from "./heldUI.js"
import { CATEGORIES, HELD_CATEGORIES, caughtFor, categoryOfOutput } from "../core/chatmod.js"
import { alertStaff, tell } from "./automod.js"

// /automod ▸ Chat Moderation: its screens, the chat model, and the "ask the
// player first" box. features/chatmod.js does the moderating.
//
// 3.1.0 to 3.1.3 were the test of the chat model (Test a message, Watch
// chat). 3.1.4 is the user's layout, 2026-11-26: "Chat Moderation", with "the
// simple Low Medium High", a switch for confirming with the player first, and
// the categories below, "common categories but not too many", plus Spam.
// Staff are never checked; Test a message lets them try a line.
//
// The weights decode lazily, a slice at a time in a job, the first time
// something needs them: opening Chat Moderation, or a level being set when
// the world opens. A server that never uses this pays only for the module.

/** Base64 characters decoded per step, a multiple of 4: 27 steps for a 65,536 x 5 model. */
const SLICE = 16384

/**
 * What Chat Moderation's settings page edits: each setting's home
 * (tests/settingspages). The level keeps Watch chat's key; Spam is the old
 * chat flooding switch, `automod.spam`.
 */
export const CHAT_FIELDS = [
    { key: "automod.chatWatch", kind: "dropdown", label: "Level" },
    { key: "automod.chatAsk", kind: "toggle", label: "Ask the player first" },
    ...CATEGORIES.map(c => ({ key: c.key, kind: "toggle", label: c.label, detail: c.detail }))
]

/** The box's words, the user's own (2026-11-26). */
export const ASK_TEXT = "Are you sure you want to send this message? It was flagged by our Automod system."

/** Test a message explains a score from here up (0 to 100). */
const WHY_FROM = 20

/**
 * A line as staff should read it here: colour codes out. The model reads it
 * that way too (core/toxfeatures.js, features v2), and a "§k" or "§l" left
 * in would scramble or embolden the rest of the screen until a "§r".
 */
export const shown = text => String(text ?? "").replace(/§./gu, "")

/** "a", "a and b", "a, b and c". */
export function listed(items) {
    if (items.length < 2) return items[0] ?? ""
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

// ------------------------------------------------------------- the model

let model
let started = false
let steps = 0
let loadError = ""
const TOTAL_STEPS = Math.max(1, Math.ceil(String(TOX_MODEL?.data ?? "").length / SLICE))

/**
 * Start decoding the weights, unless that has started already. Returns the
 * model, which may not be ready yet; modelState() says how far it got.
 */
export function loadChatModel() {
    if (started) return model
    started = true
    try {
        model = prepareModel(TOX_MODEL)
    } catch (e) {
        loadError = String(e?.message ?? e)
        console.warn(`[Admin+] Chat model couldn't load: ${loadError}`)
        return undefined
    }
    const began = Date.now()
    const job = (function* () {
        try {
            for (const _ of loadJob(model, SLICE)) { steps++; yield }
            console.log(`[Admin+] Chat model ${TOX_MODEL.name} ready in ${Date.now() - began} ms (${steps} steps)`)
        } catch (e) {
            loadError = String(e?.message ?? e)
            console.warn(`[Admin+] Chat model couldn't load: ${loadError}`)
        }
    })()
    if (typeof system.runJob === "function") system.runJob(job)
    else {
        // A runtime without jobs: one step a tick instead.
        const id = system.runInterval(() => { if (job.next().done) system.clearRun(id) }, 1)
    }
    return model
}

/** How far the model got: { ready, percent, error }. */
export function modelState() {
    if (loadError) return { ready: false, percent: 0, error: loadError }
    if (model?.ready) return { ready: true, percent: 100, error: "" }
    return { ready: false, percent: started ? Math.min(99, Math.floor((100 * steps) / TOTAL_STEPS)) : 0, error: "" }
}

/** Chat Moderation's level from LEVELS, or undefined when it is off. */
export function modLevel() {
    const id = String(setting("automod.chatWatch") ?? "").trim().toLowerCase()
    return LEVELS.find(level => level.id === id)
}

/**
 * A level set when the world opens: load the model a moment later, so the
 * first lines are read by it. Settings can't be read during early execution.
 */
export function installChatCheck() {
    system.runTimeout(() => {
        try { if (modLevel()) loadChatModel() } catch (e) { console.warn(`[Admin+] Chat model: ${e}`) }
    }, 40)
    return true
}

// --------------------------------------------------- ask the player first
//
// 3.1.3, the user: "we can also implement the 'Are you sure you want to send
// this message? It was flagged by our Automod system.' message, with a send
// and cancel button". A nudge, never a punishment.

/** Players with a box open, so each answers one flagged line at a time. */
const asking = new Set()

/**
 * Ask the player about a flagged line. `post(note)` sends it as if just said;
 * `logUnsent(note)` notes a line that never went out in Logs ▸ Chat. Send
 * posts it; Cancel or closing the box drops it. If chat stays open so long
 * the box can't show (10 seconds), it isn't sent and they're told. Staff hear
 * the outcome with the line.
 * @returns "sent", "cancelled", "closed", "missed" or "waiting"
 */
export async function askSender(player, message, { level, why }, { post, logUnsent }) {
    const id = player?.id
    if (asking.has(id)) {
        tell(player, "§7Your message wasn't sent: Automod is still asking about your last one.")
        logUnsent?.("not sent: still asking about the last one")
        return "waiting"
    }
    asking.add(id)
    let outcome = "closed"
    try {
        await menu(player, {
            title: "§6Automod",
            body: `${ASK_TEXT}\n\n§f"${shown(message)}"`,
            buttons: [
                { text: "Send", run: () => { outcome = "sent"; post(`asked first (${why}), sent anyway`) } },
                { text: "Cancel", run: () => { outcome = "cancelled" } }
            ],
            waitWhileBusy: 200,
            onCancel: reason => { outcome = reason === "UserBusy" ? "missed" : "closed" }
        })
    } catch (e) {
        console.warn(`[Admin+] Ask the player first: ${e}`)
        outcome = "closed"
    } finally {
        asking.delete(id)
    }
    const said = {
        sent: "sent it anyway",
        cancelled: "cancelled it",
        closed: "closed the box, so it wasn't sent",
        missed: "couldn't be asked (their chat stayed open), so it wasn't sent"
    }[outcome]
    console.log(`[Admin+] Chat Moderation: ${player?.name}: asked at ${level.label}: ${outcome}`)
    if (outcome !== "sent") logUnsent?.(`asked first (${why}), ${said}`)
    alertStaff(`§7Chat Moderation, ${level.label}: §f${player?.name}§7 was asked about a message flagged for §f${why}§7, and ${said}: §f"${shown(message)}"`)
    if (outcome === "cancelled" || outcome === "closed") tell(player, "§7Your message wasn't sent.")
    if (outcome === "missed") tell(player, "§7Automod flagged your message and couldn't ask you about it while chat was open, so it wasn't sent.")
    return outcome
}

// ---------------------------------------------------------------- screens

const LEVEL_CHOICES = [{ id: "off", label: "Off" }, ...LEVELS]

/** The hub's line under Chat Moderation. */
export function chatSummary() {
    const level = modLevel()
    if (!level) return "§coff§8 · Test a message"
    const on = CATEGORIES.filter(c => flag(c.key)).length
    return `§a${level.label}§8 · ${flag("automod.chatAsk") ? "asks first" : "holds for staff"} · ${on} of ${CATEGORIES.length} on`
}

function modelLine() {
    const state = modelState()
    if (state.error) return `§cThe chat model couldn't load: ${state.error}`
    if (!state.ready) return `§7The chat model is loading: ${state.percent}%.`
    return "§7Its levels were set on public data and Admin+'s own game-chat examples, not on your server's chat, so treat them as a first guess."
}

/**
 * What Chat Moderation's banner says (3.1.9): its level and what it does with
 * a flagged line, then what it catches and what is waiting. Three short
 * lines, the first short enough to clear the pill. The same words are the
 * body in the game's own menus.
 */
export function chatStatus() {
    const level = modLevel()
    if (!level) return ["§f§lChat Moderation§r", "§7Off. Pick a level in Settings.", "§7Test a message works either way."].join("\n")
    const on = CATEGORIES.filter(c => flag(c.key)).length
    return [
        "§f§lChat Moderation§r",
        `§7Level §f${level.label}§7, ${flag("automod.chatAsk") ? "asks the player first" : "holds for staff"}`,
        `§7Catches §f${on}§7 of §f${CATEGORIES.length}§7 · §f${heldWaiting()}§7 held`
    ].join("\n")
}

/**
 * /automod ▸ Chat Moderation: Settings, Test a message, Held messages. Since
 * 3.1.9 it has its own frame in Admin+'s menus (core/look.js CHATMOD): the
 * bubble and the status in a banner, lit while a level is set, and the three
 * pages as cards in a row.
 */
export async function chatModerationScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    loadChatModel()
    const again = () => chatModerationScreen(player, back)
    const waiting = heldWaiting()
    return menu(player, {
        title: hubTitle("settings", "Chat Moderation"),
        body: chatStatus(),
        layout: "chat",
        watching: !!modLevel(),
        buttons: [
            {
                text: hubEntry("settings", "Settings", chatSummary()),
                card: { text: "§f§lSettings§r\n§7Level and what it catches", icon: guardIcon("moderation") },
                run: () => chatSettingsScreen(player, again)
            },
            {
                text: hubEntry("settings", "Test a message", "See what each level would do with a line"),
                card: { text: "§f§lTest a message§r\n§7Try any line", icon: chatIcon("test") },
                run: () => testScreen(player, again)
            },
            {
                text: hubEntry("settings", `Held messages (${waiting})`, waiting ? "Allow or delete what was held for staff" : "None waiting"),
                card: { text: `§f§lHeld messages§r\n${waiting ? `§f${waiting}§7 waiting` : "§7None waiting"}`, icon: chatIcon("held") },
                run: () => heldScreen(player, again)
            }
        ],
        back
    })
}

/** Chat Moderation ▸ Settings: the level, Ask the player first, the five switches. */
export async function chatSettingsScreen(player, back) {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    loadChatModel()
    const current = modLevel()?.id ?? "off"
    const at = Math.max(0, LEVEL_CHOICES.findIndex(choice => choice.id === current))
    const askField = CHAT_FIELDS.find(f => f.key === "automod.chatAsk")
    const switches = CHAT_FIELDS.filter(f => f.kind === "toggle" && f.key !== "automod.chatAsk")
    // 3.1.9: one short line on top, each level explained under the Level
    // list where it's picked, and the model's note last, out of the way.
    const values = await modal(player, hubTitle("settings", "Chat Moderation"), [
        { type: "label", label: "§7Pick how strict it is, then what it catches. Staff are never checked." },
        { id: "level", type: "dropdown", label: "Level\n§8Low: only clear cases, and it never kicks. Medium: also clear insults, and it kicks only for spam. High: anything likely toxic, with quicker warnings and longer mutes.", options: LEVEL_CHOICES.map(c => c.label), default: at },
        fieldFor(askField, `Ask the player first\n§8"${ASK_TEXT}" with Send and Cancel. Off: a flagged message is held for staff instead.`),
        { type: "divider" },
        { type: "label", label: "§lWhat it catches§r" },
        ...switches.map(f => fieldFor(f, `${f.label}\n§8${f.detail}`)),
        { type: "divider" },
        { type: "label", label: modelLine() }
    ], { strict: true, submit: "Save" })
    if (!values) return back?.()
    if (values === INCOMPLETE) {
        err(player, "Not every setting came back from the game, so nothing was saved. Try again.")
        return back?.()
    }

    const previous = overrides()
    const changed = []
    const picked = LEVEL_CHOICES[values.level]
    if (picked && picked.id !== current) {
        if (picked.id === "off") resetSetting("automod.chatWatch")
        else setSetting("automod.chatWatch", picked.id)
        changed.push(`level ${picked.label.toLowerCase()}`)
        if (picked.id !== "off") loadChatModel()
    }
    for (const field of [askField, ...switches]) {
        const answer = applyField(field, values[field.key], field.label)
        if (answer.words) changed.push(answer.words.replace(/§./g, ""))
    }
    if (!changed.length) { info(player, "§7Nothing changed."); return back?.() }
    record(player, "automod.config", undefined, `Chat Moderation: ${changed.join(", ")}`, { kind: "config", overrides: previous })
    const level = modLevel()
    ok(player, level
        ? `Chat Moderation: §f${level.label}§a, ${flag("automod.chatAsk") ? "asking the player first" : "holding for staff"}.`
        : "Chat Moderation is off.")
    return back?.()
}

/** Chat Moderation ▸ Test a message. `line` is kept in the box while the model loads. */
export async function testScreen(player, back, line = "") {
    if (!has(player, "admin.automod")) { err(player, "You can't change automod."); return back?.() }
    loadChatModel()
    const values = await modal(player, hubTitle("settings", "Test a message"), [
        { type: "label", label: `§7Type a line and press Test to see what each level would do with it. It isn't sent to chat.\n${modelLine()}` },
        { id: "test", type: "text", label: "Message", placeholder: "Example: gg, well played", default: line }
    ], { strict: true, submit: "Test" })
    if (!values || values === INCOMPLETE) return back?.()
    const text = String(values.test ?? "").trim()
    if (!text) { info(player, "§7Type a line to test."); return back?.() }
    const state = modelState()
    if (state.error) { err(player, `The chat model couldn't load, so nothing was tested: ${state.error}`); return back?.() }
    if (!state.ready) {
        info(player, `§7The chat model is still loading (${state.percent}%). Your line is still in the box: press Test again in a moment.`)
        return testScreen(player, back, text)
    }
    return testResultScreen(player, text, () => testScreen(player, back), back)
}

/** "harassment 85 (caught from 57)" or "hate speech (word list: term)". */
function caughtWords(c) {
    return c.by === "model"
        ? `${c.category.label.toLowerCase()} §f${percent(c.score)}§7 (caught from ${percent(c.line)})`
        : `${c.category.label.toLowerCase()} (word list: §f${c.term}§7)`
}

/**
 * What Test a message says about a line: each level's answer and why, the
 * three scores, Profanity, the word behind the score that matters, and the
 * word list's answer. Switched-off categories never count. The model must be
 * ready.
 */
export function testReport(text) {
    const m = loadChatModel()
    const began = Date.now()
    const scores = scoreMessage(m, text)
    const v = verdict(m, scores)
    const lists = wordListCategories(text)
    const on = c => flag(c.key)
    const doing = flag("automod.chatAsk") ? "would ask the player first" : "would hold it for staff"
    const scoreOf = c => scores[m.outputs.indexOf(c.output)]
    const lines = [`§f"${shown(text)}"`, "", "§lWhat each level would do§r"]
    for (const level of LEVELS) {
        const caught = caughtFor(v[level.id], lists, on)
        if (caught.length) {
            lines.push(`§7${level.label}: §c${doing}§7, for ${listed(caught.map(caughtWords))}.`)
            continue
        }
        // Why not: the switched-on category nearest its line here.
        const near = HELD_CATEGORIES.filter(on)
            .map(c => ({ c, score: scoreOf(c), line: lineFor(m, c.output, level.id) }))
            .filter(r => r.line !== undefined)
            .sort((a, b) => (a.line - a.score) - (b.line - b.score))[0]
        lines.push(near
            ? `§7${level.label}: §alets it through§7. Closest: ${near.c.label.toLowerCase()} §f${percent(near.score)}§7, caught from ${percent(near.line)}.`
            : `§7${level.label}: §alets it through§7.`)
    }
    const off = HELD_CATEGORIES.filter(c => !on(c))
    if (off.length) lines.push(`§8Switched off, so never caught: ${off.map(c => c.label).join(", ")}.`)

    lines.push("", "§lScores§r §8(0 to 100)")
    lines.push(HELD_CATEGORIES.map(c => `§7${c.label} §f${percent(scoreOf(c))}`).join("§8 · "))
    const swear = lists.find(l => l.category === "profanity")
    lines.push(swear
        ? `§7Profanity: swearing (§f${swear.term}§7). It still sends, and too much earns a warning, then a mute.`
        : "§7Profanity: no swear words.")

    // Why: the words behind the score that matters most here, the top catch
    // at High, or else the top switched-on score.
    const best = v.high.map(h => ({ c: categoryOfOutput(h.name), score: h.score })).find(r => r.c && on(r.c))
        ?? HELD_CATEGORIES.filter(on).map(c => ({ c, score: scoreOf(c) })).sort((a, b) => b.score - a.score)[0]
    const focus = best && percent(best.score) >= WHY_FROM ? best : undefined
    const top = focus ? pushes(m, text, focus.c.output, 2) : []
    // One scoring for the line, then pushes(): the whole line again and once
    // without each word it tries (pushTries: capped so this stays near 50 ms).
    const scorings = 1 + (focus ? 1 + pushTries(text) : 0)
    lines.push("", "§lWhy§r")
    if (top.length) {
        const without = top.map(t => `to §f${percent(t.without)}§7 without §f"${shown(t.word)}"`)
        lines.push(`§7${focus.c.label} §f${percent(focus.score)}§7 falls ${listed(without)}§7.`)
    } else if (focus) {
        lines.push(`§7No single word pushes ${focus.c.label.toLowerCase()} (§f${percent(focus.score)}§7) up.`)
    } else {
        lines.push(`§7Nothing switched on scores ${WHY_FROM} or more, so there's nothing to explain.`)
    }

    const listedHeld = lists.filter(l => l.category !== "profanity")
    lines.push("", "§lThe word list§r")
    lines.push(listedHeld.length
        ? `§7Catches it for ${listed(listedHeld.map(l => `${HELD_CATEGORIES.find(c => c.list === l.category)?.label.toLowerCase() ?? l.label.toLowerCase()} (§f${l.term}§7)`))}.`
        : "§7Catches nothing here.")
    // A real speed number from Bedrock: how long this many scorings took.
    // No words go in the log.
    console.log(`[Admin+] Test a message: ${scorings} scorings in ${Date.now() - began} ms`)
    return lines.join("\n")
}

/** The answer to Test a message, with Test another and Back. */
export async function testResultScreen(player, text, again, back) {
    return menu(player, {
        title: hubTitle("settings", "Test a message"),
        body: testReport(text),
        buttons: [{ text: hubEntry("settings", "Test another", "Try a different line"), run: again }],
        back
    })
}
