import { world } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info, formatDuration } from "../core/util.js"
import { flag } from "../core/settings.js"
import { queueTeleport } from "../core/teleport.js"
import { teleportTo } from "../core/warps.js"
import { lastPlace, takeLastPlace, mark } from "../core/back.js"

// /back — return to where you were.
//
// The mark is laid by core/teleport.js on every queued teleport and by the
// death hook below. This file is the command and the hook; the rule about
// death marks outranking teleport marks lives in core/back.js with the store.

command({
    name: "back",
    description: "Go back to where you were — /back",
    run: (player) => {
        if (!flag("feature.back")) return info(player, "/back is turned off here.")

        const place = lastPlace(player.id)
        if (!place) {
            return err(player, "Nowhere to go back to yet. "
                + "A teleport or a death leaves a mark you can return to.")
        }

        const label = place.death ? "where you died" : "where you were"
        const ago = formatDuration(Date.now() - place.at)

        return queueTeleport(player, label, () => {
            // Taken at the LAST moment, not when the command was typed: a
            // warmup somebody walks out of should leave the mark where it was.
            const going = takeLastPlace(player.id)
            if (!going) return err(player, "That mark is gone.")

            // Lay a new one before moving, so /back twice returns you here.
            mark(player)
            if (teleportTo(player, going)) {
                ok(player, `Back to ${label}§a. §7(${ago} ago)`)
            } else {
                err(player, "That place is in a dimension that isn't loaded.")
            }
        }, "back.cooldown")
    }
})

/**
 * A death is the mark worth having.
 *
 * `entityDie` rather than a hurt event, and filtered to players: it fires once,
 * after the fact, carrying `deadEntity`. Confirmed against the packs installed
 * on this machine — 64 uses of afterEvents.entityDie between them, which is how
 * everything else here settles an API question.
 *
 * Wrapped because the event is absent on some runtimes, and a missing death
 * hook should cost the death mark rather than the whole feature.
 */
export function installBack() {
    const died = world.afterEvents?.entityDie
    if (!died?.subscribe) {
        console.warn("[Admin+] entityDie unavailable — /back will only mark teleports")
        return false
    }
    died.subscribe(event => {
        const dead = event?.deadEntity
        if (!dead || dead.typeId !== "minecraft:player") return
        // The location is still readable here; a tick later it is the respawn
        // point, which is precisely the place nobody needs help getting to.
        mark(dead, { death: true })
    })
    return true
}
