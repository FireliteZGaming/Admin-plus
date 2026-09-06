import { world, system } from "@minecraft/server"
import { Table } from "./storage.js"

// The real ender chest, put where you can reach it.
//
// Every other route ends at the same wall: a container cannot be opened from
// script. Java can — `player.openInventory(player.getEnderChest())` is one line
// in a Bukkit plugin, which is why a Java server's /enderchest opens instantly —
// and Bedrock simply has no equivalent method. Checked against the real type
// definitions for every module, and against how the ecosystem actually behaves:
// every Bedrock backpack addon places its container as a BLOCK and lets the
// player open it, because that is the only thing that works.
//
// So this does what they do. It places a genuine ender chest next to you, and
// what opens is the vanilla screen — not a copy of it, not a form dressed as
// one. Drag, shift-click, double-click-to-fill, every behaviour anyone has ever
// learned in a chest, because it IS the chest. And there is nothing to
// reconcile and nothing to duplicate: it is not a mirror of your ender chest,
// it is your ender chest.
//
// The cost is one tap, and a block that exists in the world for as long as you
// are standing at it.
//
// SAFETY, because writing blocks into somebody's world is not a small thing:
//   - it only ever replaces AIR, so nothing you built is ever overwritten;
//   - it is only ever removed if the block standing there is still our ender
//     chest, so breaking it yourself, or building over it, is never undone;
//   - every placement is written to world storage, so a crash or a reload
//     cannot strand one. They are swept on the next load.

const CHEST = "minecraft:ender_chest"
const IDLE_TICKS = 20 * 60
const MAX_DISTANCE = 6

/** playerId -> {dimensionId, x, y, z, at}. Persisted so a reload can tidy up. */
const placed = new Table("enderBlocks", {})

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

/**
 * Where to put it, best first: in front of you at foot height, then at head
 * height, then directly overhead. Whichever is air.
 */
function candidates(player) {
    const loc = safe(() => player.location)
    if (!loc) return []
    const dir = safe(() => player.getViewDirection()) ?? { x: 0, y: 0, z: 1 }
    // One whole block, in whichever direction they are most facing.
    const step = Math.abs(dir.x) > Math.abs(dir.z)
        ? { x: dir.x > 0 ? 1 : -1, z: 0 }
        : { x: 0, z: dir.z > 0 ? 1 : -1 }
    const bx = Math.floor(loc.x), by = Math.floor(loc.y), bz = Math.floor(loc.z)
    return [
        { x: bx + step.x, y: by, z: bz + step.z },
        { x: bx + step.x, y: by + 1, z: bz + step.z },
        { x: bx, y: by + 2, z: bz }
    ]
}

/**
 * Put one in front of them.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function placeEnderChest(player) {
    clearFor(player.id)

    const dimension = safe(() => player.dimension)
    if (!dimension) return { ok: false, reason: "Couldn't work out where you are." }

    for (const at of candidates(player)) {
        const block = safe(() => dimension.getBlock(at))
        // Air only. Never overwrite something somebody built.
        if (!block || !block.isAir) continue

        const set = safe(() => { dimension.setBlockType(at, CHEST); return true }, false)
        if (!set) continue

        placed.set(player.id, {
            dimensionId: dimension.id, x: at.x, y: at.y, z: at.z, at: system.currentTick
        })
        return { ok: true }
    }
    return { ok: false, reason: "No room to put one — stand somewhere with a gap in front of you." }
}

/**
 * Take it away again, if it is still ours to take.
 *
 * The type check is the whole safety story: if somebody broke it, or built over
 * the spot, or the chunk came back different, we leave it alone rather than
 * punching a hole in whatever is there now.
 */
export function clearFor(playerId) {
    const mark = placed.get(playerId)
    if (!mark) return false
    placed.set(playerId, undefined)

    const dimension = safe(() => world.getDimension(mark.dimensionId))
    if (!dimension) return false
    const at = { x: mark.x, y: mark.y, z: mark.z }
    const block = safe(() => dimension.getBlock(at))
    if (!block || block.typeId !== CHEST) return false

    return safe(() => { dimension.setBlockType(at, "minecraft:air"); return true }, false)
}

/** Is one out right now for this player? */
export function chestPlacedFor(playerId) { return !!placed.get(playerId) }

function tooFar(player, mark) {
    const loc = safe(() => player.location)
    if (!loc) return true
    if (safe(() => player.dimension.id) !== mark.dimensionId) return true
    const dx = loc.x - mark.x, dy = loc.y - mark.y, dz = loc.z - mark.z
    return (dx * dx + dy * dy + dz * dz) > MAX_DISTANCE * MAX_DISTANCE
}

function step() {
    const all = placed.all?.() ?? placed.data ?? {}
    const ids = Object.keys(all)
    if (!ids.length) return

    const online = world.getAllPlayers()
    for (const id of ids) {
        const mark = all[id]
        if (!mark) continue
        const player = online.find(p => p.id === id)
        if (!player || tooFar(player, mark) || system.currentTick - (mark.at ?? 0) > IDLE_TICKS) {
            clearFor(id)
        }
    }
}

/**
 * Clear anything a crash left behind.
 *
 * Runs on load, when nobody can be standing at one, so every placement still on
 * record is an orphan by definition.
 */
export function sweepPlaced() {
    const all = placed.all?.() ?? placed.data ?? {}
    let removed = 0
    for (const id of Object.keys(all)) if (clearFor(id)) removed++
    return removed
}

/** Whose placement, if any, is standing at this block. */
function ownerOfBlock(block) {
    const dimensionId = safe(() => block.dimension.id)
    const loc = safe(() => block.location)
    if (!dimensionId || !loc) return undefined
    const all = placed.all?.() ?? placed.data ?? {}
    for (const [id, mark] of Object.entries(all)) {
        if (!mark) continue
        if (mark.dimensionId === dimensionId
            && mark.x === loc.x && mark.y === loc.y && mark.z === loc.z) return id
    }
    return undefined
}

export function installEnderBlocks() {
    system.run(() => {
        const removed = sweepPlaced()
        if (removed) console.warn(`[Admin+] cleared ${removed} leftover ender chest(s)`)
    })

    // The distance and idle checks are the backstop, not the plan.
    system.runInterval(step, 20)
    world.afterEvents.playerLeave.subscribe(({ playerId }) => clearFor(playerId))

    // CLOSING IT IS THE SIGNAL. The engine cannot open a container for us, but
    // it does tell us when one closes — so the chest goes the moment they are
    // done with it, rather than after they wander off or a minute expires.
    // Deterministic, and it shrinks the window in which the block exists at all.
    const closed = world.afterEvents?.blockContainerClosed
    if (closed?.subscribe) {
        closed.subscribe(event => {
            const owner = ownerOfBlock(safe(() => event.block))
            if (owner) system.run(() => clearFor(owner))
        })
    }

    // AND IT CANNOT BE MINED. An ender chest breaks into eight obsidian, so a
    // placed one is a free obsidian generator: /ec, break it, repeat. Ours
    // refuses to break at all — it is a screen, not a block somebody found.
    const breaking = world.beforeEvents?.playerBreakBlock
    if (breaking?.subscribe) {
        breaking.subscribe(event => {
            if (ownerOfBlock(safe(() => event.block))) event.cancel = true
        })
    }
}
