import { Table, cleanId } from "./storage.js"
import { valueFor } from "./ranks.js"
import { flag } from "./settings.js"

// Homes: a player's own named places.
//
// **Dropped on purpose in 1.x, asked for back on 2026-09-19.** It is recorded
// here rather than only in a changelog because CLAUDE.md still lists homes
// among the things not to build unasked, and the difference between "missing"
// and "removed" is the whole reason that list exists. This is the second entry
// to come off it, after `bring`.
//
// A warp is the server's; a home is yours. That difference decides everything
// below: homes are stored per player, never listed to anybody else, and the
// limit is a rank value rather than a config number, because "how many homes"
// is exactly the kind of thing a server wants to hand out by rank.
//
// ONE TABLE, keyed by player id, holding a small array each. The alternative —
// a table per player — would mean a dynamic property per player, and Bedrock
// counts those against a budget that bans and warnings already draw on.

const HOMES_KEY = "homes"

const homes = new Table(HOMES_KEY, {})

/**
 * @typedef {{
 *   id: string, display: string,
 *   x: number, y: number, z: number, dimension: string,
 *   created: number
 * }} Home
 */

/** Everything this player has set, oldest first. */
export function homesOf(playerId) {
    const mine = homes.get(String(playerId ?? ""))
    return Array.isArray(mine) ? mine : []
}

export function normaliseHomeId(raw) {
    return cleanId(raw).toLowerCase().replace(/\s+/g, "_").slice(0, 24)
}

/** One home by name, or undefined. Case-insensitive, because people type fast. */
export function getHome(playerId, id) {
    const want = normaliseHomeId(id)
    return homesOf(playerId).find(h => h.id === want)
}

/** How many this player's rank allows. */
export function homeLimit(player) {
    return Number(valueFor(player, "home.limit") ?? 0)
}

/**
 * Set or move a home.
 *
 * Returns `{ok, home, reason}`. **Overwriting an existing name does not count
 * against the limit**, which is what makes "/sethome base" usable as "move my
 * base here" — the commonest thing anybody does with this after the first day.
 */
export function setHome(player, id, at = player?.location) {
    if (!flag("feature.homes")) return { ok: false, reason: "Homes are turned off on this server." }
    const homeId = normaliseHomeId(id || "home")
    if (!homeId) return { ok: false, reason: "Use letters or numbers in the name." }
    if (!at) return { ok: false, reason: "Couldn't read your position. Try again." }

    const mine = homesOf(player.id)
    const existing = mine.find(h => h.id === homeId)
    const limit = homeLimit(player)
    if (!existing) {
        if (limit <= 0) return { ok: false, reason: "Your rank can't set homes." }
        if (mine.length >= limit) {
            return {
                ok: false,
                reason: `You already have ${mine.length} home${mine.length === 1 ? "" : "s"}, `
                    + `which is all your rank allows. Delete one first.`
            }
        }
    }

    /** @type {Home} */
    const home = {
        id: homeId,
        display: String(id ?? homeId).slice(0, 24) || homeId,
        // Centred in the block, like warps: landing on an edge drops you
        // through the floor often enough to be worth the half.
        x: Math.floor(at.x) + 0.5,
        y: Math.floor(at.y),
        z: Math.floor(at.z) + 0.5,
        dimension: player?.dimension?.id ?? "minecraft:overworld",
        created: existing?.created ?? Date.now()
    }
    const next = existing
        ? mine.map(h => (h.id === homeId ? home : h))
        : [...mine, home]
    homes.set(player.id, next)
    return { ok: true, home, replaced: !!existing }
}

/** Remove one. Returns whether there was anything to remove. */
export function deleteHome(playerId, id) {
    const homeId = normaliseHomeId(id)
    const mine = homesOf(playerId)
    const next = mine.filter(h => h.id !== homeId)
    if (next.length === mine.length) return false
    homes.set(String(playerId), next)
    return true
}

/**
 * Forget everything one player set.
 *
 * Here because a rank change can drop somebody's limit below what they hold,
 * and because an owner clearing out a griefer should not have to delete five
 * homes one at a time. It does NOT run automatically on a limit change: homes
 * over the limit stay reachable and simply cannot be added to, which is the
 * kinder failure and the one that does not destroy anything on a mistake.
 */
export function clearHomes(playerId) {
    const had = homesOf(playerId).length
    homes.set(String(playerId), [])
    return had
}

/** Every player who has set one, for a staff overview. */
export function playersWithHomes() {
    return Object.entries(homes.data)
        .filter(([, list]) => Array.isArray(list) && list.length)
        .map(([id, list]) => ({ id, count: list.length }))
}

/** Tests only. */
export function __resetHomes() {
    for (const key of Object.keys(homes.data)) homes.set(key, [])
}
