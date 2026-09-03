import { world, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canActOn, isStaff, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { isVanished, toggle, unvanish, vanishedNames, vanishedCount } from "../core/vanish.js"
import { announceJoin, announceLeave } from "./presence.js"

// /vanish [player] — hide, or bring someone back.
//
// Staff can always see who is vanished: an admin who cannot tell whether their
// colleague is standing next to them is worse off than one who cannot vanish at
// all. Ordinary players are told nothing, ever.

command({
    name: "vanish",
    description: "Disappear — /vanish [player]",
    perm: "admin.vanish",
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [selected]) => {
        const targets = selected?.length ? selected : [player]

        for (const target of targets) {
            if (target.id !== player.id && !canActOn(player, target)) {
                err(player, `${displayName(target)} outranks you — skipped.`)
                continue
            }

            const wasVanished = isVanished(target)
            const result = toggle(target)
            if (!result.ok) { err(player, result.reason); continue }

            const nowHidden = !wasVanished
            if (!nowHidden) refreshNameTag(target)

            // The same line the game would print for a real disconnect, from
            // the same code — so vanishing reads as leaving unless someone is
            // paying very close attention.
            if (nowHidden) announceLeave(displayName(target))
            else announceJoin(target)

            if (target.id === player.id) {
                ok(player, nowHidden
                    ? "§7You're gone — armour and held items included."
                    : "§7You're visible again.")
            } else {
                ok(player, `${displayName(target)} is now §f${nowHidden ? "hidden" : "visible"}§a.`)
                info(target, nowHidden ? "§7You were vanished by staff." : "§7You were made visible again.")
            }

            record(player, nowHidden ? "admin.vanish" : "admin.unvanish", target,
                nowHidden ? "hidden" : "visible")
            tellStaff(player, target, nowHidden)
        }
    }
})

/** Only staff hear about it — that is the whole point of the feature. */
function tellStaff(actor, target, hidden) {
    for (const member of world.getAllPlayers()) {
        if (member.id === actor.id || member.id === target.id) continue
        if (!isStaff(member)) continue
        member.sendMessage(`§8[staff] §7${displayName(target)} is now ${hidden ? "§8vanished" : "§fvisible"}§7.`)
    }
}

command({
    name: "vanished",
    description: "Who is currently vanished",
    perm: "admin.vanish",
    run: (player) => {
        const count = vanishedCount()
        if (!count) return info(player, "§7Nobody is vanished.")
        info(player, `§7Vanished (§f${count}§7): §f${vanishedNames().join(", ")}`)
    }
})

/** Used by the Actions screen so staff can pull someone out of vanish. */
export function forceVisible(actor, target) {
    if (!isVanished(target)) return false
    unvanish(target)
    refreshNameTag(target)
    record(actor, "admin.unvanish", target, "made visible by staff")
    return true
}

export { isVanished }
