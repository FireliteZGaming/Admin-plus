import { world, system, EquipmentSlot } from "@minecraft/server"

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

/** What it breaks. The held item is left alone — this is about protection. */
const ARMOUR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]

function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

/** Tag on a thrown trident that came from one of ours. */
export const TRIDENT_TAG = "ap:spectral"

/**
 * Marks a trident that has already struck.
 *
 * A Loyalty trident comes back through everything it passed, and can hurt the
 * same target again on the way. A second storm would restart the grind on
 * somebody already pinned at half a heart, which reads as the effect being
 * stuck rather than as a second hit.
 */
export const TRIDENT_SPENT = "ap:spectral_spent"

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

/**
 * How long after holding one you can still be credited with the throw.
 *
 * Was 10, which assumed the throw was ANNOUNCED by an event a tick before the
 * entity appeared. It is not announced reliably — see installTridentEffects —
 * so the window now has to cover the gap between the last poll that saw the
 * trident in somebody's hand and the entity turning up. A trident charge takes
 * about ten ticks on its own.
 */
const CLAIM_TICKS = 25

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

/**
 * The three acts, in ticks.
 *
 *   GRIND       the dust closes in while the health drains
 *   COLLAPSE    it falls inward onto them — the wind-up
 *   SHOCKWAVE   and back out, as a ring on the ground
 *
 * The grind is three seconds because that is long enough to be a thing that is
 * HAPPENING to somebody rather than a hit they read about afterwards. Everyone
 * nearby gets those three seconds to see it and understand who is doing it.
 */
export const GRIND_TICKS = 60
export const COLLAPSE_TICKS = 10
export const SHOCKWAVE_TICKS = 14
export const STORM_TICKS = GRIND_TICKS + COLLAPSE_TICKS + SHOCKWAVE_TICKS

/** Half a heart, in the units the health component speaks. */
export const FLOOR_HEALTH = 1

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

/** One frame of the swirl. `squeeze` shrinks it; 0 is a point. */
export function renderStorm(dimension, at, points, tick, squeeze = 1) {
    if (!at) return 0
    let drawn = 0
    for (const p of points) {
        const theta = p.offset + tick * p.speed * p.dir
        const wobble = Math.sin(tick * 0.7 + p.offset) * p.wobble
        dust(dimension, {
            x: at.x + Math.cos(theta) * (p.radius + wobble) * squeeze,
            y: at.y + p.height * Math.max(squeeze, 0.12) + Math.sin(tick * 0.5 + p.offset) * 0.25 * squeeze,
            z: at.z + Math.sin(theta) * (p.radius + wobble) * squeeze
        })
        drawn++
    }
    return drawn
}

/**
 * The shockwave: a ring on the ground, running outward.
 *
 * Points scale with the radius so the ring stays a RING — a fixed count spaced
 * evenly round a growing circle turns into separate dots racing apart, which
 * reads as debris rather than as a wave.
 */
export function renderShockwave(dimension, at, t) {
    if (!at) return 0
    const radius = 0.4 + t * 7
    const points = Math.min(64, Math.max(10, Math.round(radius * 7)))
    for (let i = 0; i < points; i++) {
        const theta = (i / points) * Math.PI * 2
        dust(dimension, {
            x: at.x + Math.cos(theta) * radius,
            y: at.y + 0.12 + Math.sin(theta * 3 + t * 6) * 0.1,
            z: at.z + Math.sin(theta) * radius
        })
    }
    return points
}

/**
 * Take them to half a heart, and never below it.
 *
 * Set rather than damaged, deliberately. `applyDamage` runs through armour,
 * resistance and absorption, so the same call lands differently on different
 * people and can KILL — and a weapon whose whole description is "drops them to
 * half a heart" must not sometimes be a weapon that drops them to nothing.
 * Setting the value makes the floor exact and unkillable by construction.
 *
 * It only ever takes health away. Somebody already below the floor is left
 * where they are rather than being healed up to it.
 */
export function drainTo(entity, target) {
    const health = safe(() => entity.getComponent("minecraft:health"))
    if (!health) return undefined
    const now = safe(() => health.currentValue, undefined)
    if (!Number.isFinite(now)) return undefined
    const next = Math.max(FLOOR_HEALTH, Math.min(now, target))
    if (next < now) safe(() => health.setCurrentValue(next))
    return next
}

/** Where the drain should have reached by tick `t` of the grind. */
export function drainCurve(startHealth, t) {
    const through = Math.max(0, Math.min(1, t / GRIND_TICKS))
    return FLOOR_HEALTH + (startHealth - FLOOR_HEALTH) * (1 - through)
}

/**
 * Break everything they are wearing.
 *
 * Destroyed, not dropped: the point of the three seconds is that the armour
 * does not survive it, and armour on the floor is armour they pick straight
 * back up. The held item is left alone — this is about what protects them, not
 * about disarming them.
 */
export function shatterArmour(entity) {
    const equippable = safe(() => entity.getComponent("minecraft:equippable"))
    if (!equippable) return 0
    let broken = 0
    for (const slot of ARMOUR_SLOTS) {
        const worn = safe(() => equippable.getEquipment(slot))
        if (!worn) continue
        if (safe(() => { equippable.setEquipment(slot, undefined); return true }, false)) broken++
    }
    return broken
}
/**
 * Start a storm on a victim. It follows them — the dust is around THEM, not
 * around the spot they were standing when it hit.
 */
const storms = []

export function beginStorm(victim, onBreak) {
    if (!victim) return false
    const health = safe(() => victim.getComponent("minecraft:health"))
    storms.push({
        victim,
        points: stormPoints(),
        born: system.currentTick ?? 0,
        at: { ...victim.location },
        dimension: victim.dimension,
        // Where the drain starts from, read ONCE. Reading it each tick would
        // chase a moving number: anything else hurting them mid-grind would
        // stretch the curve out instead of leaving it on schedule.
        startHealth: safe(() => health?.currentValue, FLOOR_HEALTH) ?? FLOOR_HEALTH,
        broke: false,
        // Told what it managed, when it gets there. Armour breaking is
        // invisible when there was none to break, and "nothing happened" and
        // "they were not wearing any" look identical from across a field.
        onBreak
    })
    return true
}

export function liveStorms() { return storms.length }

/**
 * Advance every storm one frame. Exported so a test can drive it.
 *
 * Three acts, and the damage belongs to the first one only. A storm on
 * something with no health component — a block hit, where the "victim" is just
 * a place — draws all three and harms nobody, which is what makes the visual
 * safe to start before knowing what was struck.
 */
export function tickStorms(now) {
    for (let i = storms.length - 1; i >= 0; i--) {
        const storm = storms[i]
        const age = now - storm.born
        if (age >= STORM_TICKS) { storms.splice(i, 1); continue }

        let at = storm.at
        let alive = false
        try {
            if (storm.victim?.isValid) { at = storm.victim.location; storm.at = { ...at }; alive = true }
        } catch { /* gone — finish where they stood */ }

        if (age < GRIND_TICKS) {
            // Act one: it closes in, and they come down with it.
            const through = age / GRIND_TICKS
            renderStorm(storm.dimension, at, storm.points, now, 1 - through * 0.45)
            if (alive) drainTo(storm.victim, drainCurve(storm.startHealth, age))
            continue
        }

        if (age < GRIND_TICKS + COLLAPSE_TICKS) {
            // Act two: the armour goes, and the dust falls onto them.
            if (!storm.broke) {
                storm.broke = true
                if (alive) {
                    const broken = shatterArmour(storm.victim)
                    drainTo(storm.victim, FLOOR_HEALTH)
                    if (broken) safe(() => storm.dimension.playSound("random.break", at))
                    safe(() => storm.onBreak?.(broken, storm.victim))
                } else {
                    // They did not survive the three seconds, so there was
                    // never an armour phase. Worth saying — it is the other
                    // reason nothing appears to happen.
                    safe(() => storm.onBreak?.(undefined, storm.victim))
                }
            }
            const t = (age - GRIND_TICKS) / COLLAPSE_TICKS
            renderStorm(storm.dimension, at, storm.points, now, Math.max(0.05, 0.55 * (1 - t)))
            continue
        }

        // Act three: back out, as a ring on the ground. Anchored where the
        // collapse happened rather than following them, because a shockwave
        // that trails somebody walking away is not a shockwave.
        const t = (age - GRIND_TICKS - COLLAPSE_TICKS) / SHOCKWAVE_TICKS
        if (t <= 0.05) safe(() => storm.dimension.playSound("random.explode", storm.at))
        renderShockwave(storm.dimension, storm.at, t)
    }
    return storms.length
}

export function clearStorms() { storms.length = 0 }

/** How often to look at what people are holding. */
const POLL_EVERY = 4

/**
 * Watch the whole thing without relying on an event firing.
 *
 * The first version hung on TWO events: `itemReleaseUse` to notice the throw,
 * and `entitySpawn` to catch the entity it made. In a real world the trident
 * did nothing at all — no trail, no storm — and those are not two bugs. They
 * are one: if the tag never lands, the hit handler sees an ordinary trident and
 * every downstream thing is correctly skipped.
 *
 * Which of the four use-events a trident raises is not documented and not worth
 * guessing at — `itemReleaseUse` is the least used of them across the packs
 * installed here, six against twenty-one for `itemStopUse`. And whether
 * `entitySpawn` fires for a projectile is a second guess stacked on the first.
 *
 * So neither is used. The loop already runs every tick for the storms; it now
 * also:
 *
 *   1. remembers who is HOLDING one of ours, sampled every few ticks
 *   2. looks for thrown tridents that are not tagged yet, and tags any that
 *      appeared beside somebody who was holding ours a moment ago
 *   3. draws the trail on the tagged ones
 *
 * Every step is a poll. No event has to fire for any of it, which is the point.
 *
 * @param isOurs  reads an ItemStack and says whether it is a Spectral Trident.
 *                Passed in because the signature lives with the item catalogue.
 */
let announcedFirstTag = false

/**
 * One tick of it: remember who is holding one, adopt any trident they threw,
 * draw the trail on ours, and advance the storms.
 *
 * Exported and given its `now` rather than reading the clock, because a tick
 * loop that can only be driven by the engine can only be tested by describing
 * it. This one gets driven.
 *
 * @returns how many of ours are in the air, for a test to look at.
 */
/**
 * How many of ours were in the air at the last sweep.
 *
 * This is what lets the sweep stop: a tagged trident already in flight
 * still needs rendering, so idling out the moment `pending` empties would
 * drop the dust off a throw mid-air.
 */
let airborne = 0

export function tickTridents(now, isOurs) {
    tickStorms(now)

    if (typeof isOurs === "function" && now % POLL_EVERY === 0) {
        for (const player of world.getAllPlayers()) {
            if (holdingOurs(player, isOurs)) noteThrow(player, now)
        }
    }

    // **Nothing to look for, so do not look.**
    //
    // The sweep below asks all three dimensions for their thrown tridents, and
    // it ran EVERY TICK regardless — sixty entity queries a second, forever, on
    // a world where nobody owns a Spectral Trident and nobody ever has. It
    // arrived with 2.5.5, which traded broken events for polling and did not
    // put a floor under the polling.
    //
    // `enderview.js` and `vanish.js` both already do this: one cheap check
    // turns the idle case into a return. The two conditions are the only ways
    // a trident of ours can be out there — somebody was holding one moments ago
    // (pending), or one we already tagged is still flying (airborne).
    // **Expire claims nobody collected.** `pending` was only ever emptied by a
    // successful claimThrow, so a throw that never produced a trident we could
    // find — into the void, across a chunk border, or simply not ours — left an
    // entry sitting there for the rest of the session. Two costs, and the gate
    // below is what made the first one visible: the sweep could never idle
    // again once anyone had held one, and the Map grew by a player every time.
    for (const [id, until] of pending) {
        if (until < now) pending.delete(id)
    }

    if (!pending.size && !airborne) return 0

    const players = world.getAllPlayers()
    let ours = 0
    for (const dimension of loadedDimensions()) {
        let flying = []
        try { flying = dimension.getEntities({ type: "minecraft:thrown_trident" }) }
        catch { continue }
        for (const entity of flying) {
            let mine = safe(() => entity.hasTag(TRIDENT_TAG), false)
            if (!mine) {
                // Not ours YET. It is ours if it turned up beside somebody who
                // was holding one — claimThrow spends the claim, so one throw
                // can only ever adopt one trident.
                if (!claimThrow(entity, players, now)) continue
                mine = safe(() => { entity.addTag(TRIDENT_TAG); return true }, false)
                if (mine && !announcedFirstTag) {
                    announcedFirstTag = true
                    console.log("[Admin+] spectral trident: first throw tagged in flight")
                }
                if (!mine) continue
            }
            renderFlight(entity, now)
            ours++
        }
    }
    airborne = ours
    return ours
}

export function installTridentEffects(isOurs) {
    system.runInterval(() => tickTridents(system.currentTick ?? 0, isOurs), 1)
}

/** Either hand — a trident is thrown from whichever one holds it. */
function holdingOurs(player, isOurs) {
    const equippable = safe(() => player.getComponent("minecraft:equippable"))
    if (!equippable) return false
    for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand]) {
        const held = safe(() => equippable.getEquipment(slot))
        if (held && safe(() => isOurs(held), false)) return true
    }
    return false
}

function loadedDimensions() {
    const out = []
    for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
        try { const d = world.getDimension(id); if (d) out.push(d) } catch { /* not loaded */ }
    }
    return out
}
