import { world, system } from "@minecraft/server"
import { render, flag } from "../core/settings.js"
import { displayName, nameTokens, getNickname } from "../core/identity.js"
import { isVanished } from "../core/vanish.js"
import { adminplusDisabled } from "../core/terms.js"

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
    if (adminplusDisabled()) return
    if (!flag("presence.announce")) return
    world.sendMessage(render("format.join", nameTokens(player)))
}

/**
 * Print the leave line. The player object is gone by the time this runs, so
 * both names have to be handed in rather than looked up off a Player.
 *
 * @param name     the gamertag, which is what playerLeave carries
 * @param nickname theirs if they had one; falls back to the gamertag
 */
export function announceLeave(name, nickname) {
    if (adminplusDisabled()) return
    if (!flag("presence.announce")) return
    world.sendMessage(render("format.leave", nameTokens(name, nickname)))
}

/**
 * How long after spawning the greeting lands, in ticks.
 *
 * Not straight away. The join line, the world's own messages and everything
 * else that fires on spawn arrive in one burst, and a line inside a burst is a
 * line nobody reads. Three seconds puts it on its own, which is the only
 * reason it gets read at all.
 */
export const GREETING_DELAY = 60

/**
 * The one line a newcomer gets, and only them.
 *
 * `/info` is written for somebody who has never used a mod before — and until
 * now nothing anywhere told them it was there, which made it exactly as
 * undiscoverable as the thing it exists to explain. This is the pointer.
 *
 * **To them, not to the world.** It is the answer to "what is all this", and
 * everybody else already asked it. Broadcasting would make every join cost
 * everyone a line.
 *
 * Returns what was sent, or undefined when nothing was, so silence and a blank
 * line can be told apart.
 */
export function greet(player) {
    if (adminplusDisabled()) return undefined
    if (!flag("presence.greet")) return undefined
    const line = render("format.greeting", nameTokens(player))
    // Blanking the text is the other way to turn it off, and a realm that has
    // its own welcome system should not have to find the switch to stop ours.
    if (!line.trim()) return undefined
    player.sendMessage(line)
    return line
}

export function installPresence() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn) return
        system.run(() => {
            // Someone who logged off vanished stays hidden on the way back in.
            if (isVanished(player)) return
            announceJoin(player)
        })
        // Theirs alone, and a moment later — see greet(). Outside the vanish
        // check on purpose: a line only one person can see gives nothing away,
        // so hiding does not mean going without.
        system.runTimeout(() => {
            // Three seconds is long enough to leave in.
            if (!player.isValid) return
            greet(player)
        }, GREETING_DELAY)
    })

    world.afterEvents.playerLeave?.subscribe(({ playerId, playerName }) => {
        // A vanished player already "left" when they vanished. Announcing it
        // again on the real disconnect is the tell that gives the trick away.
        if (isVanished(playerId)) return
        // getNickname takes an id, which is the only handle left once the
        // Player is gone — so a nicknamed player still leaves under the name
        // everybody watched them wear.
        const nickname = getNickname(playerId)
        system.run(() => announceLeave(playerName, nickname))
    })
}
