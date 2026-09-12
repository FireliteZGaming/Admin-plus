import { world, system, CustomCommandParamType } from "@minecraft/server"
import { CONFIG, NS, ADMINPLUS_VERSION } from "./config.js"
import { command } from "./core/registry.js"
import { onPlayerJoin, refreshNameTag, canActOn, has, ladder, ranksTable } from "./core/ranks.js"
import { detectServerPreset } from "./core/serverPresets.js"
import { tableReport } from "./core/storage.js"
import { ok, err, msg } from "./core/util.js"
import { resolveSelector, SELECTOR_HELP } from "./core/selector.js"
import { displayName } from "./core/identity.js"
import { openPanel } from "./features/panel.js"
import "./features/gamemode.js"
import "./features/modcommands.js"
import "./features/sudo.js"
import "./features/invsee.js"
import "./features/enderchest.js"
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
import "./features/menu.js"
import "./features/info.js"
import "./features/vanillacmds.js"
import { installGrants } from "./features/grant.js"
import { installEnderView } from "./core/enderview.js"
import { installEnderBlocks } from "./core/enderblock.js"
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

// Teleport, resolved here rather than by the parser.
//
//   /a:tp <destination>            move yourself to them
//   /a:tp <victim> <destination>   move them to the destination
//
// **`/tp @p` never worked**, and the reason is the one the 54 passthroughs hit
// first: a custom command's PlayerSelector parameter is expanded by the ENGINE
// at the command's declared permission level, core/registry.js declares `Any`
// for everything, and every `@` form is refused there — before this handler
// runs. A literal name got through, which is exactly why the breakage looked
// random: `/tp Steve` worked and `/tp @p` did not.
//
// **This is NOT the last one.** Roughly two dozen of the pack's own commands
// still declare PlayerSelector — /ban, /mute, /warn, /nick, /invsee, /smite,
// /sudo, /tpa, /vanish and the rest — and every one of them refuses `@p` today
// for exactly this reason. Nobody noticed because people type a name or leave
// the argument off, which are the two cases that work. They want the same fix;
// this one went first because teleport is typed hardest.
//
// So both arguments are plain text now and core/selector.js resolves them
// through the script API, the same route the 54 vanilla passthroughs take. The
// cost is the same one they pay: the game no longer offers `@a @e @p` as you
// type. The description carries the vocabulary instead, and a NAME — gamertag
// or nickname — still works, which is what most people type anyway.
command({
    name: "tp",
    description: `Teleport players — /a:tp <who> [destination] · ${SELECTOR_HELP}`,
    perm: "admin.tp",
    mandatory: [{ name: "target", type: CustomCommandParamType.String }],
    optional: [{ name: "destination", type: CustomCommandParamType.String }],
    run: (player, [firstText, secondText]) => {
        const first = resolveSelector(firstText, player, true)
        if (!first.ok) return err(player, first.reason)
        if (first.unsupported?.length) {
            return err(player, `I can't apply §f${first.unsupported.join(", ")}§c — refusing rather than ignoring it.`)
        }
        if (!first.entities.length) return err(player, `Nothing matched §f${firstText}§c.`)

        // One argument: the selector IS the destination, and the player moves.
        if (secondText === undefined || secondText === null || secondText === "") {
            if (first.entities.length > 1) return err(player, "That matched more than one player.")
            const destination = first.entities[0]
            player.teleport(destination.location, { dimension: destination.dimension })
            return ok(player, `Teleported you to §f${displayName(destination)}§a.`)
        }

        const second = resolveSelector(secondText, player, true)
        if (!second.ok) return err(player, second.reason)
        if (second.unsupported?.length) {
            return err(player, `I can't apply §f${second.unsupported.join(", ")}§c — refusing rather than ignoring it.`)
        }
        if (!second.entities.length) return err(player, `Nothing matched §f${secondText}§c.`)
        if (second.entities.length > 1) return err(player, "The destination matched more than one player.")

        const destination = second.entities[0]
        const moved = []
        const blocked = []
        for (const target of first.entities) {
            if (!canActOn(player, target)) { blocked.push(displayName(target)); continue }
            target.teleport(destination.location, { dimension: destination.dimension })
            moved.push(displayName(target))
        }
        if (moved.length) ok(player, `Teleported §f${moved.join(", ")}§a to §f${displayName(destination)}§a.`)
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
installGrants()
installEnderView()
installEnderBlocks()
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
