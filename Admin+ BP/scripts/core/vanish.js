import { world, system } from "@minecraft/server"
import { Table } from "./storage.js"
import { flag } from "./settings.js"

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

const VANISH_KEY = "vanished"
const ANIMATION = "animation.adminplus.vanish"
const TAG = "ap:vanished"

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
    apply(player)
    return { ok: true }
}

/** Bring a player back. */
export function unvanish(player) {
    if (!isVanished(player)) return { ok: false, reason: "You aren't vanished." }
    vanished.delete(player.id)
    clear(player)
    return { ok: true }
}

export function toggle(player) {
    return isVanished(player) ? unvanish(player) : vanish(player)
}

// ------------------------------------------------------------------ effects

function apply(player) {
    try {
        player.addTag(TAG)
        player.addEffect("invisibility", 20000000, { amplifier: 0, showParticles: false })
        if (flag("vanish.nightVision")) {
            player.addEffect("night_vision", 20000000, { amplifier: 0, showParticles: false })
        }
        player.nameTag = ""
        playVanishAnimation(player)
    } catch (e) {
        console.warn(`[Admin+] vanish failed for ${player.name}: ${e}`)
    }
}

function clear(player) {
    try {
        player.removeTag(TAG)
        player.removeEffect("invisibility")
        if (flag("vanish.nightVision")) player.removeEffect("night_vision")
        // The animation is not stopped explicitly: it lapses once nothing
        // re-applies it, which is one less thing to get wrong.
    } catch { /* player left */ }
}

/** How long the animation takes to fade out once it stops. NOT a fade-in. */
const BLEND_OUT = 0.5

function playVanishAnimation(player) {
    try {
        // Run from the DIMENSION, not the player: player.runCommand inherits the
        // player's own permission level, so a staff member with admin.vanish but
        // no operator status could not hide themselves.
        player.dimension.runCommand(
            `playanimation "${player.name}" ${ANIMATION} none ${BLEND_OUT} "true"`)
    } catch {
        // The animation lives in the resource pack. Without it the player is
        // still invisible — just with their armour showing — so this is a
        // degraded state, not a broken one.
    }
}

/**
 * Re-stamp every tick, and on join.
 *
 * TWO things have to be true together or the armour flickers, and getting one
 * of them right is not enough:
 *
 *   1. Re-apply EVERY TICK. The stop expression is "true", so each application
 *      is told to stop at once; the loop is what keeps it going at all.
 *   2. Give it a real BLEND_OUT. That is a fade-OUT time, not a fade-in — it is
 *      how long the pose survives after being told to stop, and it is the only
 *      thing bridging the gap to the next application.
 *
 * This flickered twice. First at ten ticks with a 0.2 blend: too slow, and the
 * pose lapsed between stamps. Then at one tick with a 0 blend, on a misreading
 * of that parameter as a fade-in — which removed the bridge entirely and made
 * it worse. Every tick plus half a second of blend is what the working
 * reference does, and the two numbers only work as a pair.
 */
export function installVanish() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (!initialSpawn || !isVanished(player)) return
        system.run(() => apply(player))
    })

    system.runInterval(() => {
        for (const player of world.getAllPlayers()) {
            if (!isVanished(player)) continue
            playVanishAnimation(player)
            player.nameTag = ""
        }
    }, 1)
}

export { TAG as VANISH_TAG, ANIMATION as VANISH_ANIMATION }
