import { world, system } from "@minecraft/server"
import { render, flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { isVanished } from "../core/vanish.js"

// Join and leave lines, printed by us instead of by the game.
//
// The vanilla lines are silenced in the resource pack's language files (all 29
// locales, including the realms variants — a realm uses different keys). We
// print our own instead, which buys two things:
//
//   * a vanished player produces no line at all, where vanilla would announce
//     them the moment they log in;
//   * /vanish can print a leave line and /unvanish a join line, so vanishing
//     looks exactly like leaving. It is indistinguishable from the real thing
//     because it IS the same line, from the same code, in the same colour.
//
// If the resource pack is missing, both lines appear — vanilla's and ours. That
// is a visible, harmless failure, which is the right way round: nobody is
// silently un-hidden.

/** Print the join line for a player. */
export function announceJoin(player) {
    if (!flag("presence.announce")) return
    world.sendMessage(render("format.join", { NAME: displayName(player) }))
}

/** Print the leave line for a name (the player object is gone by then). */
export function announceLeave(name) {
    if (!flag("presence.announce")) return
    world.sendMessage(render("format.leave", { NAME: name }))
}

export function installPresence() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        system.run(() => {
            // Someone who logged off vanished stays hidden on the way back in.
            if (isVanished(player)) return
            announceJoin(player)
        })
    })

    world.afterEvents.playerLeave?.subscribe(({ playerId, playerName }) => {
        // A vanished player already "left" when they vanished. Announcing it
        // again on the real disconnect is the tell that gives the trick away.
        if (isVanished(playerId)) return
        system.run(() => announceLeave(playerName))
    })
}
