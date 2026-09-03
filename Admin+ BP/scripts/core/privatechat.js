import { Table } from "./storage.js"

// Private chat: one-off messages, and standing two-person sessions.
//
// Three pieces of state, deliberately with three different lifetimes:
//
//   REPLY TARGET  who /r answers. In memory — it is about the conversation you
//                 are having right now, and surviving a rejoin would mean /r
//                 silently addressing somebody you last spoke to yesterday.
//   SPIES         who reads other people's private messages. PERSISTED: staff
//                 turn it on as a posture, not for one session, and an oversight
//                 tool that quietly switches itself off is worse than none.
//   PAIRS         who is in a /prchat session. In memory — a session is two
//                 people who are both here, and logging off ends it.
//
// Honesty note that belongs next to the code rather than in a README: NOTHING
// here is private from staff holding chat.spy, and nothing is private from the
// content log. "Private" means "not the room", not "unreadable".

const SPY_KEY = "chatSpies"
const spies = new Table(SPY_KEY, {})

/** playerId -> playerId they last heard from. */
const replyTo = new Map()

/** playerId -> playerId they are paired with. Symmetric; both keys are set. */
const pairs = new Map()

/** invitedId -> { from, at } */
const invites = new Map()

const INVITE_MS = 60 * 1000

const idOf = p => typeof p === "string" ? p : p?.id

// ------------------------------------------------------------ reply targeting

export function setReplyTarget(playerOrId, partnerOrId) {
    replyTo.set(idOf(playerOrId), idOf(partnerOrId))
}

export function replyTarget(playerOrId) { return replyTo.get(idOf(playerOrId)) }

export function clearReplyTarget(playerOrId) { replyTo.delete(idOf(playerOrId)) }

/**
 * Both directions at once, which is what makes /r work without thinking.
 * The sender's target is set too, so /r after sending answers the same person.
 */
export function rememberExchange(from, to) {
    setReplyTarget(to, from)
    setReplyTarget(from, to)
}

// -------------------------------------------------------------------- spying

export function isSpying(playerOrId) { return !!spies.get(idOf(playerOrId)) }

export function setSpying(playerOrId, on) {
    const id = idOf(playerOrId)
    if (on) spies.set(id, { at: Date.now() })
    else spies.delete(id)
    return on
}

export function toggleSpying(playerOrId) {
    return setSpying(playerOrId, !isSpying(playerOrId))
}

/** Ids currently spying — the caller filters to who is online and permitted. */
export function spyIds() { return spies.ids() }

// ------------------------------------------------------------------- sessions

/** The id this player is paired with, or undefined. */
export function pairedWith(playerOrId) { return pairs.get(idOf(playerOrId)) }

export function inPair(playerOrId) { return pairs.has(idOf(playerOrId)) }

/** Open a session. Both sides are written, so either can end it. */
export function startPair(a, b) {
    const idA = idOf(a), idB = idOf(b)
    if (!idA || !idB || idA === idB) return false
    endPair(idA)
    endPair(idB)
    pairs.set(idA, idB)
    pairs.set(idB, idA)
    return true
}

/**
 * Close a session from either end.
 * @returns {string|undefined} the partner's id, so the caller can tell them
 */
export function endPair(playerOrId) {
    const id = idOf(playerOrId)
    const partner = pairs.get(id)
    if (!partner) return undefined
    pairs.delete(id)
    pairs.delete(partner)
    return partner
}

// ------------------------------------------------------------------- invites

export function invite(from, to) {
    const toId = idOf(to)
    if (!toId || toId === idOf(from)) return false
    invites.set(toId, { from: idOf(from), at: Date.now() })
    return true
}

/** A live invite to this player from that player, if one is still standing. */
export function inviteFrom(toOrId, fromOrId) {
    const held = invites.get(idOf(toOrId))
    if (!held) return undefined
    if (Date.now() - held.at > INVITE_MS) { invites.delete(idOf(toOrId)); return undefined }
    return held.from === idOf(fromOrId) ? held : undefined
}

/** Whatever invite is standing for this player, live only. */
export function pendingInvite(toOrId) {
    const held = invites.get(idOf(toOrId))
    if (!held) return undefined
    if (Date.now() - held.at > INVITE_MS) { invites.delete(idOf(toOrId)); return undefined }
    return held
}

export function clearInvite(toOrId) { invites.delete(idOf(toOrId)) }

export const INVITE_SECONDS = INVITE_MS / 1000

/** Everything about one player, dropped when they leave. */
export function forgetPlayer(playerOrId) {
    const id = idOf(playerOrId)
    const partner = endPair(id)
    replyTo.delete(id)
    invites.delete(id)
    for (const [key, held] of invites.entries()) {
        if (held.from === id) invites.delete(key)
    }
    return partner
}
