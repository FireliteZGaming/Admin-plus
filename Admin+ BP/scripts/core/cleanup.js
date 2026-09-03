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
        types: [
            "minecraft:arrow", "minecraft:snowball", "minecraft:egg",
            "minecraft:thrown_trident", "minecraft:fishing_hook",
            "minecraft:splash_potion", "minecraft:lingering_potion",
            "minecraft:experience_bottle", "minecraft:ender_pearl"
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

export function warnSeconds() {
    const value = Number(setting("cleanup.warn"))
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 5
}

/**
 * Decide whether one entity may be removed.
 *
 * Deliberately paranoid: every reason to keep something is checked before the
 * one reason to remove it.
 *
 * @param {object} entity a real Entity, or a plain object in tests
 * @returns {{remove: boolean, reason: string}}
 */
export function judge(entity) {
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

    if (typeId === "minecraft:item") {
        const stack = safeStack(entity)
        if (stack?.nameTag) return { remove: false, reason: "renamed item" }
        const id = String(stack?.typeId ?? "").replace("minecraft:", "")
        if (id && valuables().some(v => id.includes(v))) {
            return { remove: false, reason: "valuable" }
        }
    }

    return { remove: true, reason: "clutter" }
}

function safeTags(entity) {
    try { return entity.getTags?.() ?? [] } catch { return [] }
}

function safeStack(entity) {
    try { return entity.getComponent?.("minecraft:item")?.itemStack } catch { return undefined }
}

/**
 * Tally what is out there, so staff can see the actual cause before deciding.
 * Counting is separate from removing on purpose: often the answer is "you have
 * 2,000 chickens in a farm", which clearing dropped items will not fix and this
 * will not touch.
 */
export function tally(entities) {
    const counts = new Map()
    for (const entity of entities) {
        const id = (entity?.typeId ?? "unknown").replace("minecraft:", "")
        counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }))
}

export function describeTally(rows, limit = 6) {
    if (!rows.length) return "nothing worth mentioning"
    return rows.slice(0, limit).map(r => `${r.count} ${r.type.replace(/_/g, " ")}`).join(", ")
}
