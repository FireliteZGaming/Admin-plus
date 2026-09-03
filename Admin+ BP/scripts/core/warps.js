import { world } from "@minecraft/server"
import { Table, cleanId } from "./storage.js"
import { has, isStaff, ladder, getRank, topWeight, isOwner } from "./ranks.js"

// Warps: named destinations, each with its own access rule.
//
// The rule that shapes the whole feature: a warp you cannot use does not exist
// as far as you are concerned. It is absent from lists, and naming it directly
// reports "no such warp" rather than "no permission" — otherwise the error
// message hands out a map of the staff network to anyone who guesses.

const WARPS_KEY = "warps"
const SPAWN_KEY = "spawnPoint"

/**
 * @typedef {{
 *   id: string, display: string,
 *   x: number, y: number, z: number, dimension: string,
 *   access: "all" | "staff" | "rank", rank?: string,
 *   created: number
 * }} Warp
 */

const warps = new Table(WARPS_KEY, {})
const spawn = new Table(SPAWN_KEY, {})

export function allWarps() {
    return Object.values(warps.data).sort((a, b) => a.id.localeCompare(b.id))
}

export function getWarp(id) {
    return warps.get(String(id ?? "").toLowerCase())
}

export function normaliseWarpId(raw) {
    return cleanId(raw).toLowerCase().replace(/\s+/g, "_")
}

/** Create or update a warp. Location defaults to where the player stands. */
export function saveWarp(id, data, player) {
    const warpId = normaliseWarpId(id)
    if (!warpId) return undefined
    const existing = warps.get(warpId)
    const at = player?.location
    /** @type {Warp} */
    const warp = {
        id: warpId,
        display: data.display ?? existing?.display ?? warpId,
        x: data.x ?? (at ? Math.floor(at.x) + 0.5 : existing?.x ?? 0),
        y: data.y ?? (at ? Math.floor(at.y) : existing?.y ?? 64),
        z: data.z ?? (at ? Math.floor(at.z) + 0.5 : existing?.z ?? 0),
        dimension: data.dimension ?? player?.dimension?.id ?? existing?.dimension ?? "minecraft:overworld",
        access: data.access ?? existing?.access ?? "all",
        rank: data.rank ?? existing?.rank,
        created: existing?.created ?? Date.now()
    }
    warps.set(warpId, warp)
    return warp
}

export function deleteWarp(id) { warps.delete(normaliseWarpId(id)) }

// ---------------------------------------------------------------- access

/**
 * Can this player use this warp?
 *   all    everyone
 *   staff  any rank flagged staff (plus owners and operators)
 *   rank   the named ladder row, or anything above it
 */
export function canUseWarp(player, warp) {
    if (!warp) return false
    if (isOwner(player)) return true
    if (has(player, "warp.manage")) return true          // managers see everything
    switch (warp.access) {
        case "staff": return isStaff(player)
        case "rank": {
            const required = getRank(warp.rank)
            if (!required) return isStaff(player)         // rank was deleted — fail closed
            return topWeight(player) >= (required.weight ?? 0)
        }
        default: return true
    }
}

/** Only the warps this player may actually use. */
export function warpsFor(player) {
    return allWarps().filter(w => canUseWarp(player, w))
}

/** Human description of a warp's rule, for the panel. */
export function accessLabel(warp) {
    switch (warp?.access) {
        case "staff": return "§6Staff only"
        case "rank": {
            const rank = getRank(warp.rank)
            return rank ? `${rank.display}§r§7 and above` : "§cmissing rank — staff only"
        }
        default: return "§aEveryone"
    }
}

/** Ladder rows offered as a warp requirement. */
export function rankOptions() { return ladder() }

// ----------------------------------------------------------------- spawn

export function getSpawn() {
    const point = spawn.get("point")
    return point && typeof point.x === "number" ? point : undefined
}

export function setSpawn(player) {
    const at = player.location
    const point = {
        x: Math.floor(at.x) + 0.5,
        y: Math.floor(at.y),
        z: Math.floor(at.z) + 0.5,
        dimension: player.dimension.id,
        set: Date.now()
    }
    spawn.set("point", point)
    return point
}

export function clearSpawn() { spawn.delete("point") }

// ------------------------------------------------------------- teleporting

/** Resolve a stored dimension id, falling back to the overworld. */
export function dimensionOf(record) {
    try { return world.getDimension(record?.dimension ?? "minecraft:overworld") }
    catch { return world.getDimension("minecraft:overworld") }
}

/** Move a player to a stored location. Returns false if the dimension is gone. */
export function teleportTo(player, record) {
    const dimension = dimensionOf(record)
    if (!dimension) return false
    player.teleport({ x: record.x, y: record.y, z: record.z }, { dimension })
    return true
}
