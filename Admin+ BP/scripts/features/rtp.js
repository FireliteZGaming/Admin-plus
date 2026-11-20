import { system } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { queueTeleport, clearUsed } from "../core/teleport.js"
import { findSpot, candidate, landingY, columnLoaded, skyHeight, flyTries, rtpRange, rtpMinimum } from "../core/rtp.js"

// /rtp — drop somewhere you have not been.
//
// The safety rules live in core/rtp.js; this is the search around them.
//
// **It flies out to look (2.12.16).** A script can only read blocks that are
// loaded, and the ground hundreds of blocks away is not loaded until somebody
// is near it. So after the warmup the player is moved high over a random spot
// (slow falling, so nobody drops), the game loads the area, and they land on
// the ground there if it is safe. Water, lava or nothing to stand on: the next
// spot. Up to eight spots, about two seconds each at most; if none works they
// go back where they started and the cooldown is given back. Before this, /rtp
// searched only from where they stood, and with the defaults almost every spot
// it tried was unloaded, so it nearly always said it couldn't find anywhere.
//
// A spot that happens to be loaded already (a small range, or players nearby)
// is still taken at once, without flying.
//
// **It has its own cooldown.** `/rtp` drops you thousands of blocks out and
// then it is a long walk back; a server that wants it rationed usually wants it
// rationed harder than a warp, and one that does not can set it to zero
// (Server ▸ Settings ▸ Teleportation ▸ Wait times, or per rank).
//
// No `/wild` alias. It was written and taken out again: two names for one
// command is the kind of duplicate this pack has spent a version rooting out,
// and the standing rule here is bare names with no sprawl.

/** Who is mid-search, so a second /rtp doesn't start another one. */
const searching = new Set()

/** Ticks between looks at the ground, and how long to wait for it to load. */
const LOOK_EVERY = 4
const LOAD_WAIT = 40

command({
    name: "rtp",
    description: "Teleport to a random safe place",
    run: (player) => {
        if (!flag("feature.rtp")) return info(player, "Random teleport is turned off on this server.")
        if (searching.has(player.id)) return info(player, "Still looking for a place for you. Hold on.")
        const dimension = player.dimension
        return queueTeleport(player, "somewhere random", () => startSearch(player, dimension), "rtp.cooldown")
    }
})

/** After the warmup. `from` is captured here, before anything moves them. */
export function startSearch(player, dimension) {
    const from = { x: player.location.x, y: player.location.y, z: player.location.z }
    const nearby = findSpot(player, dimension)
    if (nearby && land(player, dimension, nearby, from, false)) return true
    let cushion = false
    try { cushion = !player.getEffect?.("slow_falling") } catch { cushion = true }
    searching.add(player.id)
    flyOut(player, dimension, { from, cushion }, 1)
    return true
}

function flyOut(player, dimension, trip, n) {
    if (n > flyTries()) return giveUp(player, dimension, trip)
    const range = rtpRange()
    const { x, z } = candidate(trip.from, range, Math.min(rtpMinimum(), range))
    try {
        if (trip.cushion) player.addEffect("slow_falling", 20 * 8, { showParticles: false })
        player.teleport({ x: x + 0.5, y: skyHeight(dimension), z: z + 0.5 }, { dimension })
    } catch {
        searching.delete(player.id)   // they left
        return
    }
    bar(player, `§7Looking for a safe place... §8(${n} of ${flyTries()})`)
    look(player, dimension, trip, x, z, n, 0)
}

function look(player, dimension, trip, x, z, n, waited) {
    system.runTimeout(() => {
        let here = false
        try { here = player.isValid !== false } catch { here = false }
        if (!here) { searching.delete(player.id); return }

        const y = landingY(dimension, x, z)
        if (y !== undefined) {
            if (land(player, dimension, { x: x + 0.5, y: y + 1, z: z + 0.5 }, trip.from, trip.cushion)) return
            return flyOut(player, dimension, trip, n + 1)
        }
        // Loaded and still nowhere to stand (water, lava, void): try elsewhere.
        // Not loaded yet: keep waiting, up to two seconds.
        if (columnLoaded(dimension, x, z) || waited >= LOAD_WAIT) return flyOut(player, dimension, trip, n + 1)
        look(player, dimension, trip, x, z, n, waited + LOOK_EVERY)
    }, LOOK_EVERY)
}

/**
 * tryTeleport rather than teleport: it refuses rather than pushing somebody
 * into a block, and it says which happened.
 */
function land(player, dimension, spot, from, cushion) {
    let went = false
    try { went = player.tryTeleport(spot, { dimension, checkForBlocks: true }) } catch { went = false }
    if (!went) return false
    searching.delete(player.id)
    if (cushion) { try { player.removeEffect("slow_falling") } catch { /* already gone */ } }
    // Measured from where they STOOD, captured before anything moved them.
    const out = Math.round(Math.hypot(spot.x - from.x, spot.z - from.z))
    ok(player, `Sent you to §f${Math.round(spot.x)}, ${Math.round(spot.z)}§a. §7(${out} blocks out)`)
    return true
}

function giveUp(player, dimension, trip) {
    searching.delete(player.id)
    try { player.teleport(trip.from, { dimension }) } catch { /* they left */ }
    if (trip.cushion) { try { player.removeEffect("slow_falling") } catch { /* already gone */ } }
    clearUsed(player, "rtp.cooldown")
    err(player, "Couldn't find a safe place this time, so you're back where you started. Try again.")
}

function bar(player, text) {
    try { player.onScreenDisplay.setActionBar(text) } catch { /* nobody to show */ }
}
