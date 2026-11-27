import { world, system } from "@minecraft/server"
import { record } from "../core/logs.js"
import { noteSign } from "../core/chatlog.js"
import { flag } from "../core/settings.js"
import { stripCodes } from "../core/identity.js"
// 3.1.4: Chat Moderation reads signs too, and clears a caught one.
import { checkSign, signModerationOn } from "./chatmod.js"
import { adminplusDisabled } from "../core/terms.js"
import { alertStaff, tell } from "./automod.js"

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

/**
 * One side's text, the same way: "Front" or "Back" (the SignSide values).
 * The plain getText() above reads the front only, so a back side written on
 * its own went unread until 3.1.4.
 */
export function signSideText(block, side) {
    const sign = safe(() => block?.getComponent?.("minecraft:sign"))
    if (!sign) return ""
    const raw = safe(() => sign.getText(side), "")
    return stripCodes(String(raw ?? "")).replace(/\r?\n/g, " / ").trim()
}

/** Clear both sides of a sign. Returns whether it worked. */
function clearSign(block) {
    const sign = safe(() => block?.getComponent?.("minecraft:sign"))
    if (!sign) return false
    try { sign.setText("", "Front"); sign.setText("", "Back"); return true } catch { return false }
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
    if (adminplusDisabled()) return false
    // Watched for the log, or for Chat Moderation, which clears a caught sign.
    if (!flag("logs.signs") && !signModerationOn()) return false
    const key = keyOf(block)
    if (!key || watching.has(key)) return false
    // A cap rather than unbounded growth: a redstone farm placing signs, or
    // somebody doing it on purpose, must not be able to grow this without end.
    if (watching.size >= WATCH_CAP) return false

    // **Remember WHERE, not the Block.** A Block handle is only good while its
    // chunk stays loaded; read one after the chunk has gone and the API throws
    // LocationInUnloadedChunkError, which the safe() below turns into "" — so
    // the watch quietly decided the sign was blank and recorded nothing.
    //
    // That is exactly the shape of this feature's failure: somebody places a
    // sign, walks off while typing or gets carried out of the chunk, and the
    // handle is dead for the remaining nineteen seconds of looks. Re-fetching
    // from the dimension recovers the moment the chunk is back, because
    // getBlock returns undefined for an unloaded chunk rather than throwing.
    //
    // Held across four timeouts up to twenty seconds apart, which is a long
    // time in chunk terms. The test could not see this: the stub handed out a
    // plain object that worked forever.
    const home = block?.dimension
    const at = block?.location
    const lookUp = () => {
        try { return home?.getBlock?.(at) ?? undefined } catch { return undefined }
    }
    // Read the coordinate NOW, while the handle is certainly good. Asking for
    // it twenty seconds later is the same stale-handle throw, and it would lose
    // the one detail that makes a logged sign actionable: where to go and look.
    const where = whereIs(block)
    // The back side as it stood, so a change there is noticed too (3.1.4).
    const wasBack = signSideText(block, "Back")

    watching.set(key, true)
    let done = false
    for (const delay of LOOKS) {
        system.runTimeout(() => {
            if (done) return
            const sign = lookUp()
            const now = signText(sign)
            const back = signSideText(sign, "Back")
            const frontChanged = !!now && now !== was
            const backChanged = !!back && back !== wasBack
            if (!frontChanged && !backChanged) {
                // Last look and still nothing worth saying: stop watching, so
                // the slot is free for the next sign.
                if (delay === LOOKS.at(-1)) watching.delete(key)
                return
            }
            done = true
            watching.delete(key)

            // Chat Moderation (3.1.4): a caught side clears the whole sign.
            // The user: "if it catches it on a side, it could just completely
            // clear the sign".
            const caught = checkSign(player, { front: now, back })
            if (caught && clearSign(sign)) {
                tell(player, `§7Chat Moderation cleared your sign (${caught.labels}).`)
                alertStaff(`§7Chat Moderation cleared a sign by §f${player?.name}§7 at §f${where}§7 for §f${caught.why}§7.`)
                noteSign(player, caught.text, where, was || undefined, { mod: `cleared the sign (${caught.side} side): ${caught.why}` })
                return
            }
            // Into the CHAT log, not the audit log: a sign is something a
            // player put in front of everyone, which is what that table is
            // for. Where it stands is kept as its own field so the line reads
            // as the words and the coordinate waits on the detail view.
            noteSign(player, frontChanged ? now : `(back) ${back}`, where, was || undefined)
        }, delay)
    }
    return true
}

/** Is this block a sign at all? */
function isSign(block) {
    return !!safe(() => block?.getComponent?.("minecraft:sign"))
}

// ----------------------------------------------------------- command blocks
//
// **The command inside one cannot be read, and that is not a limitation of
// this file.** Bedrock has no NBT and the script API exposes no command-block
// component — checked the way everything else here is, against the packs
// installed on this machine. WorldEdit settles it: its `util.js` keeps one list
// of components it can read (inventory, sign, piston, record_player,
// fluid_container) and a separate list of block IDS it has to special-case, and
// all three command blocks are in the second. A pack whose entire job is
// copying blocks faithfully would read the command if it could.
//
// So what is logged is WHO put one down and WHERE. That is still the thing
// worth knowing: a repeating command block appearing on a realm is a serious
// event whatever it was set to, and until now nothing recorded it at all.

const COMMAND_BLOCKS = new Map([
    ["minecraft:command_block", "command block"],
    ["minecraft:chain_command_block", "chain command block"],
    ["minecraft:repeating_command_block", "repeating command block"]
])

/** Which kind of command block this is, or undefined. */
export function commandBlockKind(typeId) {
    return COMMAND_BLOCKS.get(String(typeId ?? ""))
}

export function installSignLog() {
    // Placed blank, written afterwards. afterEvents.playerPlaceBlock is the
    // well-supported one here — 20 uses across the packs installed on this
    // machine, against one for the before-event.
    const placed = world.afterEvents?.playerPlaceBlock
    if (placed?.subscribe) {
        placed.subscribe(event => {
            const { player, block } = event
            if (!player) return
            if (isSign(block)) { watchSign(player, block, ""); return }

            // No staff bypass, deliberately: staff are exactly who you audit
            // for this. A command block is rare enough that logging every one
            // costs nothing, and valuable enough that missing one costs a lot.
            const kind = commandBlockKind(block?.typeId)
            if (kind && flag("logs.commandBlocks")) {
                record(player, "cmdblock.placed", undefined,
                    `${kind} at ${whereIs(block)}`)
            }
        })
    } else {
        console.warn("[Admin+] playerPlaceBlock unavailable — sign text will not be logged")
    }

    // Removing one matters as much as placing it — "who took out the command
    // block that ran spawn protection" is the same question in reverse. The
    // block is already air by the time this fires, so the TYPE has to come off
    // the broken permutation rather than off the block.
    const broke = world.afterEvents?.playerBreakBlock
    if (broke?.subscribe) {
        broke.subscribe(event => {
            if (!flag("logs.commandBlocks")) return
            const kind = commandBlockKind(
                event?.brokenBlockPermutation?.type?.id ?? event?.block?.typeId)
            if (!kind || !event.player) return
            record(event.player, "cmdblock.broken", undefined,
                `${kind} at ${whereIs(event.block)}`)
        })
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
