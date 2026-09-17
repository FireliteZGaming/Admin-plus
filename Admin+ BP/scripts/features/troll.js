import { CustomCommandParamType, EntityDamageCause } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canTrollOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { flag } from "../core/settings.js"
import { trollBlockedBy } from "../core/trollgate.js"
import { record } from "../core/logs.js"

// Troll commands — off by default, behind one switch.
//
// The whole section answers to `admin.troll`, on the rank. A world that wants
// no troll tools gives that node to nobody, which is the same decision a
// separate world-level switch used to ask for a second time — in a different
// screen, with different words, and with an operator silently passing one half
// and failing the other. One switch, where people already go to decide who may
// do what.
//
// `/smite` is the first of them, and the most recognisable troll command there
// is — it is the one Skeppy is known for. It also has a real consequence, which
// is why the second setting exists.

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

/**
 * Lightning, in one of two strengths.
 *
 * A real `lightning_bolt` entity is what smite means everywhere else: it hurts,
 * it is loud, it is visible from a distance — and it SETS FIRES. That last part
 * is the reason `troll.smiteFire` exists rather than being assumed. Off, the
 * strike is the sound, the flash and the damage with no bolt entity spawned, so
 * nothing burns and nobody's build is part of the joke.
 *
 * Damage is applied explicitly in that mode because there is no bolt to do it.
 */
function strike(target) {
    const dimension = target?.dimension
    if (!dimension) return { ok: false, reason: "They are not anywhere I can reach." }

    if (flag("troll.smiteFire")) {
        const bolt = safe(() => dimension.spawnEntity("minecraft:lightning_bolt", target.location))
        if (!bolt) return { ok: false, reason: "The lightning would not spawn." }
        return { ok: true, burned: true }
    }

    safe(() => dimension.playSound("ambient.weather.lightning.impact", target.location))
    safe(() => dimension.spawnParticle("minecraft:electric_spark_particle", target.location))
    safe(() => target.applyDamage(5, {
        cause: EntityDamageCause?.lightning ?? "lightning"
    }))
    return { ok: true, burned: false }
}

command({
    name: "smite",
    picker: true,
    description: "Call down lightning on somebody — /smite <player>",
    perm: "admin.smite",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const shut = trollBlockedBy(player)
        if (shut) return err(player, shut)

        const targets = selected ?? []
        if (!targets.length) return err(player, "No player matched that selector.")

        const struck = []
        const blocked = []
        for (const target of targets) {
            if (target.id !== player.id && !canTrollOn(player, target)) {
                blocked.push(displayName(target))
                continue
            }
            const result = strike(target)
            if (!result.ok) { err(player, result.reason); continue }
            struck.push(displayName(target))
            record(player, "troll.smite", target, result.burned ? "real lightning" : "no fire")
        }

        if (struck.length) {
            ok(player, `Smote §f${struck.join(", ")}§a.`)
            if (!flag("troll.smiteFire")) {
                info(player, "§8Fire is off, so that was the flash and the damage only.")
            }
        }
        if (blocked.length) err(player, `Outranked you, skipped: §f${blocked.join(", ")}`)
    }
})

export { strike }
