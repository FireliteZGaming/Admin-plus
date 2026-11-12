import { Table, cleanId } from "./storage.js"

// Cosmetic tags: a word beside somebody's name, and nothing else.
//
// Asked for on 2026-11-11: "cosmetic tags, so these don't get ranked in a
// hierarchy". A rank is authority — its place on the list decides who
// outranks whom and what they may use. A tag is decoration: [Builder],
// [Event Winner], [Artist]. It has no place in any order, carries no
// permissions, and holding one changes nothing about what you can do.
//
// So tags live here, apart from core/ranks.js, in their own two tables. Nothing
// in the rank engine reads them except renderTags, which draws them after a
// player's rank tags. This file imports nothing from ranks.js, so ranks.js can
// import it without a cycle.

const tags = new Table("tags", {})
/** playerId -> [tagId, ...], in the order they were given. */
const holders = new Table("tagHolders", {})

/** Every tag, sorted by name. There is no other order: tags are not ranked. */
export function allTags() {
    return Object.values(tags.data)
        .filter(tag => tag && typeof tag === "object")
        .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)))
}

export function getTag(id) { return tags.get(String(id ?? "")) }

/** The id a tag called `name` would get. */
export function tagIdFor(name) {
    return cleanId(String(name ?? "")).toLowerCase().replace(/\s+/g, "_")
}

/** Create or change a tag. `display` is how it shows; `name` is plain text. */
export function saveTag(id, { name, display }) {
    const tagId = tagIdFor(id)
    if (!tagId) return undefined
    const existing = tags.get(tagId)
    const tag = {
        id: tagId,
        name: String(name ?? existing?.name ?? tagId),
        display: String(display ?? existing?.display ?? `§7${name ?? tagId}`)
    }
    tags.set(tagId, tag)
    return tag
}

/** Delete a tag and take it off everybody who had it. */
export function deleteTag(id) {
    const tagId = String(id ?? "")
    if (!tags.has(tagId)) return false
    tags.delete(tagId)
    for (const [playerId, held] of holders.entries()) {
        if (!Array.isArray(held) || !held.includes(tagId)) continue
        const rest = held.filter(t => t !== tagId)
        if (rest.length) holders.set(playerId, rest)
        else holders.delete(playerId)
    }
    return true
}

/** The tags one player has, as tag objects, in the order they were given. */
export function tagsOf(playerId) {
    const held = holders.get(String(playerId ?? ""))
    return (Array.isArray(held) ? held : []).map(getTag).filter(Boolean)
}

/** How many players have this tag. */
export function holderCount(tagId) {
    return holders.entries().filter(([, held]) => Array.isArray(held) && held.includes(tagId)).length
}

export function giveTag(playerId, tagId) {
    if (!tags.has(tagId)) return false
    const id = String(playerId ?? "")
    const held = holders.get(id) ?? []
    if (held.includes(tagId)) return false
    holders.set(id, [...held, tagId])
    return true
}

export function takeTag(playerId, tagId) {
    const id = String(playerId ?? "")
    const held = holders.get(id) ?? []
    if (!held.includes(tagId)) return false
    const rest = held.filter(t => t !== tagId)
    if (rest.length) holders.set(id, rest)
    else holders.delete(id)
    return true
}

/** Tests only. */
export function __resetTags() {
    tags.clear()
    holders.clear()
}
