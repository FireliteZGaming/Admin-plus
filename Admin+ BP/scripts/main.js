import { world, system, CustomCommandParamType } from "@minecraft/server"
import { CONFIG, NS, ADMINPLUS_VERSION } from "./config.js"
import { command } from "./core/registry.js"
import { onPlayerJoin, refreshNameTag, canActOn, has } from "./core/ranks.js"
import { ok, err, msg } from "./core/util.js"
import { openPanel } from "./features/panel.js"
import "./features/gamemode.js"
import "./features/modcommands.js"
import "./features/sudo.js"
import "./features/invsee.js"
import "./features/broadcast.js"
import { installBanHammer } from "./features/banhammer.js"
import { installScriptEvents } from "./features/scriptevents.js"
import "./features/holograms.js"
import { installHolograms } from "./core/holograms.js"
import "./features/chatUI.js"
import { installSpawnProtection } from "./features/warps.js"
import { installAutomod } from "./features/automod.js"
import "./features/cleanup.js"
import "./features/vanish.js"
import "./features/online.js"
import { installPresence } from "./features/presence.js"
import { installVanish } from "./core/vanish.js"
import "./features/reports.js"
import "./features/warn.js"
import "./features/nick.js"
import "./features/tpa.js"
import { installModeration } from "./core/moderation.js"
import { installChat } from "./features/chat.js"
import { installHealthCheck } from "./core/health.js"

// ---------------------------------------------------------------- commands

command({
    name: "admin",
    description: "Open the Admin+ panel",
    perm: "admin.panel",
    run: (player) => openPanel(player)
})

// Vanilla-shaped teleport: same argument grammar as /tp, so muscle memory and
// tab-completion both carry over.
//   /a:tp <destination>            move yourself to them
//   /a:tp <victim> <destination>   move them to the destination
command({
    name: "tp",
    description: "Teleport players (same grammar as vanilla /tp)",
    perm: "admin.tp",
    mandatory: [{ name: "target", type: CustomCommandParamType.PlayerSelector }],
    optional: [{ name: "destination", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [first, second]) => {
        const targets = first ?? []
        const destinations = second ?? []

        // One argument: the selector IS the destination, and the player moves.
        if (!destinations.length) {
            const destination = targets[0]
            if (!destination) return err(player, "No player matched that selector.")
            if (targets.length > 1) return err(player, "That selector matched more than one player.")
            player.teleport(destination.location, { dimension: destination.dimension })
            return ok(player, `Teleported you to §f${destination.name}§a.`)
        }

        if (destinations.length > 1) return err(player, "The destination selector matched more than one player.")
        const destination = destinations[0]
        if (!targets.length) return err(player, "No player matched that selector.")

        const moved = []
        const blocked = []
        for (const target of targets) {
            if (!canActOn(player, target)) { blocked.push(target.name); continue }
            target.teleport(destination.location, { dimension: destination.dimension })
            moved.push(target.name)
        }
        if (moved.length) ok(player, `Teleported §f${moved.join(", ")}§a to §f${destination.name}§a.`)
        if (blocked.length) err(player, `Outranked you, skipped: §f${blocked.join(", ")}`)
    }
})

// ------------------------------------------------------------------- events

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return
    system.run(() => {
        onPlayerJoin(player)
        if (has(player, "admin.panel")) {
            msg(player, `§7Admin+ v${ADMINPLUS_VERSION} ready — type §f/admin§7 for the panel.`)
        }
    })
})

// Nametags are per-player state that a rejoin can clear, so re-stamp them on a
// slow tick rather than trusting the join event alone.
system.runInterval(() => {
    if (!CONFIG.ranks.showOnNameTag) return
    for (const player of world.getAllPlayers()) refreshNameTag(player)
}, 100)

installModeration()
installSpawnProtection()
installAutomod()
installVanish()
installPresence()
installBanHammer()
installScriptEvents()
installHolograms()
installHealthCheck()
installChat()

world.afterEvents.worldLoad.subscribe(() => {
    console.log(`[Admin+] v${ADMINPLUS_VERSION} loaded — command namespace "${NS}:"`)
})
