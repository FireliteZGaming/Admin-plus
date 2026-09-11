import { system } from "@minecraft/server"
import { Table } from "./storage.js"
import { setting, flag } from "./settings.js"
import { has } from "./ranks.js"
import { canUseCode } from "./devgate.js"

// The orbital strike: aim it by looking, and it falls out of the sky.
//
// Reimplemented from lllTango_lll's Orbital command-block build (Orbital
// .mcstructure, read 2026-09-11). None of their files ship — the pack's rule —
// and in the end almost none of their MACHINERY was needed either, because the
// hard half of theirs is a problem a script does not have:
//
//   Theirs aims by summoning an xp_orb at the player's eye, rotating it to face
//   where they look, and then nesting `execute as @e[c=2]` TEN deep — 2^10 =
//   1024 runs in one tick — each stepping the orb `^^^0.1` forward with
//   checkForBlocks, so it stops dead at the first solid block. 1024 steps of
//   0.1 is a hundred-block raycast built out of redstone, and the refusal to
//   teleport into a block IS the collision test.
//
//   `getBlockFromViewDirection()` is that, in one call.
//
// What was worth taking is the DRAMA, which they got right: a darkness effect
// over everyone nearby and a warden heartbeat that accelerates. You hear it
// coming and you have time to run. That is the whole feature; the explosion is
// just the end of it.

const ARMED_KEY = "nukeArmed"
const armedTable = new Table(ARMED_KEY, {})

/**
 * Is the strike armed in this world?
 *
 * Off until somebody types `toggle nuke` in the console, and it stays on until
 * they type it again — a switch, not a charge. Stored rather than held in
 * memory so a reload does not quietly disarm it and leave an item that fails
 * for no visible reason.
 */
export function nukeArmed() {
    return armedTable.get("on") === true
}

/** Flip it. Returns the new state. */
export function armNuke(on) {
    const next = on === undefined ? !nukeArmed() : !!on
    if (next) armedTable.set("on", true)
    else armedTable.delete("on")
    return next
}

/**
 * The locks, all of them, every time.
 *
 * Each one is a different KIND of claim, which is why there is more than one:
 *
 *   the troll section  an owner turned this whole class of thing on
 *   armed              somebody typed `toggle nuke` at the console, in THIS
 *                      world, deliberately
 *   operator + Dev tag whoever holds the rod meant to be holding it
 *   admin.troll        no rank they hold has taken troll tools away
 *
 * **That last one is weaker than it looks, and saying so is better than
 * implying otherwise.** `has()` lets an operator through any node no rank has
 * an opinion about — deliberately, so a fresh world cannot lock its own host
 * out — and this gate already demands operator. So the node cannot ADD anybody;
 * it can only subtract, honouring an explicit `-admin.troll` on a rank. That is
 * still worth having: it is how a realm carves this out of one admin rank
 * without touching the other three locks. It is just not a fourth key.
 *
 * Checked when the chest is drawn AND again when the rod is used, so a rod that
 * outlives any one of them goes inert rather than becoming a way round the lot.
 */
export function canNuke(player) {
    if (!flag("feature.troll")) return false
    if (!nukeArmed()) return false
    if (!has(player, "admin.troll")) return false
    return canUseCode(player)
}

/** Which lock is shut, for a message that says something useful. */
export function nukeBlockedBy(player) {
    if (!flag("feature.troll")) return "the troll section is off"
    if (!nukeArmed()) return "it isn't armed — type §ftoggle nuke§c in the console"
    if (!has(player, "admin.troll")) return "your rank has troll tools denied"
    if (!canUseCode(player)) return "you need operator and developer mode"
    return undefined
}

function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

function tuning(key, fallback) {
    const value = Number(setting(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Where they are pointing.
 *
 * A block if the ray hits one; otherwise the point at maximum range along the
 * same line, so looking at the sky still fires rather than silently doing
 * nothing. An orbital strike that refuses because there was no roof in the way
 * would be a strange weapon.
 */
export function aimPoint(player) {
    const range = tuning("nuke.range", 160)
    const hit = safe(() => player.getBlockFromViewDirection({
        maxDistance: range,
        includeLiquidBlocks: false,
        includePassableBlocks: false
    }))
    if (hit?.block) {
        const at = hit.block.location
        return { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 }
    }
    const eye = safe(() => player.getHeadLocation(), player.location)
    const dir = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 })
    return {
        x: eye.x + dir.x * range,
        y: eye.y + dir.y * range,
        z: eye.z + dir.z * range
    }
}

/**
 * The countdown, in ticks between beats.
 *
 * Accelerating, which is the part that makes it frightening rather than merely
 * long — lllTango_lll's chain runs 56, 50, 46, 36, 30, 26, 20 and that shape is
 * exactly right. Shortened here: theirs totals about thirteen seconds, which is
 * a long time to stand still in a form-driven pack.
 */
const BEATS = [40, 34, 28, 22, 16, 10, 6]

/** Running totals, so each beat can be scheduled against the same start. */
export function beatOffsets(gaps = BEATS) {
    const out = []
    let at = 0
    for (const gap of gaps) { out.push(at); at += gap }
    out.push(at)
    return out
}

/** How long the whole warning lasts, in ticks. */
export function fuseTicks() { return beatOffsets().at(-1) }

/**
 * Call it in. Returns false only when nothing could be reached at all.
 *
 * The sequence is warning, descent, impact — and the warning is the point. It
 * is loud, it is visible to everyone within range, and it is long enough to run
 * out of the way, which is what separates a strike from a fine.
 */
export function orbitalStrike(player) {
    const dimension = player?.dimension
    if (!dimension) return false
    const target = aimPoint(player)
    const offsets = beatOffsets()

    // Blind and deafen the neighbourhood. Cleared at impact rather than left to
    // expire, so the flash is the first thing anybody sees again.
    safe(() => {
        for (const near of dimension.getPlayers({ location: target, maxDistance: 60 })) {
            near.addEffect("darkness", fuseTicks() + 40, { amplifier: 3, showParticles: false })
        }
    })

    for (const at of offsets.slice(0, -1)) {
        system.runTimeout(() => {
            safe(() => dimension.playSound("mob.warden.heartbeat", target))
        }, at)
    }

    // The descent: a column dropping into the target over the last half second,
    // so the explosion arrives from somewhere rather than simply happening.
    const impact = fuseTicks()
    for (let step = 0; step < 10; step++) {
        system.runTimeout(() => {
            safe(() => dimension.spawnParticle("minecraft:endrod", {
                x: target.x, y: target.y + 60 - step * 6, z: target.z
            }))
        }, impact - 10 + step)
    }

    system.runTimeout(() => detonate(dimension, target), impact)
    return true
}

/**
 * The impact itself.
 *
 * One central blast and a ring around it, a tick apart, because a single
 * createExplosion of the same total size reads as a pop and a crater rather
 * than as something arriving. Block damage is a SETTING, defaulting on: it is
 * behind four locks already and a nuke that leaves the ground flat is a joke
 * rather than a weapon — but a realm owner who wants the sound and the fear
 * without the hole should not have to choose between that and nothing.
 */
function detonate(dimension, target) {
    const radius = tuning("nuke.radius", 12)
    const breaksBlocks = flag("nuke.breaksBlocks")
    const options = { breaksBlocks, causesFire: false, allowUnderwater: true }

    safe(() => dimension.createExplosion(target, radius, options))
    safe(() => dimension.playSound("ambient.weather.lightning.impact", target))

    const ring = radius * 0.9
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6
        const at = {
            x: target.x + Math.cos(angle) * ring,
            y: target.y,
            z: target.z + Math.sin(angle) * ring
        }
        system.runTimeout(() => {
            safe(() => dimension.createExplosion(at, radius * 0.6, options))
        }, 1 + i)
    }

    safe(() => {
        for (const near of dimension.getPlayers({ location: target, maxDistance: 60 })) {
            near.removeEffect("darkness")
        }
    })
}
