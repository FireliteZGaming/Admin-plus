import { world, system, DimensionTypes } from "@minecraft/server"
import { Table } from "./storage.js"

// Floating text: a line of writing that hangs in the air, and the leaderboard
// that reads a scoreboard objective into one.
//
// The trick, and it is an old one: Bedrock has no text-display entity, but it
// does have nametags that can be forced always-visible. So a hologram is an
// entity scaled to zero — no model, no gravity, no collision, immune to damage
// and knockback — wearing the text as its name. entities/floating_text.json is
// that entity; this file is everything else.
//
// What lives WHERE matters here. The entity is disposable: it can be despawned
// by a chunk unloading badly, a /kill, or someone else's addon. The DEFINITION
// lives in world storage, keyed by id, so the hologram can always be rebuilt.
// The entity is a view of the record, never the record itself — which is why
// losing one costs nothing and why editing text never touches the entity.

const KEY = "holograms"
const TYPE = "adminplus:floating_text"
const TAG = "ap:holo"

const holos = new Table(KEY, {})

/** @typedef {{id: string, kind: "text"|"board", text?: string, title?: string, format?: string, objective?: string, max?: number, ascending?: boolean, dimension: string, x: number, y: number, z: number}} Hologram */

export function list() {
    return holos.values().sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

export function get(id) { return holos.get(String(id ?? "").toLowerCase()) }
export function count() { return holos.ids().length }

function cleanId(raw) {
    return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24)
}

// ------------------------------------------------------------------ writing

/**
 * @returns {{ok: boolean, holo?: Hologram, reason?: string}}
 */
export function save(id, data) {
    const key = cleanId(id)
    if (!key) return { ok: false, reason: "That id has no usable characters in it." }

    const existing = holos.get(key)
    const holo = {
        id: key,
        kind: data.kind ?? existing?.kind ?? "text",
        text: data.text ?? existing?.text ?? "",
        title: data.title ?? existing?.title ?? "",
        format: data.format ?? existing?.format ?? "§7{INDEX}. §f{NAME} §8— §a{SCORE}",
        objective: data.objective ?? existing?.objective ?? "",
        max: Number.isFinite(Number(data.max)) ? Number(data.max) : (existing?.max ?? 10),
        ascending: data.ascending ?? existing?.ascending ?? false,
        dimension: data.dimension ?? existing?.dimension ?? "minecraft:overworld",
        x: Number.isFinite(Number(data.x)) ? Number(data.x) : (existing?.x ?? 0),
        y: Number.isFinite(Number(data.y)) ? Number(data.y) : (existing?.y ?? 0),
        z: Number.isFinite(Number(data.z)) ? Number(data.z) : (existing?.z ?? 0)
    }
    holos.set(key, holo)
    reported.clear()          // a fresh definition deserves a fresh complaint
    console.log(`[Admin+] hologram "${key}" saved (${holo.kind}) at ${holo.x} ${holo.y} ${holo.z} in ${holo.dimension}`)
    return { ok: true, holo }
}

export function remove(id) {
    const key = cleanId(id)
    if (!holos.has(key)) return { ok: false, reason: "No hologram by that name." }
    holos.delete(key)
    despawn(key)
    return { ok: true }
}

export function removeAll() {
    const n = count()
    for (const id of holos.ids()) despawn(id)
    holos.clear()
    return n
}

// ---------------------------------------------------------------- rendering

/** Tokens any hologram can use. */
function basicTokens(text) {
    return String(text ?? "")
        .replaceAll("\\n", "\n")
        .replaceAll("{ONLINE}", String(world.getAllPlayers().length))
        .replaceAll("{DAY}", String(Math.floor((world.getAbsoluteTime?.() ?? 0) / 24000)))
}

/**
 * Read an objective into ranked lines.
 *
 * Participants with no score are skipped rather than shown as zero — a
 * leaderboard listing everyone who has ever joined at 0 points is noise, and
 * "not on the board yet" is the honest reading of no score.
 */
/**
 * Names for people who are not here.
 *
 * A scoreboard participant's displayName is only a name while that player is
 * ONLINE. Log off and Bedrock hands back the raw untranslated string
 * "commands.scoreboard.players.offlinePlayerName" instead, which is what a
 * leaderboard was printing in place of the top player's name.
 *
 * There is no way to ask the scoreboard who that identity belongs to, so the
 * name has to be remembered while they are here and looked up afterwards.
 */
const nameCache = new Table("scoreNames", {})

/** Anything starting like this is a translation key, not somebody's name. */
const UNTRANSLATED = "commands.scoreboard"

function rememberOnlineNames() {
    for (const player of world.getAllPlayers()) {
        const id = safe(() => player.scoreboardIdentity?.id)
        if (id === undefined || id === null) continue
        const key = String(id)
        // Guarded so a board refreshing on a timer is not writing every tick.
        if (nameCache.get(key) === player.name) continue
        nameCache.set(key, player.name)
    }
}

function participantName(participant) {
    const shown = safe(() => participant?.displayName)
    if (shown && !shown.startsWith(UNTRANSLATED)) return shown

    const id = safe(() => participant?.id)
    const remembered = id === undefined ? undefined : nameCache.get(String(id))
    // Grey, so a name Admin+ never saw reads as missing information rather
    // than as a player called something strange.
    return remembered ?? "§8(offline)"
}

export function board(holo) {
    const objective = safe(() => world.scoreboard?.getObjective(holo.objective))
    if (!objective) return [`§cNo objective "${holo.objective}"`]

    rememberOnlineNames()

    const rows = safe(() => objective.getScores(), []) ?? []
    const ranked = rows
        .filter(row => Number.isFinite(row?.score))
        .map(row => ({
            name: participantName(row.participant),
            score: row.score
        }))
        .sort((a, b) => holo.ascending ? a.score - b.score : b.score - a.score)
        .slice(0, Math.max(1, Math.min(holo.max || 10, 50)))

    if (!ranked.length) return ["§8nobody on the board yet"]

    return ranked.map((row, i) => basicTokens(holo.format)
        .replaceAll("{INDEX}", String(i + 1))
        .replaceAll("{NAME}", row.name)
        .replaceAll("{SCORE}", String(row.score)))
}

/** The whole nametag for one hologram. */
export function render(holo) {
    if (!holo) return ""
    if (holo.kind !== "board") return basicTokens(holo.text)
    const lines = board(holo)
    const title = holo.title ? basicTokens(holo.title) : ""
    return title ? [title, ...lines].join("\n") : lines.join("\n")
}

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

// ------------------------------------------------------------- the entities

function dimensionsToSearch() {
    const types = safe(() => DimensionTypes.getAll(), []) ?? []
    const ids = types.map(t => t.typeId).filter(Boolean)
    return (ids.length ? ids : ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"])
        .map(id => safe(() => world.getDimension(id)))
        .filter(Boolean)
}

/** Every hologram entity currently loaded, whichever dimension it is in. */
function entities(id) {
    const found = []
    for (const dimension of dimensionsToSearch()) {
        const list = safe(() => dimension.getEntities({ type: TYPE }), []) ?? []
        for (const entity of list) {
            if (id && !safe(() => entity.hasTag(`${TAG}:${id}`), false)) continue
            found.push(entity)
        }
    }
    return found
}

function despawn(id) {
    for (const entity of entities(id)) safe(() => entity.remove())
}

/**
 * Make the world match the records.
 *
 * Spawns anything missing, re-labels what is there, and removes strays whose
 * record is gone. Called on a slow loop, so a hologram that gets killed comes
 * back on its own rather than needing anybody to notice.
 */
export function sync() {
    const wanted = new Map(list().map(h => [h.id, h]))
    const seen = new Set()

    for (const entity of entities()) {
        const tag = (safe(() => entity.getTags(), []) ?? []).find(t => t.startsWith(`${TAG}:`))
        const id = tag ? tag.slice(TAG.length + 1) : undefined
        const holo = id ? wanted.get(id) : undefined
        if (!holo) { safe(() => entity.remove()); continue }   // orphan
        if (seen.has(id)) { safe(() => entity.remove()); continue }   // duplicate
        seen.add(id)
        safe(() => { entity.nameTag = render(holo) })
    }

    for (const holo of wanted.values()) {
        if (seen.has(holo.id)) continue

        let dimension
        try {
            dimension = world.getDimension(holo.dimension)
        } catch (e) {
            report(holo.id, `no dimension "${holo.dimension}": ${e}`)
            continue
        }

        let entity
        try {
            entity = dimension.spawnEntity(TYPE, { x: holo.x, y: holo.y, z: holo.z })
        } catch (e) {
            // A chunk that is not loaded is normal and temporary; anything else
            // means the entity itself is wrong, and that is worth shouting about.
            report(holo.id, `could not spawn ${TYPE} at ${holo.x} ${holo.y} ${holo.z}: ${e}`)
            continue
        }
        if (!entity) { report(holo.id, "spawnEntity returned nothing"); continue }

        try {
            entity.addTag(`${TAG}:${holo.id}`)
            entity.nameTag = render(holo)
            console.log(`[Admin+] hologram "${holo.id}" placed at ${holo.x} ${holo.y} ${holo.z}`)
        } catch (e) {
            report(holo.id, `spawned but could not be labelled: ${e}`)
        }
    }
}

/**
 * Report a hologram failure once per reason, not once per sync.
 *
 * The loop runs every two seconds; a broken hologram would otherwise fill the
 * content log with the same line and bury everything else in it.
 */
const reported = new Set()
function report(id, message) {
    const key = `${id}:${message}`
    if (reported.has(key)) return
    reported.add(key)
    console.error(`[Admin+] hologram "${id}": ${message}`)
}

/** Refresh rate: slow enough to be free, fast enough that a score looks live. */
const SYNC_TICKS = 40

export function installHolograms() {
    system.run(() => safe(() => sync()))
    system.runInterval(() => safe(() => sync()), SYNC_TICKS)
    console.log("[Admin+] holograms ready")
    return true
}

export { TYPE as HOLOGRAM_TYPE, TAG as HOLOGRAM_TAG }
