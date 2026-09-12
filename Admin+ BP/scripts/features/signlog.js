import { world, system } from "@minecraft/server"
import { record } from "../core/logs.js"
import { flag } from "../core/settings.js"
import { stripCodes } from "../core/identity.js"

// What people write on signs, in the log.
//
// **Bedrock has no sign-edited event, and this file is the workaround.**
// Checked against every pack installed here: 40+ behaviour packs, not one
// sign-specific event between them. The one pack that reads sign text at all
// does it on `playerInteractWithBlock`, which is a different question — that
// is "somebody touched a sign", not "somebody wrote on one".
//
// The shape of the problem: a sign is PLACED blank, and the words arrive
// afterwards, typed into a client-side screen that scripts cannot see. There
// is no callback when that screen closes. So the only way to learn what was
// written is to place a watch on the block and read it back.
//
// Two ways text appears, and both are covered:
//   placed   a fresh sign, blank, then written on
//   edited   an existing sign someone changed (Bedrock allows this until the
//            sign is waxed), which a place-only hook would miss entirely
//
// Why bother: sign text is the one thing a player can put in front of everyone
// that nothing records. Chat is logged, names are logged, commands are logged —
// a slur on a sign at spawn was invisible to staff who were not standing there
// when it went up.

/** Reads that can legitimately fail — an unloaded chunk, a broken block. */
function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

/**
 * When to look, in ticks after the sign was touched.
 *
 * Spread rather than single, because the writing screen stays open as long as
 * somebody is typing and there is no signal for when they stop. Two seconds
 * catches a quick line; twenty catches a slow typist writing four. Reading
 * repeatedly is cheap — it is one component read on one block.
 */
const LOOKS = [40, 100, 200, 400]

/** How many signs may be under watch at once. */
const WATCH_CAP = 64

const watching = new Map()

/** A sign's text as one line, or "" when it is blank or unreadable. */
export function signText(block) {
    const sign = safe(() => block?.getComponent?.("minecraft:sign"))
    if (!sign) return ""
    const raw = safe(() => sign.getText(), "")
    // Newlines become a separator so one sign is one log line, and § codes go
    // entirely: they would repaint the log around it, and hiding a word behind
    // a colour code is exactly the trick this exists to catch.
    return stripCodes(String(raw ?? "")).replace(/\r?\n/g, " / ").trim()
}

function keyOf(block) {
    const l = block?.location
    if (!l) return undefined
    return `${block.dimension?.id ?? "?"} ${l.x},${l.y},${l.z}`
}

/** Where it is, in words a moderator can walk to. */
function whereIs(block) {
    const l = block?.location
    if (!l) return "somewhere"
    const dimension = String(block.dimension?.id ?? "").replace("minecraft:", "")
    return `${Math.floor(l.x)}, ${Math.floor(l.y)}, ${Math.floor(l.z)} in the ${dimension}`
}

/**
 * Watch one sign and record the text once it appears.
 *
 * `was` is what it said before — "" for a sign just placed. Recording only on
 * a CHANGE is what stops an edit hook firing every time somebody right-clicks
 * a sign they did not touch.
 */
export function watchSign(player, block, was = "") {
    if (!flag("logs.signs")) return false
    const key = keyOf(block)
    if (!key || watching.has(key)) return false
    // A cap rather than unbounded growth: a redstone farm placing signs, or
    // somebody doing it on purpose, must not be able to grow this without end.
    if (watching.size >= WATCH_CAP) return false

    watching.set(key, true)
    let done = false
    for (const delay of LOOKS) {
        system.runTimeout(() => {
            if (done) return
            const now = signText(block)
            if (!now || now === was) {
                // Last look and still nothing worth saying: stop watching, so
                // the slot is free for the next sign.
                if (delay === LOOKS.at(-1)) watching.delete(key)
                return
            }
            done = true
            watching.delete(key)
            record(player, was ? "sign.edited" : "sign.written", undefined,
                was
                    ? `"${now}" §8(was "${was}") at ${whereIs(block)}`
                    : `"${now}" at ${whereIs(block)}`)
        }, delay)
    }
    return true
}

/** Is this block a sign at all? */
function isSign(block) {
    return !!safe(() => block?.getComponent?.("minecraft:sign"))
}

export function installSignLog() {
    // Placed blank, written afterwards. afterEvents.playerPlaceBlock is the
    // well-supported one here — 20 uses across the packs installed on this
    // machine, against one for the before-event.
    const placed = world.afterEvents?.playerPlaceBlock
    if (placed?.subscribe) {
        placed.subscribe(event => {
            const { player, block } = event
            if (!player || !isSign(block)) return
            watchSign(player, block, "")
        })
    } else {
        console.warn("[Admin+] playerPlaceBlock unavailable — sign text will not be logged")
    }

    // An existing sign being changed. Snapshot first, then watch for a
    // different answer, so merely reading a sign records nothing.
    const touched = world.afterEvents?.playerInteractWithBlock
        ?? world.beforeEvents?.playerInteractWithBlock
    if (touched?.subscribe) {
        touched.subscribe(event => {
            const { player, block } = event
            if (!player || !isSign(block)) return
            watchSign(player, block, signText(block))
        })
    }
}

/** Test seam: forget every watch. */
export function __clearSignWatches() { watching.clear() }
