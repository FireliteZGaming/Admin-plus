import { world, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canActOn, canSeeActionsOf, isStaff, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { isVanished, toggle, unvanish } from "../core/vanish.js"
import { announceJoin, announceLeave } from "./presence.js"

// /vanish [player] — hide, or bring someone back.
//
// Staff can always see who is vanished: an admin who cannot tell whether their
// colleague is standing next to them is worse off than one who cannot vanish at
// all. Ordinary players are told nothing, ever.

command({
    name: "vanish",
    picker: true,
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
            if (nowHidden) announceLeave(target.name, displayName(target))
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

/**
 * Only staff hear about it — that is the whole point of the feature.
 *
 * And only staff who are not BELOW the person who did it. Vanish is on the
 * audit system's SILENT list because it announces itself here in its own
 * words, which meant it also skipped the rank rule that governs every other
 * staff notice: a moderator was watching an admin disappear. Somebody senior
 * going invisible is exactly the thing a junior should not be told about,
 * because the whole point is that nobody knows they are there.
 *
 * Same predicate the audit announcer uses, so the two cannot drift.
 */
function tellStaff(actor, target, hidden) {
    for (const member of world.getAllPlayers()) {
        if (member.id === actor.id || member.id === target.id) continue
        if (!isStaff(member)) continue
        if (!canSeeActionsOf(member, actor)) continue
        member.sendMessage(`§8[staff] §7${displayName(target)} is now ${hidden ? "§8vanished" : "§fvisible"}§7.`)
    }
}

command({
    name: "vanished",
    description: "Who is currently vanished",
    perm: "admin.vanish",
    run: (player) => {
        // Rank-filtered, and built from LIVE players rather than the stored
        // names. Closing the leak in tellStaff and leaving this alone would
        // have been pointless — a moderator who cannot be told an admin
        // vanished could simply type /vanished and read it off the list.
        //
        // Live players also answer the question more honestly: somebody who
        // logged off while vanished is not "currently vanished", they are
        // offline, and listing them invited staff to go looking for a person
        // who is not there.
        const hidden = world.getAllPlayers()
            .filter(p => isVanished(p) && p.id !== player.id && canSeeActionsOf(player, p))
        if (!hidden.length) return info(player, "§7Nobody is vanished.")
        info(player, `§7Vanished (§f${hidden.length}§7): §f${hidden.map(displayName).join(", ")}`)
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
