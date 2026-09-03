import { setting, flag } from "./settings.js"

// Automod.
//
// Two rules shape all of this:
//
//   1. IT NOTIFIES, IT NEVER PUNISHES. Staff decide. An automod that bans on its
//      own is only as trustworthy as its worst false positive.
//   2. NO MOVEMENT CHECKS. Bedrock movement is server-authoritative, so fly and
//      speed are the engine's job — a script re-doing it just adds false
//      positives on elytra, riptide, ice and lag.
//
// Ore alerts group by VEIN, not by block and not by clock. Mining an eight-block
// diamond vein is ONE find, so it is one message — "found a x8 diamond vein" —
// however long it took. Blocks count as the same vein when they are near the
// previous block of that ore; step away and start digging somewhere else and
// that is a new find, reported separately.

/** Ores worth watching, with the vein size it takes before staff hear about it. */
export const DEFAULT_ORE_THRESHOLDS = {
    diamond_ore: 3,
    deepslate_diamond_ore: 3,
    ancient_debris: 2,
    emerald_ore: 3,
    deepslate_emerald_ore: 3,
    gold_ore: 8,
    deepslate_gold_ore: 8
}

/** Parse the editable "diamond_ore:3, ancient_debris:2" form. */
export function oreThresholds() {
    const raw = String(setting("automod.oreThresholds") ?? "").trim()
    if (!raw) return { ...DEFAULT_ORE_THRESHOLDS }
    const out = {}
    for (const part of raw.split(",")) {
        const [name, value] = part.split(":")
        const id = String(name ?? "").trim().replace("minecraft:", "")
        const n = Number(value)
        if (id && Number.isFinite(n) && n > 0) out[id] = n
    }
    return Object.keys(out).length ? out : { ...DEFAULT_ORE_THRESHOLDS }
}

function number(key, fallback) {
    const value = Number(setting(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
}

export const config = {
    ores: () => flag("automod.ores"),
    veinRadius: () => number("automod.veinRadius", 5),   // blocks apart and still one vein
    veinIdle: () => number("automod.veinIdle", 8),       // seconds before a vein is closed
    breaks: () => flag("automod.breaks"),
    breakRate: () => number("automod.breakRate", 20),    // blocks per second
    spam: () => flag("automod.spam"),
    spamRate: () => number("automod.spamRate", 6)        // messages per 10s
}

// ------------------------------------------------------------------- veins

/** playerId -> { name, ore, count, at, last, dimension } */
const veins = new Map()

function far(a, b, radius) {
    if (!a || !b) return true
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
    return dx * dx + dy * dy + dz * dz > radius * radius
}

function finish(playerId, vein) {
    const threshold = oreThresholds()[vein.ore] ?? Infinity
    if (vein.count < threshold) return undefined     // an ordinary find; say nothing
    return {
        playerId,
        name: vein.name,
        ore: vein.ore,
        count: vein.count,
        at: vein.at,
        dimension: vein.dimension
    }
}

/**
 * Note one mined ore block.
 *
 * @param {object} player
 * @param {string} blockId
 * @param {{x: number, y: number, z: number}} location the BLOCK's position, not the player's
 * @returns {object|undefined} a finished vein, when this block started a new one
 */
export function noteOre(player, blockId, location, now = Date.now()) {
    const ore = String(blockId).replace("minecraft:", "")
    if (!(ore in oreThresholds())) return undefined

    const spot = location ?? player.location
    const current = veins.get(player.id)

    // Same ore, near the last block, and they have not wandered off: one vein.
    const continues = current
        && current.ore === ore
        && current.dimension === player.dimension?.id
        && !far(current.last, spot, config.veinRadius())
        && now - current.time <= config.veinIdle() * 1000

    if (continues) {
        current.count++
        current.last = { x: spot.x, y: spot.y, z: spot.z }
        current.time = now
        return undefined
    }

    // Anything else means the previous vein is over — report it, then start fresh.
    const finished = current ? finish(player.id, current) : undefined
    veins.set(player.id, {
        name: player.name,
        ore,
        count: 1,
        at: { x: Math.round(spot.x), y: Math.round(spot.y), z: Math.round(spot.z) },
        last: { x: spot.x, y: spot.y, z: spot.z },
        time: now,
        dimension: player.dimension?.id
    })
    return finished
}

/**
 * Veins nobody has added to for a while — the last vein of a session would
 * otherwise sit unreported until they happened to mine again.
 */
export function drainFinishedVeins(now = Date.now()) {
    const idleMs = config.veinIdle() * 1000
    const out = []
    for (const [playerId, vein] of [...veins]) {
        if (now - vein.time < idleMs) continue
        veins.delete(playerId)
        const finished = finish(playerId, vein)
        if (finished) out.push(finished)
    }
    return out
}

export function forgetPlayer(playerId) {
    veins.delete(playerId)
    breakRates.delete(playerId)
    chatRates.delete(playerId)
}

/** For the panel: veins being followed right now. */
export function liveVeins() {
    return [...veins.entries()].map(([id, v]) => ({ id, name: v.name, ore: v.ore, count: v.count }))
}

/** "x8 diamond ore" */
export function describeVein(vein) {
    return `x${vein.count} ${vein.ore.replace(/_/g, " ")}`
}

// ------------------------------------------------------------- rate limiting

const breakRates = new Map()   // playerId -> { second, count, reported }
const chatRates = new Map()    // playerId -> { since, count, reported }

/**
 * Blocks broken this second. Returns the count when the rate is exceeded, else
 * 0 — and only once per burst, so a sustained nuker does not spam staff either.
 */
export function noteBreak(player, now = Date.now()) {
    if (!config.breaks()) return 0
    const second = Math.floor(now / 1000)
    const state = breakRates.get(player.id)

    if (!state || state.second !== second) {
        breakRates.set(player.id, { second, count: 1, reported: false })
        return 0
    }
    state.count++
    if (state.count > config.breakRate() && !state.reported) {
        state.reported = true
        return state.count
    }
    return 0
}

/** Messages in the last 10 seconds. Returns the count when flooding, else 0. */
export function noteChat(player, now = Date.now()) {
    if (!config.spam()) return 0
    const state = chatRates.get(player.id)

    if (!state || now - state.since > 10000) {
        chatRates.set(player.id, { since: now, count: 1, reported: false })
        return 0
    }
    state.count++
    if (state.count > config.spamRate() && !state.reported) {
        state.reported = true
        return state.count
    }
    return 0
}
