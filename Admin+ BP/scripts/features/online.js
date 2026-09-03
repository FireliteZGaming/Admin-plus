import { world } from "@minecraft/server"
import { command } from "../core/registry.js"
import { info } from "../core/util.js"
import { isStaff, primaryRank } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { renderTag, flag } from "../core/settings.js"
import { isVanished } from "../core/vanish.js"

// /online — who is here.
//
// Exists because the pause-menu player list cannot be filtered: it is drawn by
// the client from the server's player list, and no API removes one entry from
// it. Hiding a vanished admin there would mean deleting the list for EVERYONE
// through a UI override, which taxes every player to hide one.
//
// So Admin+ leaves the vanilla list alone and offers a list it CAN tell the
// truth about: vanished players are absent for ordinary players, and shown to
// staff, marked.

/** The players this viewer should be told about. */
export function visiblePlayers(viewer) {
    const everyone = world.getAllPlayers()
    if (isStaff(viewer) || !flag("vanish.hideFromLists")) return everyone
    return everyone.filter(p => !isVanished(p))
}

command({
    name: "online",
    description: "See who is online",
    perm: "online.use",
    run: (player) => {
        const shown = visiblePlayers(player)
        const staff = isStaff(player)

        const lines = shown.map(target => {
            const tag = renderTag(primaryRank(target))
            const hidden = staff && isVanished(target) ? " §8(vanished)" : ""
            const you = target.id === player.id ? " §8(you)" : ""
            return `§7· ${tag ? tag + "§r " : ""}${displayName(target)}${hidden}${you}`
        })

        // The count matches the list. Saying "5 online" and then listing four is
        // how a vanished admin gets noticed.
        info(player, [`§f${shown.length}§7 online`, ...lines].join("\n"))
    }
})
