import { world, system, CustomCommandParamType } from "@minecraft/server"
import { CONFIG, NS, ADMINPLUS_VERSION } from "./config.js"
import { command } from "./core/registry.js"
import { onPlayerJoin, refreshNameTag, canActOn, has, ladder, ranksTable } from "./core/ranks.js"
import { detectServerPreset } from "./core/serverPresets.js"
import { tableReport } from "./core/storage.js"
import { ok, err, msg } from "./core/util.js"
import { openPanel } from "./features/panel.js"
import "./features/gamemode.js"
import "./features/modcommands.js"
import "./features/sudo.js"
import "./features/invsee.js"
import "./features/broadcast.js"
import { installBanHammer } from "./features/banhammer.js"
import { installStaffMode } from "./features/staffmode.js"
import { installAdminItems } from "./features/adminitems.js"
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
import "./features/chatcommands.js"
import "./features/vanillacmds.js"
import "./features/troll.js"
import "./features/mode.js"
import { installAllowlist } from "./features/allowlist.js"
import { installPrivateChat } from "./features/privatechat.js"
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
installStaffMode()
installAdminItems()
installScriptEvents()
installHolograms()
installHealthCheck()
installChat()
installPrivateChat()
installAllowlist()

world.afterEvents.worldLoad.subscribe(() => {
    console.log(`[Admin+] v${ADMINPLUS_VERSION} loaded — command namespace "${NS}:"`)

    // Say what shape the world came up in. "The preset did not stick after a
    // rejoin" was impossible to answer from the log before this: nothing
    // recorded which ladder was live, or whether it came out of storage at all.
    // FROM STORAGE means the world remembered. DEFAULTS means it did not, and
    // that is the line to look for.
    try {
        const source = ranksTable.fromStorage ? "from world storage" : "DEFAULTS — nothing was stored"
        console.log(`[Admin+] ranks: ${ladder().length} on the "${detectServerPreset().label}" shape, ${source}`)

        // And the whole storage layer, because the useful question is not "did
        // ranks load" but "did ANY of them". A world that reverted its ladder on
        // every rejoin was very likely failing to read all of these and running
        // on seeds; ranks are just the table whose contents you notice.
        // Three distinct states, and only the third is a problem. Reading fails
        // during early execution on every world — getDynamicProperty is simply
        // not callable there — so the retry doing its job is the NORMAL case,
        // and a table sitting on its seed usually just means a young world.
        const report = tableReport()
        const loaded = report.filter(t => t.fromStorage)
        const stuck = report.filter(t => t.unreadable)

        if (stuck.length) {
            console.warn(`[Admin+] storage: ${stuck.length} of ${report.length} tables STILL cannot be read — nothing will save this session, but nothing has been overwritten either: ${stuck.map(t => t.key).join(", ")}`)
        } else if (loaded.length === report.length) {
            console.log(`[Admin+] storage: all ${report.length} tables read from the world`)
        } else if (!loaded.length) {
            console.log(`[Admin+] storage: ${report.length} tables read fine, this world had no Admin+ data yet — starting fresh`)
        } else {
            console.log(`[Admin+] storage: ${loaded.length}/${report.length} tables had saved data; the rest were empty and have been started`)
        }
    } catch (e) {
        console.warn(`[Admin+] could not report the rank state: ${e}`)
    }
})
