import { Table } from "./storage.js"
import { setting } from "./settings.js"

// Messages the filter withheld, waiting on a moderator.
//
// Held, not deleted, and not punished — see core/chatfilter.js for why that is
// the whole point of the design rather than a softer version of it.
//
// The queue is world storage rather than memory on purpose: a message held
// thirty seconds before the host closed the world is exactly the one somebody
// wanted to read, and losing it on reload would make the queue untrustworthy
// for the only case it exists to serve.

const store = new Table("heldChat", {})

let sequence = 0

function all() {
    const held = store.get("entries")
    return Array.isArray(held) ? held : []
}

function cap() {
    const n = Math.floor(Number(setting("filter.holdCap")))
    return Number.isFinite(n) && n > 0 ? n : 50
}

/**
 * Put a message in the queue.
 *
 * The CHANNEL is kept because approving has to put the message back where it
 * was going — releasing a Staff line into General would be a worse accident
 * than holding it was.
 */
export function hold(player, message, channelId, flagged) {
    const entry = {
        id: `h${Date.now().toString(36)}${(++sequence).toString(36)}`,
        at: Date.now(),
        player: { id: player?.id, name: player?.name ?? "?" },
        message: String(message ?? ""),
        channel: channelId,
        category: flagged?.category,
        label: flagged?.label,
        term: flagged?.term,
        level: flagged?.level
    }
    // Newest first, oldest dropped — a realm that never reads the queue must
    // not grow it without bound.
    store.set("entries", [entry, ...all()].slice(0, cap()))
    return entry
}

/** Everything waiting, newest first. */
export function heldMessages() { return all() }

export function heldCount() { return all().length }

export function getHeld(id) { return all().find(e => e.id === id) }

/** Take one out of the queue, whatever is about to happen to it. */
export function removeHeld(id) {
    const before = all()
    const after = before.filter(e => e.id !== id)
    if (after.length === before.length) return undefined
    store.set("entries", after)
    return before.find(e => e.id === id)
}

/** Empty it. Used by Deny All and by the tests. */
export function clearHeld() {
    const n = all().length
    store.set("entries", [])
    return n
}
