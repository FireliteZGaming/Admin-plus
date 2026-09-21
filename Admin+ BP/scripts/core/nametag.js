// Names that shift colour.
//
// Asked for on 2026-09-20: *"adding an ability to color shift a name like a
// rainbow or certain selective colors would be really nice, at least for the
// nametag, have it smooth as well"*.
//
// **Bedrock has no true RGB in a nametag.** There is no `§#FF8800`; there is a
// fixed palette — the sixteen legacy codes plus the twelve material ones added
// in 1.21.20 — and that is the whole of it. So "smooth" cannot mean interpolated
// colour, and anything promising a gradient between two arbitrary colours is
// lying about what the renderer can do.
//
// What it CAN mean, and what actually reads as smooth: hold a ramp of palette
// colours, paint one per character, and **move the ramp one step along the name
// each frame**. The colours stay discrete; the wave travels. The eye reads
// travelling colour as continuous even when each stop is a step, which is why
// every Java rainbow-name plugin looks fluid on a palette far smaller than this
// one.
//
// This file is deliberately ignorant of ranks. It knows palettes and how to
// paint a string, nothing else — core/ranks.js owns who gets which style and
// imports from here, so the dependency runs one way and there is no cycle.

/**
 * The material colour codes (`§g`–`§v`, minus the style letters) arrived in
 * 1.21.20 and are the reason these ramps do not look like every other rainbow
 * name: almost nothing uses them, because almost everything was written before
 * they existed.
 *
 *   §g minecoin gold   §h quartz    §i iron       §j netherite
 *   §m redstone        §n copper    §p gold       §q emerald
 *   §s diamond         §t lapis     §u amethyst   §v resin
 *
 * A ramp is a CYCLE: the last stop sits next to the first, because the frame
 * offset wraps. A ramp whose ends clash produces a visible seam travelling
 * along the name once per cycle, which is the one artefact that makes this look
 * broken rather than deliberate — so the ramps below either go round a wheel
 * (rainbow) or turn back on themselves (everything else).
 */
export const STYLES = {
    none: {
        label: "None",
        hint: "the name as it is written",
        ramp: ""
    },
    rainbow: {
        label: "Rainbow",
        hint: "round the wheel",
        // A hue wheel needs no mirror — magenta sits next to red already.
        ramp: "c6eab95d"
    },
    fire: {
        label: "Fire",
        hint: "embers up to white-hot",
        // 4 m c 6 p g e, then back down. Ends meet on two dark reds.
        ramp: "4mc6pgegp6cm"
    },
    ice: {
        label: "Ice",
        hint: "deep water to frost",
        // §s is diamond, the closest the palette gets to pale cyan.
        ramp: "13bsfsb3"
    },
    toxic: {
        label: "Toxic",
        hint: "acid green",
        ramp: "2qaeaq"
    },
    void: {
        label: "Void",
        hint: "amethyst out of the dark",
        ramp: "85udu5"
    },
    gold: {
        label: "Gold",
        hint: "a shine passing through, not a cycle",
        // Mostly one colour with a highlight travelling across it, which is
        // what makes it read as a sheen rather than as changing colour.
        ramp: "6666pgegp666"
    },
    sakura: {
        label: "Sakura",
        hint: "pink and white",
        ramp: "5dufud"
    },
    molten: {
        label: "Molten",
        hint: "ember to white-hot, using the 1.21.20 material colours",
        // **Frame 0 of this ramp on an eight-letter name is exactly the string
        // the creator chose**: §mF§4i§nr§ce§6l§pi§gt§ee — m 4 n c 6 p g e.
        // Their eight stops are the first eight here, in order, so the still
        // frame is the thing they picked and the animation is that thing
        // moving. The remaining six mirror it back down, because a ramp is a
        // cycle and `e` next to `m` would be a bright-to-dark seam travelling
        // along the name once per lap.
        ramp: "m4nc6pgegp6cn4"
    }
}

/** Ids in a stable order, for a dropdown that does not reshuffle itself. */
export const STYLE_IDS = Object.keys(STYLES)

/** A style by id, falling back to `none` rather than throwing. */
export function styleOf(id) {
    return STYLES[String(id ?? "none")] ?? STYLES.none
}

/**
 * Paint one colour per character, with the ramp shifted by `frame`.
 *
 * `text` must already be PLAIN. Painting over a string that carries its own `§`
 * codes interleaves two sets of them and renders as garbage — so the caller
 * strips first, and a player wearing an animated style gives up the colours in
 * their own nickname. That is a real trade and it is documented where the style
 * is chosen, not hidden here.
 *
 * The offset is SUBTRACTED so the wave travels left to right, the direction
 * text is read in. Written with an explicit non-negative modulo: JavaScript's
 * `%` keeps the sign of the left operand, so `(i - frame) % len` goes negative
 * the moment frame passes i, and `ramp[-1]` is undefined — which would paint a
 * literal `§undefined` into somebody's name. The same sign trap cost a flaky
 * `/rtp` test earlier today.
 */
export function paint(text, ramp, frame) {
    const plain = String(text ?? "")
    if (!ramp || !plain) return plain
    const len = ramp.length
    let out = ""
    for (let i = 0; i < plain.length; i++) {
        const ch = plain[i]
        // Spaces get no code: a colour on a space is two wasted characters and
        // it makes a multi-word name's wave stutter where the gap falls.
        if (ch === " ") { out += ch; continue }
        const at = (((i - frame) % len) + len) % len
        out += `§${ramp[at]}${ch}`
    }
    return out
}

/**
 * The frame counter, advanced by the animation tick.
 *
 * Module state rather than wall-clock: every animated player must be on the
 * SAME frame, or two people standing together shimmer out of step and it reads
 * as a fault rather than as an effect. One counter, one frame, everybody.
 */
let frame = 0

export function currentFrame() { return frame }
export function advanceFrame() { frame = (frame + 1) % 65536 }

/** Tests only. */
export function __resetFrames() { frame = 0 }
