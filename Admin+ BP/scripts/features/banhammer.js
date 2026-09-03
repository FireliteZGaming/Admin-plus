import { world, system, EquipmentSlot } from "@minecraft/server"
import { menu, confirm } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { canUseCode } from "../core/devgate.js"
import { displayName } from "../core/identity.js"
import { ban, isBanned } from "../core/moderation.js"
import { record } from "../core/logs.js"
import { isBanHammer, makeBanHammer, worldToken, HAMMER_NAME } from "../core/banhammer.js"

// Swing it at somebody and they are banned. That is the whole feature.
//
// Double-locked, both locks checked at the moment of the swing rather than only
// when the hammer is handed out:
//   1. The hammer itself must be the one this world issued (core/banhammer.js).
//   2. The player swinging it must still hold the Dev tag AND operator.
//
// Checking at swing time is the point. A hammer that stayed live after somebody
// lost their Dev tag would be a permanent backdoor sitting in a chest.

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

export function swing(attacker, victim) {
    if (!canUseCode(attacker)) {
        // The hammer is inert in their hands, and silence would read as a bug.
        const last = warned.get(attacker.id) ?? 0
        if (Date.now() - last > WARN_GAP) {
            warned.set(attacker.id, Date.now())
            info(attacker, "§8The Ban Hammer is inert — it answers to the Dev tag and operator, both.")
        }
        trace(attacker, victim, "refused — the swinger lacks the Dev tag, operator, or both")
        return { ok: false, reason: "not a dev" }
    }

    if (canUseCode(victim)) {
        err(attacker, `${displayName(victim)}§c also holds Dev and operator — the hammer will not fall on them.`)
        trace(attacker, victim, "refused — the target also holds Dev and operator")
        return { ok: false, reason: "mutual immunity" }
    }

    if (isBanned(victim)) {
        info(attacker, `${displayName(victim)}§7 is already banned.`)
        trace(attacker, victim, "refused — already banned")
        return { ok: false, reason: "already banned" }
    }

    const name = displayName(victim)
    const result = ban(victim, 0, REASON, attacker)
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

// -------------------------------------------------------------------- the UI

export async function banHammerScreen(player, back) {
    if (!canUseCode(player)) { err(player, "That needs the Dev tag and operator status."); return back() }

    return menu(player, {
        title: hubTitle("code", "Ban Hammer"),
        body: [
            `§r${HAMMER_NAME}§r`,
            "",
            "§7A real mace, issued by this world. Hit a player with it",
            "§7and they are permanently banned, on the spot.",
            "",
            `§8Serial: §7#${worldToken()}`,
            "§8A mace you rename yourself is just a mace — the signature",
            "§8is in the lore, and Bedrock gives players no way to write it.",
            "",
            "§8Curse of Vanishing is what makes it shimmer, and it means",
            "§8nobody can loot the hammer off you when you die.",
            "",
            "§cIt checks your Dev tag and op at the moment you swing,",
            "§cnot when you were given it."
        ].join("\n"),
        buttons: [
            {
                text: "§4§lTake one§r\n§8Into your inventory",
                run: async () => {
                    const yes = await confirm(player, hubTitle("code", "Ban Hammer"),
                        "Take a Ban Hammer?\n\n§8Anyone you hit with it is banned permanently.\n§8It does nothing in anyone else's hands.",
                        "§4Take it")
                    if (!yes) return back()

                    const container = player.getComponent("minecraft:inventory")?.container
                    if (!container) { err(player, "Couldn't reach your inventory."); return back() }

                    let leftover
                    try {
                        leftover = container.addItem(makeBanHammer())
                    } catch (e) {
                        err(player, `Couldn't make the hammer: ${e}`)
                        return back()
                    }
                    if (leftover) { err(player, "Your inventory is full."); return back() }

                    record(player, "dev.banhammer", undefined, "issued one to themselves")
                    ok(player, `${HAMMER_NAME}§a is in your inventory.`)
                    return back()
                }
            }
        ],
        back
    })
}
