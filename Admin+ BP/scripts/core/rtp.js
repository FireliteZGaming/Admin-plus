import { setting } from "./settings.js"

// Random teleport: drop somewhere you have not been.
//
// **The whole feature is the safety check.** Picking a random X and Z is one
// line; the work is not dropping somebody into lava, into the void, inside a
// mountain, or onto the Nether's bedrock ceiling — and doing it without reading
// blocks in chunks that are not loaded, which throws.
//
// The technique was settled by reading the packs installed on this machine
// rather than guessed at, the way module versions are. Soulbound Essentials
// does the same job and the shape it uses is the shape that works:
//
//   1. a probe read at y=0 says whether the column is loaded at all — an
//      unloaded chunk returns undefined rather than throwing, so it is the
//      cheapest possible "is this candidate usable"
//   2. the overworld has a topmost block; the Nether does not, because its
//      ceiling IS a block, so a roofed dimension has to be scanned DOWNWARD
//      from under the roof
//   3. the landing rule is the same either way: solid, not liquid, air above
//   4. `tryTeleport` with `checkForBlocks` is the final word — it refuses
//      rather than suffocating somebody, and it returns whether it went
//
// No files of theirs ship here; this is the technique, written again.

/** The Nether's ceiling is bedrock, so "topmost block" is the roof. */
const ROOFED = new Set(["minecraft:nether"])

/** Where the downward scan starts in a roofed dimension, and where it stops. */
const ROOF_SCAN_FROM = 120
const ROOF_SCAN_TO = 32

export function rtpRange() {
    const raw = Number(setting("rtp.range"))
    return Number.isFinite(raw) && raw >= 64 ? Math.trunc(raw) : 4000
}

export function rtpMinimum() {
    const raw = Number(setting("rtp.minimum"))
    return Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 256
}

export function rtpTries() {
    const raw = Number(setting("rtp.tries"))
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), 64) : 24
}

/**
 * One candidate X/Z, in a ring around the origin.
 *
 * A RING, not a disc. A uniform square puts a quarter of all attempts near
 * spawn, which is exactly where somebody asking to be sent somewhere else does
 * not want to land — and on a realm it is also the most built-up ground, so
 * those attempts are the likeliest to fail the safety check anyway.
 *
 * `random` is injected so a test can drive the geometry instead of hoping.
 */
export function candidate(origin, range, minimum, random = Math.random) {
    const angle = random() * Math.PI * 2
    const span = Math.max(0, range - minimum)
    const distance = minimum + random() * span
    return {
        x: Math.floor((origin?.x ?? 0) + Math.cos(angle) * distance),
        z: Math.floor((origin?.z ?? 0) + Math.sin(angle) * distance)
    }
}

/** Solid ground with room to stand on it. */
function standable(block, above) {
    return !!block && !block.isAir && !block.isLiquid && !!above && above.isAir
}

/**
 * The Y to land on at this column, or undefined if there is nowhere.
 *
 * Every read is guarded. A block call can throw on an unloaded chunk even
 * after the probe passed — the chunk can go while the scan runs — and a throw
 * here would take the whole command with it rather than costing one candidate.
 */
export function landingY(dimension, x, z) {
    const read = y => { try { return dimension.getBlock({ x, y, z }) } catch { return undefined } }

    // Not loaded: no point reading anything else about it.
    if (read(0) === undefined) return undefined

    if (!ROOFED.has(String(dimension?.id ?? ""))) {
        let top
        try { top = dimension.getTopmostBlock({ x, y: 0, z }) } catch { top = undefined }
        if (!top) return undefined
        const above = read(top.location.y + 1)
        return standable(top, above) ? top.location.y : undefined
    }

    // Roofed: walk down from under the ceiling until something holds you up.
    for (let y = ROOF_SCAN_FROM; y >= ROOF_SCAN_TO; y--) {
        const here = read(y)
        const above = read(y + 1)
        if (standable(here, above)) return y
    }
    return undefined
}

/**
 * Find somewhere to drop this player. Returns `{x, y, z}` or undefined.
 *
 * Bounded by `rtp.tries` rather than looping until it succeeds: on a world of
 * ocean this would otherwise spin forever inside one tick and be killed by the
 * watchdog, which looks like the pack crashing rather than like the sea.
 */
export function findSpot(player, dimension, random = Math.random) {
    const range = rtpRange()
    const minimum = Math.min(rtpMinimum(), range)
    const origin = player?.location ?? { x: 0, z: 0 }

    for (let attempt = 0; attempt < rtpTries(); attempt++) {
        const { x, z } = candidate(origin, range, minimum, random)
        const y = landingY(dimension, x, z)
        // Centred in the block and one above the ground, like every other
        // teleport in this pack — a landing on an integer edge drops you
        // through the floor often enough to be worth the half.
        if (y !== undefined) return { x: x + 0.5, y: y + 1, z: z + 0.5 }
    }
    return undefined
}
