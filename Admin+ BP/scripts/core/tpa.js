import { world } from "@minecraft/server"
import { setting } from "./settings.js"
import { tpaClosed } from "./moderation.js"
import { has } from "./ranks.js"

// Teleport requests.
//
// Deliberately NOT persisted: a request is a live conversation between two
// people who are both online. Surviving a restart would mean accepting a
// teleport to someone who logged off an hour ago.
//
//   "to"    the sender goes to the target   (/tpa)
//   "here"  the target comes to the sender  (/tpahere)

/** @type {Map<string, {from: string, fromName: string, to: string, toName: string, kind: "to"|"here", at: number}>} */
const outgoing = new Map()   // one live request per sender

// Ordering by Date.now() alone ties when two requests land in the same
// millisecond, and "newest" then depends on insertion order — so /tpaccept
// could take the wrong one. A counter is monotonic regardless of clock
// resolution.
let sequence = 0

function expirySeconds() {
    const value = Number(setting("tpa.expire"))
    return Number.isFinite(value) && value > 0 ? value : 60
}

function expired(request) {
    return Date.now() - request.at > expirySeconds() * 1000
}

/**
 * Drop anything that has expired. Called before every read.
 *
 * Expired requests are kept aside for takeLapsed() rather than thrown away, so
 * both people can be told (2.12.13). Before, a request just vanished: the
 * sender kept waiting and the player asked never learnt it was gone.
 */
function prune() {
    for (const [id, request] of outgoing) {
        if (expired(request)) {
            outgoing.delete(id)
            if (lapsed.length < 100) lapsed.push(request)
        }
    }
}

const lapsed = []

/** Requests that expired since the last call, oldest first. */
export function takeLapsed() {
    prune()
    return lapsed.splice(0)
}

// ------------------------------------------------------------- asking again
//
// Requests pop up on screen since 2.12.13, and a pop-up anybody can trigger as
// often as they like is a way to pester somebody. So asking the same player
// again waits ASK_AGAIN_S, and REFUSED_S after they said no. Kept apart from
// createRequest() so the request store stays a plain store.

export const ASK_AGAIN_S = 10
export const REFUSED_S = 30

/** "fromId>toId" -> { at, refused } */
const asked = new Map()

/** Seconds before `from` may ask `to` again, or 0. */
export function askWait(from, to) {
    const note = asked.get(`${from.id}>${to.id}`)
    if (!note) return 0
    const left = (note.refused ? REFUSED_S : ASK_AGAIN_S) * 1000 - (Date.now() - note.at)
    return left > 0 ? Math.ceil(left / 1000) : 0
}

export function noteAsked(from, to) {
    asked.set(`${from.id}>${to.id}`, { at: Date.now(), refused: false })
}

export function noteRefused(fromId, toId) {
    asked.set(`${fromId}>${toId}`, { at: Date.now(), refused: true })
}

export function outgoingFrom(player) {
    prune()
    return outgoing.get(player.id)
}

/** Every live request aimed at this player, newest first. */
export function incomingFor(player) {
    prune()
    return [...outgoing.values()]
        .filter(r => r.to === player.id)
        .sort((a, b) => b.seq - a.seq)
}

/**
 * @returns {{ok: true, request: object} | {ok: false, reason: string}}
 */
export function createRequest(from, to, kind) {
    if (from.id === to.id) return { ok: false, reason: "You're already there." }
    if (!has(to, "tpa.use")) return { ok: false, reason: `${to.name} can't use teleport requests.` }
    if (tpaClosed(to)) return { ok: false, reason: `${to.name} isn't accepting teleport requests.` }

    const existing = outgoingFrom(from)
    const replacing = existing?.to === to.id ? false : !!existing

    const request = {
        from: from.id, fromName: from.name,
        to: to.id, toName: to.name,
        kind, at: Date.now(), seq: ++sequence
    }
    outgoing.set(from.id, request)
    return { ok: true, request, replaced: replacing }
}

export function cancelRequest(player) {
    prune()
    const request = outgoing.get(player.id)
    if (!request) return undefined
    outgoing.delete(player.id)
    return request
}

/** Take the request from a named sender, or the newest one if unnamed. */
export function takeIncoming(player, senderName) {
    const list = incomingFor(player)
    if (!list.length) return undefined
    const match = senderName
        ? list.find(r => r.fromName.toLowerCase() === String(senderName).toLowerCase())
            ?? list.find(r => r.fromName.toLowerCase().includes(String(senderName).toLowerCase()))
        : list[0]
    if (!match) return undefined
    outgoing.delete(match.from)
    return match
}

export function playerById(id) {
    return world.getAllPlayers().find(p => p.id === id)
}

/** Seconds left before a request lapses, for the messages. */
export function secondsLeft(request) {
    const left = expirySeconds() * 1000 - (Date.now() - request.at)
    return Math.max(0, Math.ceil(left / 1000))
}

/**
 * Take a specific request by the sender's id.
 *
 * takeIncoming() matches on a NAME, which is what a typed argument gives you.
 * A picker already knows exactly which request was chosen, and going back
 * through the name would reintroduce the ambiguity the picker just resolved —
 * two players whose names differ only by case, or one containing the other.
 */
export function takeIncomingById(player, fromId) {
    const match = incomingFor(player).find(r => r.from === fromId)
    if (!match) return undefined
    outgoing.delete(match.from)
    return match
}

/** Clear every request aimed at this player. Returns how many went. */
export function clearIncoming(player) {
    const list = incomingFor(player)
    for (const request of list) outgoing.delete(request.from)
    return list
}
