import { setting, flag } from "./settings.js"

// Bot detection (3.0.1): the first part of Automod to come back from hold.
// The user, 2026-11-20: "this would fit into automod, as a 'bot detection'
// and as a /automod command ... you can have it flag you, or you can have it
// both flag you and kick (or ban) the person ... No Action, Kick, Ban. and it
// adds them to a possible bot list as well. theres a percentage to these
// things too ... the first semi-introduction to automod".
//
// What gives a bot away (the 2026-11-20 ad bot; Obsidian: Admin+ ▸ Ad bot):
// it JOINS but never ENTERS the world. It sits in the player list, no selector
// can find it (the user's /tp test said "No targets matched selector"), and it
// can still post. So the main signal is a join with no first spawn.
//
// Two things look the same for a while (the user's warning), and neither can
// match: a player still loading in, because nothing is judged before
// `automod.botGrace` seconds; and a dead player on the death screen with
// instant respawn off, who can't be teleported to either but DID spawn
// before, so "never spawned" is false for them.
//
// This file is the thinking and touches no game object; features/bots.js
// listens, keeps the possible-bot list and acts.

/** player id -> what was seen since they joined */
const records = new Map()

/** A web address or a bare domain, the way the ad bots write them. */
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(xyz|com|net|org|gg|io|me|co|link|site|online|club|top|shop|store)\b/i
/** Xbox's made-up gamertags: two capitalised words and up to four digits.
 *  Plenty of real players have one, so it only ever adds a little. */
export const LOOKS_GENERATED = /^[A-Z][a-z]+[A-Z][a-z]+\d{1,4}$/

/** How much each sign adds. The settings page shows this ladder. */
export const SCORE_STEPS = { stuck: 60, longer: 20, chat: 15, link: 10, name: 5 }

export function botsOn() { return flag("automod.bots") }
/** Alerts (3.0.2): whether staff are sent each flagged account. Flagging happens either way. */
export function alertsOn() { return flag("automod.botAlerts") }
export function graceSeconds() {
    const n = Number(setting("automod.botGrace"))
    return Number.isFinite(n) && n >= 30 ? n : 120
}
export function actAt() {
    const n = Number(setting("automod.botActAt"))
    return Number.isFinite(n) ? Math.min(100, Math.max(50, n)) : 80
}
export function botAction() {
    const a = String(setting("automod.botAction") ?? "none")
    return ["none", "kick", "ban"].includes(a) ? a : "none"
}

export function noteJoin(id, name, at = Date.now()) {
    if (!id) return
    records.set(id, { id, name: String(name ?? ""), joinedAt: at, spawnedAt: 0, chats: 0, links: 0 })
}

/** A first spawn: they entered the world, so they can't be the kind of bot this finds. */
export function noteSpawn(id, at = Date.now()) {
    const r = records.get(id)
    if (r && !r.spawnedAt) r.spawnedAt = at
    return r
}

/** Chat from someone who hasn't entered the world yet. */
export function noteChat(id, message) {
    const r = records.get(id)
    if (!r || r.spawnedAt) return
    r.chats++
    if (LINK.test(String(message ?? ""))) r.links++
}

export function noteLeave(id) { records.delete(id) }
export function recordOf(id) { return records.get(id) }
export function joined() { return [...records.values()] }

/**
 * How sure Admin+ is that this is a bot, 0 to 100, and why, in words.
 * Nothing before the wait; then 60 for never entering, +20 once it has been
 * two and a half waits, +15 for chatting without entering, +10 for a link,
 * +5 for a made-up-looking name.
 */
export function scoreOf(r, now = Date.now()) {
    if (!r || r.spawnedAt) return { score: 0, reasons: [] }
    const waited = (now - r.joinedAt) / 1000
    const grace = graceSeconds()
    if (waited < grace) return { score: 0, reasons: [] }
    let score = SCORE_STEPS.stuck
    const reasons = [`hasn't entered the world ${duration(waited)} after joining`]
    if (waited >= grace * 2.5) score += SCORE_STEPS.longer
    if (r.chats) {
        score += SCORE_STEPS.chat
        reasons.push(`chatted ${r.chats === 1 ? "once" : `${r.chats} times`} without entering`)
    }
    if (r.links) { score += SCORE_STEPS.link; reasons.push("posted a link") }
    if (LOOKS_GENERATED.test(r.name)) { score += SCORE_STEPS.name; reasons.push("a name like Xbox's made-up ones") }
    return { score: Math.min(100, score), reasons }
}

function duration(seconds) {
    const m = Math.floor(seconds / 60)
    return m >= 1 ? `${m} min` : `${Math.round(seconds)} s`
}

/** Below the limit it only flags; at the limit, whatever the server chose. */
export function decide(score) {
    if (!(score > 0) || score < actAt()) return "none"
    return botAction()
}

/** Testing seam. */
export function __resetBotcheck() { records.clear() }
