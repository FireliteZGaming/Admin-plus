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
//
// A LIST per invited player, not one slot. Keyed one-per-player, a second
// person asking silently replaced the first: they were told the invite was
// sent, the invited player never saw it, and nobody could tell. That is the
// same fault /tpaccept had, and it is worth not shipping twice.

export function invite(from, to) {
    const toId = idOf(to), fromId = idOf(from)
    if (!toId || !fromId || toId === fromId) return false
    const held = live(toId).filter(i => i.from !== fromId)
    held.unshift({ from: fromId, fromName: from?.name ?? "", at: Date.now() })
    invites.set(toId, held)
    return true
}

/** Unexpired invites for this player, newest first. Prunes as it reads. */
function live(toId) {
    const held = invites.get(toId) ?? []
    const fresh = held.filter(i => Date.now() - i.at <= INVITE_MS)
    if (fresh.length !== held.length) {
        if (fresh.length) invites.set(toId, fresh)
        else invites.delete(toId)
    }
    return fresh
}

export function pendingInvites(toOrId) { return live(idOf(toOrId)) }

/** A live invite to this player from that player, if one is standing. */
export function inviteFrom(toOrId, fromOrId) {
    return live(idOf(toOrId)).find(i => i.from === idOf(fromOrId))
}

/** The newest standing invite, for the common one-at-a-time case. */
export function pendingInvite(toOrId) { return live(idOf(toOrId))[0] }

/** Remove one and hand it back, so the caller can tell whoever sent it. */
export function takeInvite(toOrId, fromOrId) {
    const toId = idOf(toOrId)
    const held = live(toId)
    const found = held.find(i => i.from === idOf(fromOrId))
    if (!found) return undefined
    const rest = held.filter(i => i !== found)
    if (rest.length) invites.set(toId, rest)
    else invites.delete(toId)
    return found
}

/** Drop them all. Returns what went, so each sender can be told. */
export function clearInvites(toOrId) {
    const toId = idOf(toOrId)
    const held = live(toId)
    invites.delete(toId)
    return held
}

export const INVITE_SECONDS = INVITE_MS / 1000

/** Everything about one player, dropped when they leave. */
export function forgetPlayer(playerOrId) {
    const id = idOf(playerOrId)
    const partner = endPair(id)
    replyTo.delete(id)
    invites.delete(id)
    // Invites this player SENT to other people go too, or the other side is
    // left holding an offer from somebody who is not there any more.
    for (const [key, held] of invites.entries()) {
        const rest = held.filter(i => i.from !== id)
        if (rest.length) invites.set(key, rest)
        else invites.delete(key)
    }
    return partner
}
