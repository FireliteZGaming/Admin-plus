import { world, system } from "@minecraft/server"
import { flag, overrides, resetSetting } from "../core/settings.js"
import { isStaff } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { mute, kick } from "../core/moderation.js"
import { noteChat as noteRate, flooding, spamStrike, spamLadder, forgetStrikes, forgetPlayer } from "../core/automod.js"
import { wordListCategories } from "../core/chatfilter.js"
import { hold } from "../core/heldchat.js"
import { noteChat as logLine } from "../core/chatlog.js"
import { scoreMessage, verdict, percent } from "../core/toxicity.js"
import { formatDuration } from "../core/util.js"
import {
    CATEGORIES, HELD_CATEGORIES, LEVEL_RULES, noteSwearing, spamAction, caughtFor
} from "../core/chatmod.js"
import { alertStaff, tell } from "./automod.js"
import { loadChatModel, modLevel, askSender, shown, listed } from "./chatcheck.js"

// Chat Moderation (3.1.4), the half that acts: what happens to one line on
// its way to a room, and to a sign. core/chatmod.js is the thinking.
//
// The user's layout, 2026-11-26: one level (Off, Low, Medium, High), "Ask the
// player first", and five switches: Harassment, Hate speech, Sexual content,
// Profanity, Spam. Staff are never checked.
//
// One line, in order:
//   1. Spam: counted. Over the limit, the line is dropped before anyone sees
//      it (the user: "we could technically use a method to get rid of it
//      before it actually sends"), and the crossing earns a strike: a
//      warning, then mutes, then at Medium and High a kick.
//   2. Harassment, Hate speech, Sexual content: the model at the level, or
//      the word list. Caught, the line is asked about (Send or Cancel) or held
//      for staff. Never a punishment: these are guesses, and staff decide.
//   3. Profanity: the word list. The line posts; swearing too much earns a
//      light warning, then a mute, never a kick.
// Everything it does is told to staff and noted in Logs ▸ Chat (the user:
// "these things should also be logged in logs (chat)").

/** Who Chat Moderation is when it writes something down. */
const CHAT_MOD = { id: "automod", name: "Chat Moderation" }

/** playerId -> swearing record (core/chatmod.js noteSwearing). */
const swearing = new Map()

/** A switch's state. */
const isOn = category => flag(category.key)
const SPAM = CATEGORIES.find(c => c.id === "spam")
const PROFANITY = CATEGORIES.find(c => c.id === "profanity")

/** One catch, as staff read it: "harassment 85" or "hate speech (word list: term)". */
export function describeCatch(c) {
    return c.by === "model"
        ? `${c.category.label.toLowerCase()} ${percent(c.score)}`
        : `${c.category.label.toLowerCase()} (word list: ${c.term})`
}

/**
 * What the model and the word list catch in a line at a level, for the
 * switches that are on. The model only counts once it has loaded; until
 * then the word list works alone.
 */
export function catchesIn(text, level) {
    const m = loadChatModel()
    const lists = wordListCategories(text)
    const scores = m?.ready ? scoreMessage(m, text) : undefined
    const atLevel = scores ? verdict(m, scores)[level.id] : []
    return { scores, lists, caught: caughtFor(atLevel, lists, isOn), model: m }
}

/** The content log's line for a moderated line: scores and what happened, never the words. */
function logged(player, scores, model, happened) {
    const scored = scores && model
        ? HELD_CATEGORIES.map(c => `${c.label.toLowerCase()} ${percent(scores[model.outputs.indexOf(c.output)])}`).join(", ")
        : "model not ready"
    console.log(`[Admin+] Chat Moderation: ${player?.name}: ${scored} · ${happened}`)
}

/**
 * Chat Moderation for one line, from chat.js on a system.run tick. `post`
 * sends it to the room (with an optional note for the chat log), `preview`
 * shows the sender their own line as if sent, and `canHold` is false when
 * another mod owns chat (Admin+ can't hold or ask then, only count and tell).
 * @returns "posted", "dropped", "asked", "held" or "flagged"
 */
export function moderateLine(player, message, channel, { post, preview = () => {}, canHold = true }) {
    const level = modLevel()
    if (!level || !player || isStaff(player)) { post(); return "posted" }
    const rules = LEVEL_RULES[level.id]
    const text = String(message ?? "")

    // 1. Spam, counted before anything else, because a flood is a flood
    // whatever it says.
    if (isOn(SPAM)) {
        const rate = noteRate(player)
        let note
        if (rate?.kind === "fast") tell(player, "§7You are typing quickly. §8Slow down a little.")
        if (rate?.kind === "spam") note = punishSpam(player, rate.count, rules)
        if (flooding(player)) {
            if (canHold) {
                logLine(player, text, channel, { mod: note ? `dropped as spam; ${note}` : "dropped as spam", unsent: true })
                logged(player, undefined, undefined, `dropped as spam${note ? `, ${note}` : ""}`)
                return "dropped"
            }
            post(note ? { mod: note } : undefined)
            return "posted"
        }
    }

    // 2. Harassment, Hate speech, Sexual content.
    const { scores, lists, caught, model } = catchesIn(text, level)
    if (caught.length) {
        const why = listed(caught.map(describeCatch))
        if (!canHold) {
            alertStaff(`§7Chat Moderation, ${level.label}: §f${player.name}§7's message was flagged for §f${why}§7: §f"${shown(text)}"`)
            logged(player, scores, model, `flagged at ${level.label}, not held (another mod owns chat)`)
            post({ mod: `flagged for ${why}` })
            return "flagged"
        }
        if (flag("automod.chatAsk")) {
            logged(player, scores, model, `asked at ${level.label}`)
            askSender(player, text, { level, why }, {
                post: note => post({ mod: note }),
                logUnsent: note => logLine(player, text, channel, { mod: note, unsent: true })
            }).catch(e => console.warn(`[Admin+] Ask the player first: ${e}`))
            return "asked"
        }
        // Held for staff, and the sender sees their own line as if it went
        // out: a troll who can't see what was stopped has nothing to work around.
        const first = caught[0]
        hold(player, text, channel?.id, {
            label: first.category.label,
            term: first.by === "model" ? `${first.category.label.toLowerCase()} ${percent(first.score)}` : first.term,
            level: level.label
        })
        preview()
        logLine(player, text, channel, { mod: `held for staff: ${why}`, unsent: true })
        logged(player, scores, model, `held at ${level.label}`)
        alertStaff(`§7Chat Moderation held a message from §f${player.name}§7 for §f${why}§7. See §f/automod ▸ Chat Moderation ▸ Held messages§7.`)
        return "held"
    }

    // 3. Profanity: counted, and the line still posts.
    let note
    if (isOn(PROFANITY) && lists.some(l => l.category === "profanity")) note = noteProfanity(player, rules)
    logged(player, scores, model, note ? `posted, ${note}` : "posted")
    post(note ? { mod: note } : undefined)
    return "posted"
}

/** A swearing line counted; a warning or a mute when it's too much. Returns the log note. */
function noteProfanity(player, rules, now = Date.now()) {
    const { state, action } = noteSwearing(swearing.get(player.id), now, rules)
    swearing.set(player.id, state)
    if (action === "warn") {
        tell(player, `§eEasy on the swearing, please.§7 If it keeps up, you'll be muted for ${rules.swearMute} minutes.`)
        alertStaff(`§f${player.name}§7 was warned for swearing too much.`)
        record(undefined, "automod.chat", player, "warned · swearing too much")
        return "profanity: warned for swearing too much"
    }
    if (action === "mute") {
        const ms = rules.swearMute * 60000
        mute(player, ms, "Swearing too much (Chat Moderation)", undefined)
        tell(player, `§cMuted for ${formatDuration(ms)}§7 for swearing too much. You'll be told when it ends.`)
        alertStaff(`§f${player.name}§7 was muted §f${formatDuration(ms)}§7 for swearing too much.`)
        record(undefined, "automod.chat", player, `muted ${formatDuration(ms)} · swearing too much`)
        return `profanity: muted ${formatDuration(ms)}`
    }
    return undefined
}

/** A spam strike, answered by the level's ladder. Returns the log note. */
function punishSpam(player, count, rules) {
    const strike = spamStrike(player)
    const act = spamAction(strike, spamLadder(), rules)
    if (act.kind === "warn") {
        tell(player, "§eStop spamming.§7 If you keep going, you'll be muted.")
        alertStaff(`§f${player.name}§7 was told to stop spamming §8(${count} in 10s)`)
        record(undefined, "automod.spam", player, `warned · ${count} in 10s`)
        return "spam: warned"
    }
    if (act.kind === "mute") {
        const length = formatDuration(act.seconds * 1000)
        mute(player, act.seconds * 1000, `Spam (Chat Moderation, strike ${strike})`, undefined)
        tell(player, `§cMuted for ${length}§7 for spamming. You'll be told when it ends.`)
        alertStaff(`§f${player.name}§7 was muted §f${length}§7 for spam §8(strike ${strike}, ${count} in 10s)`)
        record(undefined, "automod.spam", player, `muted ${length} · strike ${strike} · ${count} in 10s`)
        return `spam: muted ${length}`
    }
    // Kicked: the levels that kick, once the longest mute didn't stop it.
    alertStaff(`§f${player.name}§7 was kicked for spamming after the longest mute §8(strike ${strike})`)
    record(undefined, "automod.chat", player, `kicked · spam after the longest mute (strike ${strike})`)
    kick({ id: player.id, name: player.name }, "Kicked by Chat Moderation for spamming.")
        .catch(e => console.warn(`[Admin+] Chat Moderation couldn't kick: ${e}`))
    return "spam: kicked"
}

// ------------------------------------------------------------------ signs

/** Does Chat Moderation look at signs right now? */
export function signModerationOn() { return !!modLevel() }

/**
 * Is anything on a sign's sides caught? Signs aren't chat, so there's no
 * asking: a caught sign is cleared, both sides (the user: "if it catches it
 * on a side, it could just completely clear the sign"). Profanity counts here
 * too, by the word list, when its switch is on. Staff are never checked.
 * `why` is for staff (with scores), `labels` for the player (names only).
 * @returns {{side: string, text: string, why: string, labels: string}|undefined}
 */
export function checkSign(player, sides) {
    const level = modLevel()
    if (!level || !player || isStaff(player)) return undefined
    for (const [side, text] of Object.entries(sides)) {
        if (!String(text ?? "").trim()) continue
        const { caught, lists } = catchesIn(text, level)
        const swear = isOn(PROFANITY) ? lists.find(l => l.category === "profanity") : undefined
        if (caught.length || swear) {
            const why = caught.length ? listed(caught.map(describeCatch)) : `profanity (word list: ${swear.term})`
            const labels = caught.length ? listed(caught.map(c => c.category.label.toLowerCase())) : "profanity"
            return { side, text, why, labels }
        }
    }
    return undefined
}

// ---------------------------------------------------------------- install

/**
 * 3.1.3's `automod.chatAction` ("tell" or "ask") is gone: "tell staff only"
 * held nothing, and Chat Moderation always acts on what it catches. Asking
 * is the default, the gentler of its two ways, so the old key is just
 * cleared, once, a moment after the world opens (settings can't be read
 * during early execution).
 */
function clearOldAction() {
    if (overrides()["automod.chatAction"] !== undefined) resetSetting("automod.chatAction")
}

export function installChatModeration() {
    system.runTimeout(() => {
        try { clearOldAction() } catch (e) { console.warn(`[Admin+] Chat Moderation: ${e}`) }
    }, 40)
    world.afterEvents?.playerLeave?.subscribe?.(({ playerId }) => {
        swearing.delete(playerId)
        // Spam is session state, as it was for the old flood check.
        forgetPlayer(playerId)
        forgetStrikes(playerId)
    })
    return true
}

/** Tests only. */
export function __forgetSwearing() { swearing.clear() }
