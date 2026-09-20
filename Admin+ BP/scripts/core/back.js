import { Table } from "./storage.js"
import { flag } from "./settings.js"

// Where you were before the last thing that moved you.
//
// **Dropped on purpose in 1.x, asked for back on 2026-09-20.** The third entry
// off that list, after `bring` and homes. Recorded here rather than only in a
// changelog because CLAUDE.md still lists /back among the things not to build
// unasked, and the difference between "missing" and "removed" is the whole
// reason that list exists.
//
// TWO THINGS PUT A MARK DOWN, and they are not equally important:
//
//   a teleport   warp, spawn, home, rtp, an accepted TPA. Convenient.
//   a DEATH      where your things are. This is the one people actually want,
//                and it is the reason /back is worth having at all.
//
// So a death mark is never quietly replaced by a teleport mark: dying and then
// warping to spawn must not lose the coordinates of your stuff. A teleport only
// overwrites another teleport.
//
// PERSISTED, unlike cooldowns. A cooldown exists to slow somebody down and has
// no business surviving a restart; a death position is the location of an
// hour's work, and a world reload between dying and getting back would be
// exactly when losing it hurts most. One small record per player, in the shape
// homes already uses.

const BACK_KEY = "back"

const marks = new Table(BACK_KEY, {})

/**
 * @typedef {{
 *   x: number, y: number, z: number, dimension: string,
 *   at: number, death: boolean
 * }} Mark
 */

/** Where this player was, or undefined. */
export function lastPlace(playerId) {
    const mark = marks.get(String(playerId ?? ""))
    return mark && typeof mark === "object" ? mark : undefined
}

/**
 * Put a mark down.
 *
 * `death` marks outrank teleport marks and are not overwritten by them —
 * see the note at the top. A death always replaces whatever was there.
 */
export function mark(player, { death = false } = {}) {
    if (!flag("feature.back")) return undefined
    const at = player?.location
    if (!at || !player?.id) return undefined

    const existing = lastPlace(player.id)
    if (!death && existing?.death) return existing

    /** @type {Mark} */
    const record = {
        // Centred in the block, like every other place this pack sends people.
        x: Math.floor(at.x) + 0.5,
        y: Math.floor(at.y),
        z: Math.floor(at.z) + 0.5,
        dimension: player?.dimension?.id ?? "minecraft:overworld",
        at: Date.now(),
        death
    }
    marks.set(player.id, record)
    return record
}

/**
 * Take the mark, and clear it.
 *
 * **Cleared on use, deliberately.** Leaving it would make /back a two-way
 * shuttle — go back, then back again, then back again — which is a movement
 * system rather than an undo. One trip per mark; the trip itself lays a new one
 * down, so /back immediately after /back returns you to where you started.
 */
export function takeLastPlace(playerId) {
    const mark = lastPlace(playerId)
    if (mark) marks.delete(String(playerId))
    return mark
}

export function clearLastPlace(playerId) { marks.delete(String(playerId)) }

/** Tests only. */
export function __resetBack() { marks.clear() }
