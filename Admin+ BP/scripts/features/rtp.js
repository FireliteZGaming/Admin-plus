import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { queueTeleport } from "../core/teleport.js"
import { findSpot } from "../core/rtp.js"

// /rtp — drop somewhere you have not been.
//
// The search lives in core/rtp.js; this is the command around it. Two things
// happen here and nowhere else:
//
// **The search runs BEFORE the warmup, not after.** A player who waits five
// seconds only to be told the pack could not find anywhere has been charged for
// nothing, and on an ocean world that is the usual outcome. Looking first costs
// exactly the same and fails immediately.
//
// **It has its own cooldown.** `/rtp` drops you thousands of blocks out and
// then it is a long walk back; a server that wants it rationed usually wants it
// rationed harder than a warp, and one that does not can set it to zero.
//
// No `/wild` alias. It was written and taken out again: two names for one
// command is the kind of duplicate this pack has spent a version rooting out,
// and the standing rule here is bare names with no sprawl.

command({
    name: "rtp",
    description: "Teleport somewhere random — /rtp",
    run: (player) => {
        if (!flag("feature.rtp")) return info(player, "Random teleport is turned off here.")

        const spot = findSpot(player, player.dimension)
        if (!spot) {
            return err(player, "Couldn't find anywhere safe to drop you. Try again — "
                + "it looks in a different direction each time.")
        }
        const from = player.location

        return queueTeleport(player, "somewhere random", () => {
            // tryTeleport rather than teleport: it refuses rather than pushing
            // somebody into a block, and it says which happened. The spot
            // passed every check a moment ago, and a moment is long enough for
            // somebody to have built there.
            let went = false
            try {
                went = player.tryTeleport(spot, {
                    dimension: player.dimension,
                    checkForBlocks: true
                })
            } catch { went = false }

            if (!went) {
                return err(player, "That spot was taken by the time you got there. Try again.")
            }
            // Measured from where they STOOD, captured before the warmup — after
            // the teleport `player.location` is the destination, so a distance
            // read then is always zero. That is the whole reason `from` exists.
            const out = Math.round(Math.hypot(spot.x - from.x, spot.z - from.z))
            ok(player, `Dropped you at §f${Math.round(spot.x)}, ${Math.round(spot.z)}§a. `
                + `§7(${out} blocks out)`)
        }, "rtp.cooldown")
    }
})
