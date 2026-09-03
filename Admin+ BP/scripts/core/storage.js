import { world, system } from "@minecraft/server"
import { CONFIG } from "../config.js"

// Admin+ storage — JSON on WORLD dynamic properties.
//
// Why not the scoreboard/entity databases other packs use: dynamic properties
// are first-class, survive chunk unloads, need no marker entity, and the whole
// world budget (~1MB) is far more than a warp/ban/home table will ever use.
// Values are chunked because a single property string caps out around 32KB.

const PREFIX = "ap:"
const CHUNK = 8000

const cache = new Map()

function chunkKey(key, i) { return `${PREFIX}${key}#${i}` }

/** Read a stored value. Returns `fallback` when unset or corrupt. */
export function load(key, fallback = null) {
    if (cache.has(key)) return cache.get(key)
    let raw
    try {
        const count = world.getDynamicProperty(`${PREFIX}${key}`)
        if (typeof count !== "number") return fallback
        let out = ""
        for (let i = 0; i < count; i++) out += world.getDynamicProperty(chunkKey(key, i)) ?? ""
        raw = out
    } catch { return fallback }
    if (!raw) return fallback
    try {
        const value = JSON.parse(raw)
        cache.set(key, value)
        return value
    } catch (e) {
        console.warn(`[Admin+] corrupt storage key "${key}": ${e}`)
        return fallback
    }
}

/** Write a value. Objects/arrays are stored as chunked JSON. */
export function save(key, value) {
    const raw = JSON.stringify(value)
    const parts = []
    for (let i = 0; i < raw.length; i += CHUNK) parts.push(raw.slice(i, i + CHUNK))
    try {
        const old = world.getDynamicProperty(`${PREFIX}${key}`)
        if (typeof old === "number") {
            // Clear any chunks the new value no longer needs.
            for (let i = parts.length; i < old; i++) world.setDynamicProperty(chunkKey(key, i), undefined)
        }
        parts.forEach((p, i) => world.setDynamicProperty(chunkKey(key, i), p))
        world.setDynamicProperty(`${PREFIX}${key}`, parts.length)
        cache.set(key, value)
        return true
    } catch (e) {
        console.error(`[Admin+] failed to save "${key}": ${e}`)
        return false
    }
}

/** Delete a stored value entirely. */
export function drop(key) {
    try {
        const count = world.getDynamicProperty(`${PREFIX}${key}`)
        if (typeof count === "number") {
            for (let i = 0; i < count; i++) world.setDynamicProperty(chunkKey(key, i), undefined)
        }
        world.setDynamicProperty(`${PREFIX}${key}`, undefined)
    } catch { /* nothing stored */ }
    cache.delete(key)
}

/**
 * A named table: a plain object persisted under one key, with the whole table
 * kept in memory. Every feature (warps, bans, ranks) uses one of these.
 */
export class Table {
    constructor(key, seed = {}) {
        this.key = key
        const stored = load(key, null)
        this.data = stored ?? JSON.parse(JSON.stringify(seed))

        /** True when this table came out of world storage rather than the seed. */
        this.fromStorage = stored !== null

        if (!this.fromStorage) {
            // Tables are constructed while modules evaluate, which is a
            // READ-ONLY context — writing a dynamic property there throws. So
            // the seed lives in memory now and is persisted on the first tick.
            system.run(() => {
                // ...but READ AGAIN first, and adopt whatever is really there.
                // A read during module evaluation can come back empty on a
                // world that does have data. The old code checked for that and
                // correctly declined to overwrite — then carried on with the
                // SEED in memory for the whole session. The next write of any
                // kind flushed those defaults straight over the real table, so
                // a world would silently revert to a default ladder and then
                // lose the stored one for good.
                const late = load(this.key, null)
                if (late !== null) {
                    this.data = late
                    this.fromStorage = true
                    return
                }
                this.flush()
            })
        }
    }
    get(id) { return this.data[id] }
    has(id) { return Object.prototype.hasOwnProperty.call(this.data, id) }
    set(id, value) { this.data[id] = value; this.flush(); return value }
    delete(id) { delete this.data[id]; this.flush() }
    ids() { return Object.keys(this.data) }
    values() { return Object.values(this.data) }
    entries() { return Object.entries(this.data) }
    replace(obj) { this.data = obj; this.flush() }
    clear() { this.data = {}; this.flush() }
    flush() { save(this.key, this.data) }
}


/** Sanitise a user-supplied id (warp/home/rank name). */
export function cleanId(raw) {
    return String(raw ?? "")
        .trim()
        .slice(0, CONFIG.limits.nameMaxLength)
        .replace(/[^A-Za-z0-9_\-. ]/g, "")
}
