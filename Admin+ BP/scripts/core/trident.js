import { world, system } from "@minecraft/server"

// The Spectral Trident — red dust around it in the air, and a storm of it
// around whatever it hits.
//
// A trident rather than an arrow, and that choice is the whole design. An arrow
// is AMMUNITION: the bow picks a stack out of your inventory, consumes it, and
// spawns a generic `minecraft:arrow` that carries none of the item's name or
// lore. You cannot tell which arrow was fired, and you cannot even choose which
// one the bow takes. A trident IS the item — you throw the one in your hand, so
// there is nothing to pick and nothing to guess. Loyalty proves the stack
// survives the flight, because returning that exact trident with its
// enchantments is what Loyalty does.
//
// Identity still cannot ride on the flying entity by itself: `thrown_trident`
// is a vanilla entity with no room for our serial. So it is TAGGED at the
// moment it appears, off the back of the throw we just saw — the same trick
// buildLine uses to pin a selector's matches to exactly what the engine
// resolved.
//
// The particle work follows Soulbound's abilities: a `phase` driven by the
// clock so the ring actually turns rather than sitting still, points spaced
// evenly around a circle, and every spawnParticle wrapped — a particle in an
// unloaded chunk throws, and one lost frame must not take the effect with it.

/** Proven on this engine: three Soulbound souls draw with this one. */
const DUST = "minecraft:redstone_wire_dust_particle"

/** Tag on a thrown trident that came from one of ours. */
export const TRIDENT_TAG = "ap:spectral"

/**
 * Throws we have seen but not yet matched to an entity.
 *
 * A throw and the entity it creates are two events one tick apart, and there is
 * nothing on the entity tying it back. Holding the thrower for a few ticks and
 * claiming the next trident to appear near them is not elegant, but it is
 * correct in every case that can actually happen: you cannot throw two tridents
 * in the same tick, and nobody else's trident spawns inside your arm.
 */
const pending = new Map()   // playerId -> expiry tick
const CLAIM_TICKS = 10

export function noteThrow(player, tick) {
    if (player?.id) pending.set(player.id, tick + CLAIM_TICKS)
}

/** Who, if anyone, is owed the trident that just appeared here. */
export function claimThrow(entity, players, tick) {
    let best
    let bestDistance = 6 * 6
    for (const player of players) {
        const until = pending.get(player.id)
        if (until === undefined || until < tick) continue
        const d = distanceSquared(player.location, entity.location)
        if (d <= bestDistance) { bestDistance = d; best = player }
    }
    if (best) pending.delete(best.id)
    return best
}

export function forgetThrows(playerId) { pending.delete(playerId) }

function distanceSquared(a, b) {
    const dx = (a?.x ?? 0) - (b?.x ?? 0)
    const dy = (a?.y ?? 0) - (b?.y ?? 0)
    const dz = (a?.z ?? 0) - (b?.z ?? 0)
    return dx * dx + dy * dy + dz * dz
}

function dust(dimension, at) {
    try { dimension.spawnParticle(DUST, at) } catch { /* unloaded chunk */ }
}

/**
 * The trail: a ring of dust turning around the trident as it flies.
 *
 * Six points, which is enough to read as a ring at the speed a trident moves
 * and cheap enough to run every tick on several at once. The phase advances
 * with the clock so the ring SPINS — a fixed set of angles would draw a
 * stationary cage instead, which is the difference Soulbound's spiral makes.
 */
export function renderFlight(entity, tick) {
    const at = entity?.location
    if (!at) return 0
    const phase = tick * 0.45
    const points = 6
    for (let i = 0; i < points; i++) {
        const theta = (i / points) * Math.PI * 2 + phase
        dust(entity.dimension, {
            x: at.x + Math.cos(theta) * 0.45,
            y: at.y + Math.sin(phase + i) * 0.18,
            z: at.z + Math.sin(theta) * 0.45
        })
    }
    return points
}

/**
 * The impact: ten swirls, fast and erratic.
 *
 * Each of the ten gets its own radius, height, speed and direction, fixed when
 * the storm starts rather than re-rolled per tick. Re-rolling every frame
 * produces a fog of unrelated dots; fixing them means ten things that each
 * visibly ORBIT, at odds with each other, which is what reads as erratic. The
 * wobble on top is what stops them looking like clockwork.
 */
const SWIRLS = 10
export const STORM_TICKS = 44

export function stormPoints(seed = Math.random) {
    const out = []
    for (let i = 0; i < SWIRLS; i++) {
        out.push({
            radius: 0.7 + seed() * 0.9,
            height: 0.15 + seed() * 1.7,
            speed: 0.55 + seed() * 0.85,
            dir: seed() < 0.5 ? -1 : 1,
            offset: seed() * Math.PI * 2,
            wobble: 0.15 + seed() * 0.35
        })
    }
    return out
}

/** One frame of the storm. `t` is 0..1 through its life. */
export function renderStorm(dimension, at, points, tick, t) {
    if (!at) return 0
    // Tighten and lift as it goes, so it closes in rather than just stopping.
    const squeeze = 1 - t * 0.35
    let drawn = 0
    for (const p of points) {
        const theta = p.offset + tick * p.speed * p.dir
        const wobble = Math.sin(tick * 0.7 + p.offset) * p.wobble
        dust(dimension, {
            x: at.x + Math.cos(theta) * (p.radius + wobble) * squeeze,
            y: at.y + p.height + Math.sin(tick * 0.5 + p.offset) * 0.25,
            z: at.z + Math.sin(theta) * (p.radius + wobble) * squeeze
        })
        drawn++
    }
    return drawn
}

/**
 * Start a storm on a victim. It follows them — the dust is around THEM, not
 * around the spot they were standing when it hit.
 */
const storms = []

export function beginStorm(victim) {
    if (!victim) return false
    storms.push({
        victim,
        points: stormPoints(),
        born: system.currentTick ?? 0,
        at: { ...victim.location },
        dimension: victim.dimension
    })
    return true
}

export function liveStorms() { return storms.length }

/** Advance every storm one frame. Exported so a test can drive it. */
export function tickStorms(now) {
    for (let i = storms.length - 1; i >= 0; i--) {
        const storm = storms[i]
        const age = now - storm.born
        if (age >= STORM_TICKS) { storms.splice(i, 1); continue }
        // Follow the victim while they are still there; fall back to where they
        // were, so a storm on somebody who dies or logs out finishes in place
        // rather than vanishing mid-swirl.
        let at = storm.at
        try {
            if (storm.victim?.isValid) { at = storm.victim.location; storm.at = { ...at } }
        } catch { /* gone — keep the last known spot */ }
        renderStorm(storm.dimension, at, storm.points, now, age / STORM_TICKS)
    }
    return storms.length
}

export function clearStorms() { storms.length = 0 }

export function installTridentEffects() {
    system.runInterval(() => {
        const now = system.currentTick ?? 0
        tickStorms(now)
        // The trail, for every one of ours in the air.
        for (const dimension of loadedDimensions()) {
            let flying = []
            try { flying = dimension.getEntities({ type: "minecraft:thrown_trident", tags: [TRIDENT_TAG] }) }
            catch { continue }
            for (const entity of flying) renderFlight(entity, now)
        }
    }, 1)
}

function loadedDimensions() {
    const out = []
    for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
        try { const d = world.getDimension(id); if (d) out.push(d) } catch { /* not loaded */ }
    }
    return out
}
