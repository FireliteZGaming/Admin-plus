import { world, system, CustomCommandParamType } from "@minecraft/server"
import { CONFIG, NS, ADMINPLUS_VERSION } from "./config.js"
import { command } from "./core/registry.js"
import { onPlayerJoin, refreshNameTag, canActOn, has, ladder, ranksTable } from "./core/ranks.js"
import { detectServerPreset } from "./core/serverPresets.js"
import { tableReport } from "./core/storage.js"
import { ok, err, msg } from "./core/util.js"
import { resolveSelector, SELECTOR_HELP, SELECTOR_HINT } from "./core/selector.js"
import { pickPlayer } from "./core/ask.js"
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
import "./features/homes.js"
import "./features/rtp.js"
import { installBack } from "./features/back.js"
import { installClaims } from "./features/claims.js"
import { installWorldTools } from "./features/worldtools.js"
import { installAutomation } from "./features/automation.js"
import { menusName } from "./core/channel.js"
import { installAutomod } from "./features/automod.js"
import "./features/cleanup.js"
import "./features/vanish.js"
import "./features/online.js"
import { installPresence } from "./features/presence.js"
import { installSignLog } from "./features/signlog.js"
import { installNameAnimation } from "./features/nameanim.js"
import { installVanish } from "./core/vanish.js"
import { installHiding } from "./core/hiding.js"
import { installDisguise } from "./features/disguise.js"
import "./features/reports.js"
import "./features/warn.js"
import "./features/nick.js"
import "./features/chatcommands.js"
import "./features/menu.js"
import "./features/info.js"
import "./features/timeweather.js"
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
    description: "Open the staff panel",
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
    description: `Teleport players · ${SELECTOR_HELP}`,
    perm: "admin.tp",
    // `_or_me` on both, for the same reason the 54 passthroughs carry it: the
    // description is gone by the time you are typing the argument, and
    // `<target: string>` says nothing about what a target looks like.
    mandatory: [{
        name: "target_me_or_all", type: CustomCommandParamType.String,
        // Bare /tp: pick who to go to. The gamertag goes back in as the text
        // this handler already resolves.
        ask: async player => (await pickPlayer(player, { title: "/tp", body: "Who do you want to go to?" }))?.name
    }],
    optional: [{ name: "destination_or_me", type: CustomCommandParamType.String }],
    run: (player, [firstText, secondText]) => {
        const first = resolveSelector(firstText, player, true)
        if (!first.ok) return err(player, first.reason)
        if (first.unsupported?.length) {
            return err(player, `Admin+ can't use §f${first.unsupported.join(", ")}§c, so nothing was done.`)
        }
        if (!first.entities.length) return err(player, `Nothing matched §f${firstText}§c. ${SELECTOR_HINT}`)

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
            return err(player, `Admin+ can't use §f${second.unsupported.join(", ")}§c, so nothing was done.`)
        }
        if (!second.entities.length) return err(player, `Nothing matched §f${secondText}§c. ${SELECTOR_HINT}`)
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
        if (blocked.length) err(player, `Skipped because they outrank you: §f${blocked.join(", ")}`)
    }
})

// ------------------------------------------------------------------- events

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return
    system.run(() => {
        onPlayerJoin(player)
        if (has(player, "admin.panel")) {
            msg(player, `§7Admin+ v${ADMINPLUS_VERSION} is ready. Type §f/admin§7 for the panel.`)
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
installHiding()
installVanish()
installDisguise()
installPresence()
installSignLog()
installNameAnimation()
installClaims()
installWorldTools()
installAutomation()
installBack()
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
    console.log(`[Admin+] menus: ${menusName()} (the pack settings slider)`)

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
