import { world, system } from "@minecraft/server"
import { flag, setting, nameTagsEnabled } from "../core/settings.js"
import { refreshNameTag, effectiveNametagStyle } from "../core/ranks.js"
import { advanceFrame, STYLES } from "../core/nametag.js"

// The clock behind a colour that travels along a nametag.
//
// The palettes and the painting live in core/nametag.js; who gets which style
// lives on the rank. This is only the tick that moves the wave along, and it is
// its own file because it is the one part with a running cost.
//
// **There is already a nametag timer and this is not it.** main.js re-stamps
// every player's nametag every 100 ticks, because nametags are per-player state
// a rejoin can clear. Five seconds is the right period for "make sure it is
// still there" and useless for animation, and dropping THAT interval to three
// ticks would have made every player on the server pay for a feature almost
// none of them are using. So: a second timer that does nothing at all unless
// somebody is actually wearing a style.

/** Ticks between steps. Smaller is faster; one step is one character. */
function speed() {
    const raw = Number(setting("namecolour.speed"))
    if (!Number.isFinite(raw)) return 3
    // Floor of 1 because 0 would repaint every tick for no visible gain, and
    // a negative would make `% step` throw the wave into reverse at random.
    return Math.max(1, Math.min(40, Math.floor(raw)))
}

let ticks = 0

/**
 * One step of the wave, for everybody wearing one.
 *
 * Exported so the test can drive it without a scheduler.
 *
 * The frame advances ONCE for everyone rather than per player — two people
 * standing together on the same style must shimmer in step, or it reads as a
 * fault rather than as an effect. That is also why the counter lives in
 * core/nametag.js beside the painting rather than here.
 */
export function stepNameAnimation(players) {
    advanceFrame()
    let painted = 0
    for (const player of players) {
        // Ask BEFORE doing any work: on a realm where one donor rank has a
        // colour, this skips everybody else for the cost of a lookup.
        //
        // effectiveNametagStyle, not nametagStyleFor. The narrower one asks
        // only the rank, and the creator's colour does not come from a rank —
        // so this loop skipped them every frame and their name sat frozen on
        // whatever frame last painted it.
        // A single still colour never changes, so it is painted when the
        // nametag is drawn and skipped here.
        const style = effectiveNametagStyle(player)
        if (style === "none" || STYLES[style]?.still) continue
        refreshNameTag(player)
        painted++
    }
    return painted
}

export function installNameAnimation() {
    system.runInterval(() => {
        // Three cheap gates before anything is iterated. The last one matters
        // most: with the feature on and nobody using it, this costs one
        // settings read and one modulo per tick.
        if (!nameTagsEnabled()) return
        if (!flag("feature.namecolour")) return
        if (++ticks % speed() !== 0) return
        try {
            stepNameAnimation(world.getAllPlayers())
        } catch { /* a player left mid-paint; the next step covers it */ }
    }, 1)
    return true
}
