import { world, system } from "@minecraft/server"
import { Table } from "./storage.js"
import { flag } from "./settings.js"
import { hide, unhide, isHidden, HIDDEN_TAG, HIDING_ANIMATION } from "./hiding.js"

// Vanish — actually unrendered, armour and held items included.
//
// The invisibility effect alone does NOT hide armour or what you are holding,
// which is why a naive vanish leaves a floating chestplate walking around.
//
// The fix is a resource-pack animation (Admin+ RP/animations) that scales every
// player bone to zero — body, armour layers, and the item bones — and drops the
// root far below the world. It is applied with /playanimation and re-stamped
// every tick, because the animation lapses on its own. That lapse is also how
// unvanishing works, so there is no "stop" call to get wrong.
//
// Nothing is moved, stashed or serialised. An earlier version of this file
// stashed equipment into the player's inventory: it worked, but it could fail
// on a full inventory and had to be unwound correctly after a crash. This has
// no such state to lose.
//
// TWO things have to be true together or the armour flickers: re-stamp EVERY
// TICK, and give it half a second of BLEND_OUT. That is a fade-OUT time, not a
// fade-in: how long the pose survives after being told to stop, the only thing
// bridging the gap to the next stamp. It flickered at ten ticks with a 0.2
// blend, and worse at one tick with a 0 blend, read wrongly as a fade-in.
//
// Since 2.12.8 the hiding itself lives in core/hiding.js, shared with
// /disguise: vanish is one REASON to be hidden, and the effects a player had
// before vanishing (a potion of invisibility, night vision) come back when
// they reappear, instead of being removed.

const VANISH_KEY = "vanished"
const REASON = "vanish"

const vanished = new Table(VANISH_KEY, {})

export function isVanished(playerOrId) {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId?.id
    return !!vanished.get(id)
}

export function vanishedNames() {
    return vanished.values().map(v => v.name).filter(Boolean)
}

export function vanishedCount() { return vanished.ids().length }

/** Hide a player. */
export function vanish(player) {
    if (isVanished(player)) return { ok: false, reason: "You're already vanished." }
    vanished.set(player.id, { name: player.name, at: Date.now() })
    hide(player, REASON, { nightVision: flag("vanish.nightVision") })
    return { ok: true }
}

/**
 * Bring a player back. `visible` says whether they show now: a disguised
 * player stays hidden inside the disguise.
 */
export function unvanish(player) {
    if (!isVanished(player)) return { ok: false, reason: "You aren't vanished." }
    vanished.delete(player.id)
    return { ok: true, visible: unhide(player, REASON) }
}

export function toggle(player) {
    return isVanished(player) ? unvanish(player) : vanish(player)
}

/**
 * On join. core/hiding.js puts the hiding back on anyone it has a record for;
 * this covers a player who vanished before that layer existed (2.12.8), whose
 * invisibility is Admin+'s own already, so nothing of theirs is remembered.
 */
export function installVanish() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn || !isVanished(player) || isHidden(player, REASON)) return
        system.run(() => hide(player, REASON, { nightVision: flag("vanish.nightVision"), keep: false }))
    })
}

export { HIDDEN_TAG as VANISH_TAG, HIDING_ANIMATION as VANISH_ANIMATION }
