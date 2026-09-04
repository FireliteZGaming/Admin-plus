import { world, system, EquipmentSlot } from "@minecraft/server"
import { err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { ban, isBanned } from "../core/moderation.js"
import { record } from "../core/logs.js"
import { isBanHammer, worldToken } from "../core/banhammer.js"

// Swing it at somebody and they are banned. That is the whole feature.
//
// Double-locked, both locks checked at the moment of the swing rather than only
// when the hammer is handed out:
//   1. The hammer itself must be the one this world issued (core/banhammer.js).
//   2. The player swinging it must still hold `admin.banperm`.
//
// Checking at swing time is the point. A hammer that stayed live after somebody
// lost the permission would be a permanent backdoor sitting in a chest.
//
// WHERE IT COMES FROM, since 1.18.0: staff mode. It used to be minted from the
// Dev screen behind the Dev tag and operator, which meant the thing that bans
// people forever answered to a different question than banning people forever
// does. Now it rides in the /mm tool bar for anybody holding `admin.banperm`,
// and the permission and the tool say the same thing.

const REASON = "The Ban Hammer has spoken!"

/** Told-you-it-does-nothing, at most once every few seconds per player. */
const warned = new Map()
const WARN_GAP = 5000

function mainhand(entity) {
    try {
        return entity.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)
    } catch { return undefined }
}

/** Everyone sees it fall. Half the point of a ban hammer is the announcement. */
function announce(text) {
    try { world.sendMessage(text) } catch { /* nobody online */ }
}

/**
 * Every outcome is logged.
 *
 * Not for tidiness: a swing that does nothing is indistinguishable from a swing
 * that never registered, and that ambiguity cost a whole playtest. The content
 * log now says which branch ran, every time the real hammer connects.
 */
function trace(attacker, victim, outcome) {
    console.log(`[Admin+] ban hammer: ${attacker?.name} -> ${victim?.name}: ${outcome}`)
}

export async function swing(attacker, victim) {
    if (!has(attacker, "admin.banperm")) {
        // The hammer is inert in their hands, and silence would read as a bug.
        const last = warned.get(attacker.id) ?? 0
        if (Date.now() - last > WARN_GAP) {
            warned.set(attacker.id, Date.now())
            info(attacker, "§8The Ban Hammer is inert — it answers to permanent-ban permission.")
        }
        trace(attacker, victim, "refused — the swinger cannot ban permanently")
        return { ok: false, reason: "not allowed to ban permanently" }
    }

    if (has(victim, "admin.banperm")) {
        err(attacker, `${displayName(victim)}§c can ban permanently too — the hammer will not fall on them.`)
        trace(attacker, victim, "refused — the target can also ban permanently")
        return { ok: false, reason: "mutual immunity" }
    }

    if (isBanned(victim)) {
        info(attacker, `${displayName(victim)}§7 is already banned.`)
        trace(attacker, victim, "refused — already banned")
        return { ok: false, reason: "already banned" }
    }

    const name = displayName(victim)
    const result = await ban(victim, 0, REASON, attacker)
    record(attacker, "mod.ban", victim, "ban hammer · permanent")

    if (result.kicked) {
        announce(`§c${name}§c was struck down. §5${REASON}`)
        trace(attacker, victim, "banned and removed")
        return { ok: true, name, kicked: true }
    }

    // The ban is real and recorded; the player is simply still standing there.
    // On Bedrock nothing can remove the world host — they ARE the server — so
    // saying "banned" and leaving it at that would be a lie the swinger could
    // see through immediately.
    announce(`§c${name}§c was struck down. §5${REASON}`)
    err(attacker, `${name}§c is banned, but could not be removed from the world.`)
    info(attacker, "§7That happens with the world host, who cannot be kicked by anything. §8The ban is recorded and shows in the panel.")
    trace(attacker, victim, "banned, but the kick failed (host?)")
    return { ok: true, name, kicked: false }
}

export function installBanHammer() {
    // Seed the world serial on the first tick — worldToken() writes, and module
    // evaluation is a read-only context.
    system.run(() => { try { worldToken() } catch { /* seeded on first use */ } })

    const hit = world.afterEvents?.entityHitEntity
    if (!hit?.subscribe) {
        console.warn("[Admin+] entityHitEntity unavailable — the Ban Hammer will not fire on this runtime")
        return false
    }

    hit.subscribe(event => {
        const attacker = event.damagingEntity
        const victim = event.hitEntity
        if (!attacker || !victim) return

        // The hammer check comes FIRST so that ordinary punches stay silent —
        // this event fires on every hit in the world. Past this line we know
        // the genuine hammer connected, so every outcome is worth a log line.
        if (!isBanHammer(mainhand(attacker))) return

        if (victim.typeId !== "minecraft:player") {
            trace(attacker, victim, `no effect — ${victim.typeId} is not a player`)
            return
        }
        if (attacker.id === victim.id) return
        system.run(() => swing(attacker, victim))
    })

    console.log("[Admin+] ban hammer armed")
    return true
}
