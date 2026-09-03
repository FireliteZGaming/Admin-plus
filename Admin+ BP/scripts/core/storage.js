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

/**
 * A read that says WHY it came back empty.
 *
 * This distinction is the whole bug. "Nothing is stored" and "I could not read"
 * looked identical to every caller — both just returned the fallback, and the
 * failure was swallowed by a bare catch with nothing logged. So a table that
 * failed to read seeded itself with defaults, and the next write put those
 * defaults over a whole world's warps, ranks and settings. It reverted on every
 * single rejoin and nothing anywhere said a word about it.
 *
 * @returns {{ok: true, value: any}|{ok: false}} ok:false means DO NOT WRITE.
 */
function readRaw(key) {
    let raw
    try {
        const count = world.getDynamicProperty(`${PREFIX}${key}`)
        if (typeof count !== "number") return { ok: true, value: null }
        let out = ""
        for (let i = 0; i < count; i++) out += world.getDynamicProperty(chunkKey(key, i)) ?? ""
        raw = out
    } catch (e) {
        console.warn(`[Admin+] could not read storage key "${key}": ${e}`)
        return { ok: false }
    }
    if (!raw) return { ok: true, value: null }
    try {
        return { ok: true, value: JSON.parse(raw) }
    } catch (e) {
        // Already unreadable, so letting a seed replace it loses nothing more —
        // but say so loudly, because it is not normal.
        console.error(`[Admin+] corrupt storage key "${key}", starting it over: ${e}`)
        return { ok: true, value: null }
    }
}

/** Read a stored value. Returns `fallback` when unset, unreadable or corrupt. */
export function load(key, fallback = null) {
    if (cache.has(key)) return cache.get(key)
    const read = readRaw(key)
    if (!read.ok || read.value === null) return fallback
    cache.set(key, read.value)
    return read.value
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
/**
 * Every table built this session, so startup can report on the lot.
 *
 * The question worth answering in one line is not "did ranks load" but "did
 * ANY of them". A world that reverted its ladder on every rejoin was almost
 * certainly failing to read all of them and running on seeds — ranks are just
 * the table whose contents you notice.
 */
const tables = []

export function tableReport() {
    return tables.map(t => ({
        key: t.key,
        fromStorage: t.fromStorage,
        entries: Object.keys(t.data ?? {}).length
    }))
}

export class Table {
    constructor(key, seed = {}) {
        this.key = key
        this.seed = seed
        tables.push(this)

        const read = readRaw(key)

        /** True when this table came out of world storage rather than the seed. */
        this.fromStorage = read.ok && read.value !== null

        if (this.fromStorage) {
            this.data = read.value
            cache.set(key, this.data)
            return
        }

        // Either genuinely empty, or unreadable — and at this point those still
        // look the same from outside. Run on the seed for now, but DO NOT WRITE
        // it: a table is built while modules evaluate, which is a restricted
        // context, and guessing "empty" there is what put defaults over whole
        // worlds. The seed is only committed once a read has actually SUCCEEDED
        // and confirmed there is nothing to lose.
        this.data = JSON.parse(JSON.stringify(seed))
        this.pendingRead = true

        system.run(() => this.adopt())
        // ...and again once the world is properly up, in case a tick was still
        // too early. Retrying costs nothing; writing too soon costs the world.
        try { world.afterEvents?.worldLoad?.subscribe?.(() => this.adopt()) } catch { /* older runtime */ }
    }

    /**
     * Retry the read somewhere safer, and only seed once one has succeeded.
     * Called repeatedly on purpose; it does nothing after the first success.
     */
    adopt() {
        if (!this.pendingRead) return
        const read = readRaw(this.key)
        if (!read.ok) return                       // still cannot read — wait, never write
        this.pendingRead = false
        if (read.value !== null) {
            this.data = read.value
            this.fromStorage = true
            cache.set(this.key, read.value)
            return
        }
        this.flush()                               // confirmed empty: safe to seed
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
