import { setting, flag } from "./settings.js"

// Lag clearing, designed around the thing that goes wrong.
//
// The usual /lagclear removes "everything that isn't a player", and takes with
// it: tamed wolves, named mobs, villagers, item frames, boats, minecarts, mobs
// on leads, and whatever entities other addons rely on. People lose things they
// cannot get back, and the addon gets blamed — correctly.
//
// So this is a WHITELIST. It can only remove entity types that are named here.
// Anything unknown — including entities belonging to other packs — is left
// alone by construction, not by remembering to exclude it.
//
// 2.12.17 (the user: "upgrade lag-clear to make insanely better ... super
// complex and advanced behind the scenes while simple to use"). This file is the
// thinking, and it touches no game object, so every decision is tested without a
// world; features/cleanup.js does the work. What it decides:
//
//   AGE        items that dropped in the last `cleanup.minAge` seconds stay, so
//              nobody loses what they just dropped. Ages come from the spawn
//              event; something seen before Admin+ loaded counts as old.
//   DEATHS     what a player drops when they die is theirs for
//              `cleanup.deathKeep` minutes, wherever it lands.
//   KEEPERS    named, renamed, enchanted, valuable, or tagged to keep: never.
//   MERGING    identical plain drops lying close together become full stacks
//              before anything is removed. Lossless: 300 cobblestone entities
//              become five, with every block still there.
//   LOAD       a cost per entity, summed per chunk, so the report can say WHERE
//              the server is struggling and what is doing it.
//   MOB LIMIT  optional: at most `cleanup.mobCap` of one farm animal or monster
//              per chunk. A short whitelist, and never a named, tamed, leashed
//              or ridden mob.
//   SPEED      ticks per second from real tick timing, the honest measure of
//              "the server is lagging".
//   AUTO       when to clear by itself: lots of clutter, or a slow server with
//              clutter to blame, and never more than once in five minutes.

/** The only things that can ever be removed, grouped so each can be switched off. */
export const GROUPS = {
    items: {
        key: "cleanup.items",
        label: "Dropped items",
        types: ["minecraft:item"]
    },
    xp: {
        key: "cleanup.xp",
        label: "XP orbs",
        types: ["minecraft:xp_orb"]
    },
    projectiles: {
        key: "cleanup.projectiles",
        label: "Spent projectiles",
        // Not here, on purpose (2.12.17): a thrown trident is somebody's
        // trident, an ender pearl can be waiting in a stasis chamber, and a
        // fishing hook belongs to someone fishing, AFK farms included.
        types: [
            "minecraft:arrow", "minecraft:snowball", "minecraft:egg",
            "minecraft:splash_potion", "minecraft:lingering_potion",
            "minecraft:experience_bottle"
        ]
    },
    fallingBlocks: {
        key: "cleanup.fallingBlocks",
        label: "Falling blocks",
        types: ["minecraft:falling_block"]
    }
}

/**
 * Item types worth protecting even when they are lying on the floor. Someone
 * died and is running back for these.
 */
const DEFAULT_VALUABLES = [
    "shulker_box", "elytra", "totem_of_undying", "netherite_", "enchanted_golden_apple",
    "dragon_egg", "beacon", "heart_of_the_sea", "nether_star", "trident", "mace"
]

/**
 * Items whose details live where the script API can't read them (a map's id, a
 * firework's flight, a tipped arrow's effect, a banner's pattern, a bundle's
 * contents). "Bring back the last clear" could only return a plain copy, so a
 * lag clear leaves them alone.
 */
export const HIDDEN_DATA_ITEMS = new Set([
    "minecraft:filled_map", "minecraft:firework_rocket", "minecraft:firework_star", "minecraft:banner",
    "minecraft:arrow", "minecraft:ominous_bottle", "minecraft:written_book", "minecraft:writable_book",
    "minecraft:potion", "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:suspicious_stew",
    "minecraft:goat_horn", "minecraft:bundle", "minecraft:shield", "minecraft:crossbow", "minecraft:lodestone_compass"
])

export function valuables() {
    const raw = String(setting("cleanup.keep") ?? "").trim()
    if (!raw) return [...DEFAULT_VALUABLES]
    return raw.split(",").map(s => s.trim().replace("minecraft:", "")).filter(Boolean)
}

/** Which groups are currently switched on. */
export function activeGroups() {
    return Object.values(GROUPS).filter(g => flag(g.key))
}

/** Every entity type the current settings allow removing. */
export function removableTypes() {
    return activeGroups().flatMap(g => g.types)
}

function numberSetting(key, fallback, min = 0) {
    const value = Number(setting(key))
    return Number.isFinite(value) && value >= min ? value : fallback
}

export function warnSeconds() { return Math.round(numberSetting("cleanup.warn", 5)) }
export function minAgeSeconds() { return numberSetting("cleanup.minAge", 30) }
export function deathKeepMinutes() { return numberSetting("cleanup.deathKeep", 5) }
export function autoAt() { return Math.round(numberSetting("cleanup.autoAt", 1500, 50)) }
export function mobCap() { return Math.round(numberSetting("cleanup.mobCap", 0)) }

// ------------------------------------------------------------------ age

/** entity id -> when it was first seen, ms. */
const seen = new Map()

export function noteSeen(id, at = Date.now()) {
    if (id && !seen.has(id)) seen.set(id, at)
}

/** Carry an age over to a new entity (a merged stack keeps the oldest age). */
export function setSeen(id, at) { if (id) seen.set(id, at) }

/**
 * Ms on the ground. Something Admin+ has never seen counts as new from the
 * moment it is first seen (3.0.0): after a restart, or when a chunk loads,
 * nobody loses a drop to a clear in the first `cleanup.minAge` seconds.
 */
export function ageOf(id, now = Date.now()) {
    if (!id) return Infinity
    const at = seen.get(id)
    if (at === undefined) { seen.set(id, now); return 0 }
    return Math.max(0, now - at)
}

export function firstSeen(id) { return seen.get(id) }

/** Forget entities that are gone, so the map never grows past what exists. */
export function forgetMissing(liveIds, now = Date.now()) {
    const keep = new Set(liveIds)
    for (const id of [...seen.keys()]) if (!keep.has(id)) seen.delete(id)
    for (const id of [...stackVerdicts.keys()]) if (!keep.has(id)) stackVerdicts.delete(id)
    // Shields run out on their own clock, never because an item is out of
    // sight: its chunk unloads while the owner respawns far away (3.0.0).
    for (const [id, until] of [...shielded]) if (until <= now) shielded.delete(id)
}

// --------------------------------------------------------------- deaths

/** Recent player deaths: { dimension, x, y, z, at }. */
const deaths = []
/** entity id -> protected until, ms. */
const shielded = new Map()

/** How far from where somebody died their things can land, and how long after. */
const DEATH_RADIUS = 8
const DEATH_WINDOW_MS = 3000

/**
 * Drops that appeared in the last few seconds. Nothing documents whether the
 * game reports a player's death before or after the items it drops, so a
 * death checks these as well, and the order doesn't matter.
 */
const recentDrops = []

function nearDeath(death, drop) {
    return death.dimension === drop.dimension && Math.abs(drop.at - death.at) <= DEATH_WINDOW_MS
        && Math.hypot(drop.x - death.x, drop.y - death.y, drop.z - death.z) <= DEATH_RADIUS
}

/** A player died here. Shields anything already dropped around them; returns how many. */
export function noteDeath(dimension, location, at = Date.now()) {
    const death = { dimension, x: location.x, y: location.y, z: location.z, at }
    deaths.push(death)
    while (deaths.length > 50) deaths.shift()
    const minutes = deathKeepMinutes()
    if (!minutes) return []
    const caught = []
    for (const drop of recentDrops) {
        if (nearDeath(death, drop)) { shielded.set(drop.id, drop.at + minutes * 60 * 1000); caught.push(drop.id) }
    }
    return caught
}

/**
 * Something droppable appeared (an item or an XP orb): did a death just
 * happen beside it? Then it is shielded for `cleanup.deathKeep` minutes.
 */
export function shieldIfDeathDrop(id, dimension, location, at = Date.now()) {
    const minutes = deathKeepMinutes()
    if (!id || !minutes) return false
    const drop = { id, dimension, x: location.x, y: location.y, z: location.z, at }
    recentDrops.push(drop)
    while (recentDrops.length && (at - recentDrops[0].at > DEATH_WINDOW_MS || recentDrops.length > 2000)) recentDrops.shift()
    const hit = deaths.some(d => nearDeath(d, drop))
    if (hit) shielded.set(id, at + minutes * 60 * 1000)
    return hit
}

export function shieldUntil(id) { return shielded.get(id) }
export function setShield(id, until) { if (id && until) shielded.set(id, until) }

export function isShielded(id, now = Date.now()) {
    const until = shielded.get(id)
    return until !== undefined && until > now
}

/**
 * A shield also rides on the item as a tag (3.0.0), so it outlives the
 * script's memory: a /reload, a restart, or the chunk unloading.
 */
export const SHIELD_TAG = "ap:keepuntil:"
export function shieldTag(until) { return SHIELD_TAG + Math.round(until) }
export function tagShieldUntil(tags) {
    let until = 0
    for (const t of tags ?? []) {
        if (typeof t === "string" && t.startsWith(SHIELD_TAG)) until = Math.max(until, Number(t.slice(SHIELD_TAG.length)) || 0)
    }
    return until
}

/**
 * Items a saved copy can't hold, by RULE rather than by list, so a server's
 * own valuables list can't switch it off and new items fail safe (2.12.17's
 * exact list missed the dyed bundles). Bring back would return these empty,
 * without their bees, untrimmed, undyed or missing another add-on's data.
 */
export function keepsHiddenData(stack) {
    const id = String(stack?.typeId ?? "")
    if (!id) return false
    if (HIDDEN_DATA_ITEMS.has(id)) return true
    const name = id.replace(/^minecraft:/, "")
    if (/shulker_box|bundle$|^bee_nest$|^beehive$|^enchanted_book$/.test(name)) return true
    if (/(helmet|chestplate|leggings|boots|horse_armor|wolf_armor)$/.test(name)) return true
    if (!id.startsWith("minecraft:") && Number(stack.maxAmount) === 1) return true
    try { if (stack.getComponent?.("minecraft:inventory")) return true } catch { return true }
    return false
}

// ---------------------------------------------------------------- judging

/**
 * Decide whether one entity may be removed.
 *
 * Deliberately paranoid: every reason to keep something is checked before the
 * one reason to remove it.
 *
 * @param {object} entity a real Entity, or a plain object in tests
 * @returns {{remove: boolean, reason: string}}
 */
export function judge(entity, now = Date.now()) {
    if (!entity) return { remove: false, reason: "gone" }

    const typeId = entity.typeId ?? ""
    if (!removableTypes().includes(typeId)) {
        return { remove: false, reason: "not on the list" }
    }

    // A named anything is somebody's. This also covers name-tagged drops.
    if (entity.nameTag) return { remove: false, reason: "named" }

    // Tags are how servers and other addons mark things to keep.
    const tags = safeTags(entity)
    if (tags.some(t => /^(keep|persist|admin:keep|nolagclear)$/i.test(t))) {
        return { remove: false, reason: "tagged to keep" }
    }

    if (isShielded(entity.id, now) || tagShieldUntil(tags) > now) return { remove: false, reason: "from a death" }

    if (typeId === "minecraft:item") {
        const kept = stackVerdict(entity)
        if (kept) return { remove: false, reason: kept }
    }

    // Falling blocks are mid-fall; age means nothing for them.
    if (typeId !== "minecraft:falling_block" && ageOf(entity.id, now) < minAgeSeconds() * 1000) {
        return { remove: false, reason: "just dropped" }
    }

    return { remove: true, reason: "clutter" }
}

/**
 * What an item's stack says, read once per entity (3.0.0). A stack lying on
 * the ground can't be renamed or enchanted, and the check every 20 seconds
 * would otherwise read every stack's name, enchantments and lore again. The
 * valuables list is a setting that can change, so it is checked every time,
 * from the remembered type.
 */
const stackVerdicts = new Map()   // entity id -> { reason, type }
function stackVerdict(entity) {
    const id = entity.id
    let verdict = id ? stackVerdicts.get(id) : undefined
    if (!verdict) {
        const stack = safeStack(entity)
        const reason = stack?.nameTag ? "renamed item"
            : enchantsOf(stack).length ? "enchanted"
            : loreOf(stack).length ? "has lore"
            : keepsHiddenData(stack) ? "can't be brought back exactly" : ""
        verdict = { reason, type: String(stack?.typeId ?? "").replace("minecraft:", "") }
        if (id && stack) stackVerdicts.set(id, verdict)
    }
    if (verdict.reason) return verdict.reason
    if (verdict.type && valuables().some(v => verdict.type.includes(v))) return "valuable"
    return ""
}

function safeTags(entity) {
    try { return entity.getTags?.() ?? [] } catch { return [] }
}

export function safeStack(entity) {
    try { return entity.getComponent?.("minecraft:item")?.itemStack } catch { return undefined }
}

function enchantsOf(stack) {
    try { return stack?.getComponent?.("minecraft:enchantable")?.getEnchantments?.() ?? [] } catch { return [] }
}

function loreOf(stack) {
    try { return stack?.getLore?.() ?? [] } catch { return [] }
}

/** Why things were kept, counted: { "just dropped": 12, valuable: 3 }. */
export function keptReasons(entities, now = Date.now()) {
    const out = {}
    for (const entity of entities) {
        const verdict = judge(entity, now)
        if (!verdict.remove) out[verdict.reason] = (out[verdict.reason] ?? 0) + 1
    }
    return out
}

// ---------------------------------------------------------------- merging

/** The cube merged stacks share, in blocks: close enough that nobody notices. */
export const MERGE_CELL = 4

/**
 * What makes two stacks the same, or null when a stack must never be merged:
 * named, enchanted, with lore, damaged, or one that doesn't stack.
 */
export function stackSignature(stack) {
    if (!stack?.typeId) return null
    const max = Number(stack.maxAmount ?? 64)
    if (!(max > 1)) return null
    if (stack.nameTag) return null
    if (enchantsOf(stack).length || loreOf(stack).length) return null
    let damage = 0
    try { damage = Number(stack.getComponent?.("minecraft:durability")?.damage ?? 0) } catch { damage = 0 }
    if (damage > 0) return null
    return stack.typeId
}

/**
 * Plan merges. `items`: [{ id, dimension, x, y, z, typeId, amount, max, sig }].
 * Returns one plan per group worth merging:
 *   { dimension, at: {x, y, z}, typeId, stacks: [amount, ...], remove: [ids], ids }
 * where `stacks` are the new full stacks (the last may be partial). A group is
 * merged only when it would end with fewer entities than it has.
 */
export function planMerges(items) {
    const groups = new Map()
    for (const item of items) {
        if (!item?.sig || !(item.amount > 0)) continue
        const key = [item.dimension, Math.floor(item.x / MERGE_CELL), Math.floor(item.y / MERGE_CELL),
            Math.floor(item.z / MERGE_CELL), item.sig].join("|")
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(item)
    }
    const plans = []
    for (const members of groups.values()) {
        if (members.length < 2) continue
        const max = Math.max(1, Math.min(...members.map(m => m.max || 64)))
        const total = members.reduce((sum, m) => sum + m.amount, 0)
        const needed = Math.ceil(total / max)
        if (needed >= members.length) continue
        const stacks = []
        for (let left = total; left > 0; left -= max) stacks.push(Math.min(max, left))
        const at = {
            x: members.reduce((s, m) => s + m.x, 0) / members.length,
            y: Math.max(...members.map(m => m.y)),
            z: members.reduce((s, m) => s + m.z, 0) / members.length
        }
        plans.push({ dimension: members[0].dimension, at, typeId: members[0].typeId, stacks, remove: members.map(m => m.id) })
    }
    return plans
}

// ------------------------------------------------------------------- load

/**
 * Roughly what one entity costs the server, in "dropped items". Mobs think and
 * pathfind every tick, so they cost several times an item; a villager, which
 * also searches for beds and work, costs more again.
 */
const COST = {
    "minecraft:item": 1, "minecraft:xp_orb": 1, "minecraft:arrow": 0.8, "minecraft:falling_block": 2,
    "minecraft:tnt": 8, "minecraft:minecart": 2, "minecraft:hopper_minecart": 4, "minecraft:chest_minecart": 3,
    "minecraft:tnt_minecart": 6, "minecraft:boat": 1.5, "minecraft:chest_boat": 2, "minecraft:armor_stand": 1,
    // No item frames: on Bedrock they are blocks, so no entity scan sees them.
    "minecraft:painting": 0.2,
    "minecraft:villager": 8, "minecraft:villager_v2": 8, "minecraft:iron_golem": 4, "minecraft:wandering_trader": 6
}

/** Cost of one entity. `isMob` says whether it has health (it thinks, so it costs). */
export function costOf(typeId, isMob = false) {
    if (typeId in COST) return COST[typeId]
    return isMob ? 4 : 1.5
}

const DIMENSION_NAMES = { "minecraft:overworld": "Overworld", "minecraft:nether": "Nether", "minecraft:the_end": "The End" }
export function dimensionName(id) { return DIMENSION_NAMES[id] ?? String(id ?? "").replace("minecraft:", "") }

/**
 * The busiest chunks. `entities`: [{ dimension, x, z, typeId, isMob }].
 * Returns [{ dimension, cx, cz, load, count, center: {x, z}, top: [{type, count}] }],
 * heaviest first.
 */
export function hotspots(entities, limit = 5) {
    const chunks = new Map()
    for (const e of entities) {
        const cx = Math.floor(e.x / 16), cz = Math.floor(e.z / 16)
        const key = `${e.dimension}|${cx}|${cz}`
        let chunk = chunks.get(key)
        if (!chunk) {
            chunk = { dimension: e.dimension, cx, cz, load: 0, count: 0, sx: 0, sz: 0, types: new Map() }
            chunks.set(key, chunk)
        }
        chunk.load += costOf(e.typeId, e.isMob)
        chunk.count++
        chunk.sx += e.x
        chunk.sz += e.z
        const type = String(e.typeId ?? "unknown").replace("minecraft:", "")
        chunk.types.set(type, (chunk.types.get(type) ?? 0) + 1)
    }
    return [...chunks.values()]
        .sort((a, b) => b.load - a.load)
        .slice(0, limit)
        .map(c => ({
            dimension: c.dimension, cx: c.cx, cz: c.cz, load: Math.round(c.load), count: c.count,
            center: { x: Math.round(c.sx / c.count), z: Math.round(c.sz / c.count) },
            top: [...c.types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => ({ type, count }))
        }))
}

// -------------------------------------------------------------- mob limit

/**
 * The only mobs a limit can ever thin out: farm animals and common monsters.
 * Not here, never touched: villagers, golems, traders, pets, horses, bees,
 * axolotls, anything rare, and every mob another pack adds.
 */
export const MOB_LIMIT_TYPES = new Set([
    "minecraft:chicken", "minecraft:cow", "minecraft:pig", "minecraft:sheep", "minecraft:rabbit",
    "minecraft:mooshroom", "minecraft:goat",
    "minecraft:zombie", "minecraft:husk", "minecraft:drowned", "minecraft:skeleton", "minecraft:stray",
    "minecraft:creeper", "minecraft:spider", "minecraft:cave_spider", "minecraft:slime", "minecraft:magma_cube",
    "minecraft:zombie_pigman", "minecraft:enderman", "minecraft:guardian", "minecraft:blaze", "minecraft:witch",
    "minecraft:phantom", "minecraft:silverfish", "minecraft:endermite"
])

/**
 * Which mobs to remove so no chunk holds more than `cap` of one type.
 * `mobs`: [{ id, dimension, x, z, typeId, keep }], `keep` true for named,
 * tamed, leashed, ridden or tagged mobs: those count toward the limit but are
 * never removed.
 */
export function planMobLimit(mobs, cap) {
    if (!(cap > 0)) return []
    const groups = new Map()
    for (const mob of mobs) {
        if (!MOB_LIMIT_TYPES.has(mob.typeId)) continue
        const key = `${mob.dimension}|${Math.floor(mob.x / 16)}|${Math.floor(mob.z / 16)}|${mob.typeId}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(mob)
    }
    const out = []
    for (const members of groups.values()) {
        let excess = members.length - cap
        if (excess <= 0) continue
        for (const mob of members) {
            if (excess <= 0) break
            if (mob.keep) continue
            out.push(mob.id)
            excess--
        }
    }
    return out
}

// ------------------------------------------------------------------ speed

/**
 * Ticks per second from tick times (ms, oldest first). 20 is a healthy server.
 * Returns { tps, mspt, worst } where mspt is the average milliseconds per tick
 * and worst the longest single tick.
 */
export function speedFrom(times) {
    if (!times || times.length < 2) return { tps: 20, mspt: 50, worst: 50 }
    const span = times[times.length - 1] - times[0]
    const ticks = times.length - 1
    let worst = 0
    for (let i = 1; i < times.length; i++) worst = Math.max(worst, times[i] - times[i - 1])
    const mspt = span / ticks
    return { tps: Math.min(20, Math.round((1000 / Math.max(1, mspt)) * 10) / 10), mspt: Math.round(mspt), worst: Math.round(worst) }
}

// ------------------------------------------------------------------- auto

/** At least this long between automatic clears. */
export const AUTO_GAP_MS = 5 * 60 * 1000
/** A slow server needs at least this much clutter before clearing is worth it. */
export const AUTO_SLOW_CLUTTER = 300
/** And this many slow checks in a row (20 seconds apart): a minute of slowness. */
export const AUTO_SLOW_CHECKS = 3

/**
 * Should an automatic clear start now?
 * @param {{clutter: number, tps: number, slowChecks: number, lastAuto: number, running: boolean, now: number}} s
 * @returns {{go: boolean, why?: string}}
 */
export function shouldAutoClear(s) {
    if (s.running) return { go: false }
    const since = s.now - (s.lastAuto ?? 0)
    if (s.clutter >= autoAt() && since >= AUTO_GAP_MS) return { go: true, why: "clutter" }
    // A clear for a slow server that didn't help means the lag is elsewhere:
    // each one that fails doubles the wait, 5, 10, 20, then 40 minutes (3.0.0).
    const slowGap = AUTO_GAP_MS * 2 ** Math.min(3, s.slowLevel ?? 0)
    if (s.slowChecks >= AUTO_SLOW_CHECKS && s.clutter >= AUTO_SLOW_CLUTTER && since >= slowGap) return { go: true, why: "slow" }
    return { go: false }
}

/** After a clear for a slow server: still slow backs off one step, recovered starts over. */
export function nextSlowLevel(level, tpsAfter) {
    return tpsAfter < 15 ? Math.min(3, (level ?? 0) + 1) : 0
}

// ---------------------------------------------------------------- tallies

/**
 * Tally what is out there, so staff can see the actual cause before deciding.
 * Counting is separate from removing on purpose: often the answer is "you have
 * 2,000 chickens in a farm", which clearing dropped items will not fix.
 */
export function tally(entities, { amounts = false } = {}) {
    const counts = new Map()
    for (const entity of entities) {
        const { kind, amount } = entity?.kind ? entity : kindOf(entity)
        counts.set(kind, (counts.get(kind) ?? 0) + (amounts ? amount : 1))
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }))
}

/**
 * What one entity is called in a count: a dropped item by the item it holds,
 * so a player reads "cobblestone", not "item". Taken BEFORE removal, because
 * a removed entity can no longer be read.
 */
export function kindOf(entity) {
    const type = String(entity?.typeId ?? "unknown")
    if (type === "minecraft:item") {
        const stack = safeStack(entity)
        if (stack?.typeId) return { kind: String(stack.typeId).replace(/^minecraft:/, ""), amount: Number(stack.amount) || 1 }
    }
    return { kind: type.replace(/^minecraft:/, ""), amount: 1 }
}

/** The word a player knows for an entity id; items keep their own names. */
const KIND_WORDS = {
    item: "dropped item", xp_orb: "XP orb", falling_block: "falling block",
    experience_bottle: "bottle o' enchanting", splash_potion: "splash potion",
    lingering_potion: "lingering potion", villager_v2: "villager",
    zombie_villager_v2: "zombie villager", zombie_pigman: "zombified piglin",
    thrown_trident: "trident", fishing_hook: "fishing hook"
}

export function kindName(kind) {
    return KIND_WORDS[kind] ?? String(kind).replace(/_/g, " ")
}

/** "cobblestone ×320, XP orb ×12", the way the game shows a stack. */
export function describeTally(rows, limit = 6) {
    if (!rows.length) return "nothing else"
    const shown = rows.slice(0, limit).map(r => `${kindName(r.type)} ×${r.count}`)
    const more = rows.length - shown.length
    return shown.join(", ") + (more > 0 ? ` and ${more} more ${more === 1 ? "kind" : "kinds"}` : "")
}

/** Testing seam. */
export function __resetCleanup() {
    seen.clear()
    shielded.clear()
    deaths.length = 0
    recentDrops.length = 0
    stackVerdicts.clear()
}
