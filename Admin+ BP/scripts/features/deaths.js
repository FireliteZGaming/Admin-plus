import { world, system } from "@minecraft/server"
import { flag } from "../core/settings.js"
import { adminplusDisabled } from "../core/terms.js"
import { displayName } from "../core/identity.js"
import { isHidden } from "../core/hiding.js"
import { Table } from "../core/storage.js"
import { deathMessage, killerOf } from "../core/deaths.js"

// Death messages with display names (3.1.9, the user: "death messages should
// do nicknames too"). core/deaths.js picks the game's own words and the names;
// this file says them and keeps the game's own death messages off while Admin+
// says them, through the showDeathMessages game rule.

/** Whether Admin+ took the game rule over, so it knows to hand it back. */
const rule = new Table("deathRule", {})

/** Admin+ says death messages now: its switch is on, and Admin+ is on. */
export function sayingDeaths() {
    return flag("presence.deaths") && !adminplusDisabled()
}

/**
 * Keep the game's own death messages off exactly while Admin+ says them.
 * While the switch is on, Admin+ takes the rule over. When the switch goes off,
 * or the terms are declined ("like the mod was never added"), it puts the
 * rule back, but only if it was Admin+ that turned it off, so a server that
 * set the rule itself, with the switch off, keeps its choice.
 */
export function reconcileDeathRule() {
    const rules = world.gameRules
    if (!rules) return
    try {
        if (sayingDeaths()) {
            if (rules.showDeathMessages !== false) rules.showDeathMessages = false
            if (!rule.get("owned")) rule.set("owned", true)
        } else if (rule.get("owned")) {
            rules.showDeathMessages = true
            rule.delete("owned")
        }
    } catch (e) {
        console.warn(`[Admin+] Death messages: couldn't set the game rule: ${e}`)
    }
}

/**
 * Say a player's death, with display names. A hidden player (vanish) dies
 * unannounced: the game's own message is off, so nothing gives them away.
 * Returns the message sent, or undefined when nothing was said.
 */
export function onPlayerDeath({ deadEntity, damageSource } = {}) {
    if (deadEntity?.typeId !== "minecraft:player") return undefined
    if (!sayingDeaths()) return undefined
    if (isHidden(deadEntity)) return undefined
    const cause = String(damageSource?.cause ?? "")
    const by = damageSource?.damagingEntity
    const projectile = damageSource?.damagingProjectile
    // Shot by nobody (a dispenser's arrow): the projectile itself is to blame,
    // the way the game names it.
    const killer = killerOf(by ?? (cause === "projectile" ? projectile : undefined), displayName)
    const message = deathMessage(displayName(deadEntity), cause, {
        killer,
        killerIsPlayer: by?.typeId === "minecraft:player",
        projectile: String(projectile?.typeId ?? "")
    })
    world.sendMessage(message)
    return message
}

export function installDeathMessages() {
    world.afterEvents?.entityDie?.subscribe?.(event => {
        try { onPlayerDeath(event) } catch (e) { console.warn(`[Admin+] Death message: ${e}`) }
    })
    // The rule follows the switch and the terms. Checked every two seconds,
    // like spawn (core/omnitool.js), because either can change anywhere.
    system.runInterval?.(reconcileDeathRule, 40)
    return true
}
