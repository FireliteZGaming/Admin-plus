import { Table } from "./storage.js"
import { flag, setting, setSetting, resetSetting, overrides } from "./settings.js"
import { getSpawn, restoreSpawnPoint } from "./warps.js"

// The Omnitool's spawn: spawn as an AREA you select, instead of a point with a
// radius. Designed by the user on 2026-11-12 (Obsidian: Admin+ ▸ World Tools).
//
// Two ways to run spawn, and only one at a time:
//
//   simple spawn    the old way: a point, and protection out to a radius
//   Omnitool spawn  an area you select with the stick, a sphere or a cuboid,
//                   and a spawn point you click separately (or none)
//
// "omni.spawn" in Server ▸ Settings ▸ Omnitool ▸ General says which. Turning
// it on SETS SIMPLE SPAWN ASIDE: its point and its three settings are saved,
// untouched, in `before`. Turning it off, or Delete in the Omnitool's Spawn
// menu, puts them back exactly ("so it changes back to what you had before").
//
// The switch can change in several ways (its settings page, < Code >, a
// setting preset, a log undo), so nothing listens for the change. Instead
// reconcileSpawn() compares the switch with what was last applied and catches
// up. features/worldtools.js calls it every two seconds and before every
// Omnitool screen. It writes, so it must never run inside a before-event.

const store = new Table("omnitool", {})

const EMPTY = { on: false, region: null, point: null, pointChosen: false, before: null }

/** The settings simple spawn uses, saved and put back as stored overrides. */
const SIMPLE_KEYS = ["feature.spawn", "spawn.protect", "spawn.radius"]

/** What Omnitool spawn has applied, as last saved. */
export function spawnRecord() {
    const rec = store.get("spawn")
    return rec && typeof rec === "object" ? { ...EMPTY, ...rec } : { ...EMPTY }
}

function saveRecord(rec) { store.set("spawn", { ...EMPTY, ...rec }) }

/** Is Omnitool spawn on, with an area saved? */
export function omniSpawnActive() {
    const rec = spawnRecord()
    return rec.on && !!rec.region
}

/**
 * Catch up with the "omni.spawn" switch. Returns what it did: "enabled",
 * "restored", or "" when nothing needed doing.
 */
export function reconcileSpawn() {
    const want = flag("omni.spawn")
    const rec = spawnRecord()
    if (want && !rec.on) {
        const stored = overrides()
        const settings = {}
        for (const key of SIMPLE_KEYS) settings[key] = stored[key] ?? null
        saveRecord({ on: true, before: { point: getSpawn() ?? null, settings } })
        return "enabled"
    }
    if (!want && rec.on) {
        putBackSimple(rec.before)
        saveRecord(EMPTY)
        return "restored"
    }
    return ""
}

/** Simple spawn exactly as it was saved: its point, and each setting stored or not. */
function putBackSimple(before) {
    if (!before) return
    restoreSpawnPoint(before.point)
    for (const key of SIMPLE_KEYS) {
        const value = before.settings?.[key]
        if (value === null || value === undefined) resetSetting(key)
        else setSetting(key, value)
    }
}

/** Turn Omnitool spawn on now, setting simple spawn aside. */
export function enableOmniSpawn() {
    setSetting("omni.spawn", "true")
    return reconcileSpawn()
}

/** Delete the Omnitool spawn: simple spawn comes back as it was. */
export function deleteOmniSpawn() {
    setSetting("omni.spawn", "false")
    return reconcileSpawn()
}

/** Save the area. Keeps the spawn point already chosen. */
export function saveSpawnArea(region) {
    const rec = spawnRecord()
    if (!rec.on) return false
    saveRecord({ ...rec, region: cleanRegion(region) })
    return true
}

/** Where /spawn sends players: a clicked block. Turns /spawn on. */
export function setOmniPoint(point) {
    const rec = spawnRecord()
    if (!rec.on) return false
    saveRecord({ ...rec, point: { ...point }, pointChosen: true })
    setSetting("feature.spawn", "true")
    return true
}

/** "Keep current": /spawn keeps going where simple spawn sent players. */
export function keepSimplePoint() {
    const rec = spawnRecord()
    if (!rec.on || !rec.before?.point) return false
    saveRecord({ ...rec, point: { ...rec.before.point }, pointChosen: true })
    return true
}

/** "Don't set spawn": no point, and every setting that teleports to spawn goes off. */
export function dontSetPoint() {
    const rec = spawnRecord()
    if (!rec.on) return false
    saveRecord({ ...rec, point: null, pointChosen: true })
    setSetting("feature.spawn", "false")
    return true
}

/** The simple spawn point that was set aside, for the "Keep current" button. */
export function setAsidePoint() {
    return spawnRecord().before?.point ?? null
}

/**
 * Where /spawn sends players right now: the Omnitool's point while Omnitool
 * spawn is on (none if "Don't set spawn" was picked), otherwise simple spawn's.
 */
export function currentSpawnPoint() {
    const rec = spawnRecord()
    if (rec.on) return rec.point ?? undefined
    return getSpawn()
}

/**
 * Is this position inside spawn? Reads only, so before-events may call it.
 * While Omnitool spawn is on, that is its area; with no area saved yet there
 * is no spawn area. Otherwise it is simple spawn's circle, full height.
 */
export function insideSpawnArea(location, dimensionId) {
    const rec = spawnRecord()
    if (rec.on) return !!rec.region && regionContains(rec.region, location, dimensionId)
    const point = getSpawn()
    if (!point || dimensionId !== point.dimension) return false
    const radius = Number(setting("spawn.radius"))
    if (!Number.isFinite(radius) || radius <= 0) return false
    const dx = location.x - point.x
    const dz = location.z - point.z
    return dx * dx + dz * dz <= radius * radius
}

// ------------------------------------------------------------------ shapes
//
// pos1 and pos2 work the way WorldEdit's do (checked in its documentation and
// in WorldEdit Bedrock 0.10.4, 2026-11-12). Admin+ copies none of its code.
//
//   cuboid  pos1 and pos2 are opposite corner BLOCKS, both included
//   sphere  pos1 is the centre block, pos2 sets the radius: the distance from
//           the centre to pos2, rounded to whole blocks

export const SHAPES = ["sphere", "cuboid"]

const blockOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) })

/** A region from two points: the shape, its dimension, pos1 and (maybe) pos2. */
export function makeRegion(shape, dimension, pos1, pos2) {
    return cleanRegion({ shape, dimension, pos1, pos2 })
}

function cleanRegion(r) {
    if (!r) return null
    return {
        shape: SHAPES.includes(r.shape) ? r.shape : "sphere",
        dimension: r.dimension ?? "minecraft:overworld",
        pos1: r.pos1 ? blockOf(r.pos1) : null,
        pos2: r.pos2 ? blockOf(r.pos2) : null
    }
}

/** Both points set? */
export function regionComplete(r) {
    return !!(r && r.pos1 && r.pos2)
}

/** The sphere's radius in whole blocks. */
export function sphereRadius(r) {
    const dx = r.pos2.x - r.pos1.x, dy = r.pos2.y - r.pos1.y, dz = r.pos2.z - r.pos1.z
    return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz))
}

/** The cuboid's lowest and highest blocks. */
export function cuboidBounds(r) {
    return {
        min: { x: Math.min(r.pos1.x, r.pos2.x), y: Math.min(r.pos1.y, r.pos2.y), z: Math.min(r.pos1.z, r.pos2.z) },
        max: { x: Math.max(r.pos1.x, r.pos2.x), y: Math.max(r.pos1.y, r.pos2.y), z: Math.max(r.pos1.z, r.pos2.z) }
    }
}

/** Size words for screens: "radius 12 blocks" or "21 × 8 × 30 blocks". */
export function describeRegion(r) {
    if (!regionComplete(r)) return r?.pos1 ? "only pos1 is set" : "nothing set yet"
    if (r.shape === "sphere") return `radius ${sphereRadius(r)} block${sphereRadius(r) === 1 ? "" : "s"}`
    const { min, max } = cuboidBounds(r)
    return `${max.x - min.x + 1} × ${max.y - min.y + 1} × ${max.z - min.z + 1} blocks`
}

/**
 * Is a position inside the region? Blocks count by their centre, so a block
 * on the edge of a sphere is in when its centre is within half a block.
 */
export function regionContains(r, location, dimensionId) {
    if (!regionComplete(r) || dimensionId !== r.dimension) return false
    if (r.shape === "sphere") {
        const radius = sphereRadius(r) + 0.5
        const dx = location.x - (r.pos1.x + 0.5)
        const dy = location.y - (r.pos1.y + 0.5)
        const dz = location.z - (r.pos1.z + 0.5)
        return dx * dx + dy * dy + dz * dz <= radius * radius
    }
    const { min, max } = cuboidBounds(r)
    const x = Math.floor(location.x), y = Math.floor(location.y), z = Math.floor(location.z)
    return x >= min.x && x <= max.x && y >= min.y && y <= max.y && z >= min.z && z <= max.z
}

/**
 * Where to draw the white outline, as world positions. A box: its 12 edges.
 * A sphere: three rings around the centre. With only pos1, a small box round
 * that block. Spacing grows with size so no outline costs more than about 300
 * particles a draw.
 */
export function outlinePoints(r) {
    if (!r?.pos1) return []
    if (!regionComplete(r)) return boxEdges(r.pos1, { x: r.pos1.x + 1, y: r.pos1.y + 1, z: r.pos1.z + 1 }, 4)
    if (r.shape === "cuboid") {
        const { min, max } = cuboidBounds(r)
        return boxEdges(min, { x: max.x + 1, y: max.y + 1, z: max.z + 1 }, 24)
    }
    const c = { x: r.pos1.x + 0.5, y: r.pos1.y + 0.5, z: r.pos1.z + 0.5 }
    const radius = Math.max(0.5, sphereRadius(r))
    const n = Math.max(12, Math.min(64, Math.round(2 * Math.PI * radius)))
    const out = []
    for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI, cos = Math.cos(a) * radius, sin = Math.sin(a) * radius
        out.push({ x: c.x + cos, y: c.y, z: c.z + sin })     // flat ring
        out.push({ x: c.x + cos, y: c.y + sin, z: c.z })     // upright, facing north
        out.push({ x: c.x, y: c.y + sin, z: c.z + cos })     // upright, facing east
    }
    out.push(c)
    return out
}

function boxEdges(lo, hi, maxPerEdge) {
    const corners = []
    for (const x of [lo.x, hi.x]) for (const y of [lo.y, hi.y]) for (const z of [lo.z, hi.z]) corners.push({ x, y, z })
    const out = [...corners]
    const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]]
    for (const [i, j] of edges) {
        const a = corners[i], b = corners[j]
        const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(b.z - a.z)
        const steps = Math.min(maxPerEdge, Math.max(1, Math.round(length)))
        for (let s = 1; s < steps; s++) {
            const t = s / steps
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })
        }
    }
    return out
}
