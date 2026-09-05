import { Table } from "./storage.js"
import { heldRankIds, revokeRank, getRank } from "./ranks.js"

// Timed rank grants — a rank that gives itself back.
//
// Ranks already existed; expiry did not, so "Mod for the weekend" meant somebody
// had to remember. This is the record that remembers instead: when the grant was
// made, who made it, and when it ends.
//
// WHY A TABLE OF ITS OWN rather than a field on the holder record. `setRanks`
// rewrites a holder's record wholesale — name, ranks, since — and every rank
// screen goes through it. An expiry living in that object would be erased by any
// ordinary edit, silently, and the rank would quietly become permanent. Keeping
// it beside means nothing in the rank code can clobber it by accident.
//
// The trade is that the two can disagree: a grant record can outlive the rank it
// describes. That direction is safe and is swept up (see `sweep`), because a
// stale expiry pointing at a rank nobody holds does nothing at all.

const grants = new Table("grants", {})

/**
 * What the dropdown offers.
 *
 * A fixed list rather than a number box, because "how long" is a decision with
 * about eight sensible answers and typing 259200 is not one of them. Permanent
 * is FIRST and is the zero, so the default answer is the one that changes
 * nothing about how ranks already work.
 */
export const DURATIONS = [
    { id: "permanent", label: "Permanent", ms: 0 },
    { id: "1h",  label: "1 hour",   ms: 60 * 60 * 1000 },
    { id: "6h",  label: "6 hours",  ms: 6 * 60 * 60 * 1000 },
    { id: "12h", label: "12 hours", ms: 12 * 60 * 60 * 1000 },
    { id: "1d",  label: "1 day",    ms: 24 * 60 * 60 * 1000 },
    { id: "3d",  label: "3 days",   ms: 3 * 24 * 60 * 60 * 1000 },
    { id: "7d",  label: "7 days",   ms: 7 * 24 * 60 * 60 * 1000 },
    { id: "14d", label: "14 days",  ms: 14 * 24 * 60 * 60 * 1000 },
    { id: "30d", label: "30 days",  ms: 30 * 24 * 60 * 60 * 1000 }
]

export function durationAt(index) {
    return DURATIONS[index] ?? DURATIONS[0]
}

function recordFor(playerId) {
    return grants.get(playerId) ?? {}
}

/**
 * Record that a rank should end.
 *
 * `ms` of 0 means permanent, and permanent is stored as the ABSENCE of a
 * record rather than as a flag — so re-granting a timed rank permanently really
 * does clear the clock instead of leaving one behind to fire later.
 */
export function setExpiry(playerId, rankId, ms, by) {
    if (!playerId || !rankId) return false
    const held = recordFor(playerId)
    if (!ms || ms <= 0) {
        if (!(rankId in held)) return true
        delete held[rankId]
    } else {
        held[rankId] = {
            until: Date.now() + ms,
            at: Date.now(),
            by: by?.id ?? "",
            byName: by?.name ?? ""
        }
    }
    if (Object.keys(held).length) grants.set(playerId, held)
    else grants.delete(playerId)
    return true
}

export function clearExpiry(playerId, rankId) {
    return setExpiry(playerId, rankId, 0)
}

/** When this rank ends, or undefined if it does not. */
export function expiryOf(playerId, rankId) {
    return recordFor(playerId)[rankId]?.until
}

/** Every timed rank this player holds, soonest first. */
export function timedGrants(playerId) {
    return Object.entries(recordFor(playerId))
        .map(([rankId, info]) => ({ rankId, ...info }))
        .sort((a, b) => a.until - b.until)
}

/**
 * Take back everything whose time is up, and tidy records that no longer
 * describe anything.
 *
 * Deliberately does its own revoking rather than trusting a caller to: an
 * expiry that is recorded but never acted on is worse than no expiry at all,
 * because the panel would show a countdown that means nothing.
 *
 * @returns {{playerId: string, rankId: string, display: string}[]} what ended
 */
export function sweep(now = Date.now()) {
    const ended = []
    for (const [playerId, held] of grants.entries()) {
        const remaining = {}
        for (const [rankId, info] of Object.entries(held ?? {})) {
            // A record for a rank they no longer hold is stale — somebody
            // revoked it by hand. Drop it quietly; there is nothing to take.
            if (!heldRankIds(playerId).includes(rankId)) continue
            if (info?.until && info.until <= now) {
                revokeRank(playerId, rankId)
                ended.push({ playerId, rankId, display: getRank(rankId)?.display ?? rankId })
                continue
            }
            remaining[rankId] = info
        }
        if (Object.keys(remaining).length) grants.set(playerId, remaining)
        else grants.delete(playerId)
    }
    return ended
}

/** "2 days", "4 hours", "9 minutes" — the largest honest unit. */
export function remainingLabel(until, now = Date.now()) {
    const ms = Math.max(0, (until ?? 0) - now)
    if (!ms) return "expired"
    // Pluralise off the number actually shown, not the one measured — under a
    // minute rounds up to 1 and has to read "1 minute", not "1 minutes".
    const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return plural(Math.max(1, minutes), "minute")
    const hours = Math.floor(minutes / 60)
    if (hours < 48) return plural(hours, "hour")
    return plural(Math.floor(hours / 24), "day")
}

/** Testing seam: forget everything, without touching ranks. */
export function __resetGrants() {
    for (const [id] of grants.entries()) grants.delete(id)
}
