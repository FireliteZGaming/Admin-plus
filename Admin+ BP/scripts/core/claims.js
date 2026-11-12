import { Table } from "./storage.js"
import { has, valueFor } from "./ranks.js"
import { flag } from "./settings.js"

// Land claims: ground a player owns, that other players cannot build on.
//
// **This is the anti-grief feature, and it is the user's, not mine.** CLAUDE.md
// carries a warning about that: an "anti-grief" rule was invented here once,
// attributed to the user, and used twice to talk them out of things they had
// never objected to. Claims were asked for outright on 2026-09-19.
//
// SHAPE: a rectangle on the X/Z plane, full height. Y is deliberately ignored.
// A 13-year-old asking "is my base safe" means the whole column — the base, the
// mine under it, the tower over it — and a claim that stopped at head height
// would be a trap disguised as protection. It also makes every check two
// comparisons instead of three, on a code path that runs on every block broken
// anywhere in the world.
//
// SELECTION: a square centred where you stand, given as a width. The two-corner
// dance every Java plugin uses (stand here, run a command, walk there, run
// another) is a lot of state to hold for somebody who just wants their house
// left alone, and it is the step people get wrong.

const CLAIMS_KEY = "claims"

const claims = new Table(CLAIMS_KEY, {})

/**
 * @typedef {{
 *   id: string, owner: string, ownerName: string, dimension: string,
 *   x1: number, z1: number, x2: number, z2: number,
 *   trusted: {id: string, name: string}[], created: number
 * }} Claim
 */

export function allClaims() {
    return Object.values(claims.data).filter(c => c && typeof c === "object")
}

export function claimsOf(playerId) {
    return allClaims().filter(c => c.owner === String(playerId ?? ""))
}

export function getClaim(id) {
    return claims.get(String(id ?? ""))
}

/** How many this player's rank allows, and how wide each may be. */
export function claimLimit(player) { return Number(valueFor(player, "claim.limit") ?? 0) }
export function claimMaxSize(player) { return Number(valueFor(player, "claim.size") ?? 0) }

/** Is this point inside this claim? Y is not consulted — claims are full height. */
export function inside(claim, dimensionId, x, z) {
    if (!claim || claim.dimension !== dimensionId) return false
    return x >= claim.x1 && x <= claim.x2 && z >= claim.z1 && z <= claim.z2
}

/**
 * The claim covering a point, or undefined.
 *
 * A flat scan. It runs on every block broken in the world, so it is worth being
 * honest about the cost: claims are tens, not thousands, and the dimension
 * check rejects most of them on the first comparison. If a world ever holds
 * enough claims for this to matter, the fix is a chunk index, not a cleverer
 * loop — and nothing here would have to change above this function.
 */
export function claimAt(dimensionId, x, z) {
    const bx = Math.floor(x), bz = Math.floor(z)
    for (const claim of allClaims()) {
        if (inside(claim, dimensionId, bx, bz)) return claim
    }
    return undefined
}

function overlaps(a, dimension, x1, z1, x2, z2) {
    if (a.dimension !== dimension) return false
    return a.x1 <= x2 && a.x2 >= x1 && a.z1 <= z2 && a.z2 >= z1
}

/** The square a claim of `size` centred on `at` would cover. */
export function squareAround(at, size) {
    const half = Math.floor(size / 2)
    const cx = Math.floor(at.x), cz = Math.floor(at.z)
    return { x1: cx - half, z1: cz - half, x2: cx - half + size - 1, z2: cz - half + size - 1 }
}

/**
 * Claim a square centred on the player.
 *
 * Returns `{ok, claim, reason}`. Refuses on: the feature being off, a rank
 * allowed none, already holding the limit, a size over the rank's maximum, and
 * overlapping anybody's claim — **including the claimant's own**, because two
 * claims sharing ground makes "whose rules apply here" unanswerable.
 */
export function createClaim(player, size) {
    if (!flag("feature.claims")) return { ok: false, reason: "Land claims are turned off on this server." }

    const limit = claimLimit(player)
    if (limit <= 0) return { ok: false, reason: "Your rank can't claim land." }

    const mine = claimsOf(player.id)
    if (mine.length >= limit) {
        return {
            ok: false,
            reason: `You already have ${mine.length} claim${mine.length === 1 ? "" : "s"}, `
                + "which is all your rank allows. Remove one first."
        }
    }

    const max = claimMaxSize(player)
    const width = Math.floor(Number(size) || max)
    if (!Number.isFinite(width) || width < 4) {
        return { ok: false, reason: "A claim has to be at least 4 blocks across." }
    }
    if (width > max) {
        return { ok: false, reason: `Your rank's claims can be at most §f${max}§c blocks across.` }
    }

    const at = player?.location
    if (!at) return { ok: false, reason: "Couldn't read your position. Try again." }
    const dimension = player?.dimension?.id ?? "minecraft:overworld"
    const box = squareAround(at, width)

    const clash = allClaims().find(c => overlaps(c, dimension, box.x1, box.z1, box.x2, box.z2))
    if (clash) {
        // Naming the owner is deliberate. "Somebody owns this" with no name is
        // the kind of message that produces a report instead of a conversation.
        return {
            ok: false,
            reason: clash.owner === player.id
                ? `That would overlap your own claim §f${clash.id}§c.`
                : `§f${clash.ownerName}§c has already claimed some of that land.`
        }
    }

    const id = `${player.name}-${mine.length + 1}`.toLowerCase().replace(/[^a-z0-9-]/g, "")
    /** @type {Claim} */
    const claim = {
        id, owner: player.id, ownerName: player.name, dimension,
        ...box, trusted: [], created: Date.now()
    }
    claims.set(id, claim)
    return { ok: true, claim }
}

export function removeClaim(id) {
    const claim = getClaim(id)
    if (!claim) return false
    claims.delete(String(id))
    return true
}

/** Let somebody build here. Returns `{ok, reason}`. */
export function trust(claimId, person) {
    const claim = getClaim(claimId)
    if (!claim) return { ok: false, reason: "That claim no longer exists." }
    if (person.id === claim.owner) return { ok: false, reason: "You already own it." }
    const already = (claim.trusted ?? []).some(t => t.id === person.id)
    if (already) return { ok: false, reason: `§f${person.name}§c can already build there.` }
    claims.set(claimId, {
        ...claim,
        trusted: [...(claim.trusted ?? []), { id: person.id, name: person.name }]
    })
    return { ok: true }
}

export function untrust(claimId, personId) {
    const claim = getClaim(claimId)
    if (!claim) return false
    const next = (claim.trusted ?? []).filter(t => t.id !== personId)
    if (next.length === (claim.trusted ?? []).length) return false
    claims.set(claimId, { ...claim, trusted: next })
    return true
}

/**
 * May this player change blocks here?
 *
 * Anywhere unclaimed is a yes — a claim system that defaults to "no" is a
 * whitelist for the world, which is not what anybody asked for.
 *
 * `admin.claims` passes everywhere. Staff need to be able to deal with what is
 * inside a claim (a lava cast on the border, a griefer's own claim) and a
 * moderator who cannot reach the thing they are moderating just reaches for
 * creative mode instead, which is worse in every way.
 */
export function mayBuild(player, dimensionId, x, z) {
    if (!flag("feature.claims")) return { ok: true }
    const claim = claimAt(dimensionId, x, z)
    if (!claim) return { ok: true }
    if (claim.owner === player?.id) return { ok: true }
    if ((claim.trusted ?? []).some(t => t.id === player?.id)) return { ok: true }
    if (has(player, "admin.claims")) return { ok: true, override: true }
    return { ok: false, claim, reason: `§f${claim.ownerName}§c owns this land.` }
}

/** Tests only. */
export function __resetClaims() {
    claims.clear()
}
