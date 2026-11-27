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
import { installBotDetection } from "./features/bots.js"
import { installChatCheck } from "./features/chatcheck.js"
import { installChatModeration } from "./features/chatmod.js"
import { installCleanup } from "./features/cleanup.js"
import "./features/vanish.js"
import "./features/online.js"
import { installPresence } from "./features/presence.js"
import { installDeathMessages } from "./features/deaths.js"
import { installSignLog } from "./features/signlog.js"
import { installNameAnimation } from "./features/nameanim.js"
import { installVanish } from "./core/vanish.js"
import { installHiding } from "./core/hiding.js"
import "./features/reports.js"
import "./features/warn.js"
import "./features/nick.js"
import "./features/chatcommands.js"
import "./features/menu.js"
import { adminplusDisabled } from "./core/terms.js"
import "./features/info.js"
import "./features/timeweather.js"
import { installGrants } from "./features/grant.js"
import { installEnderView } from "./core/enderview.js"
import { installEnderBlocks } from "./core/enderblock.js"
import "./features/troll.js"
import "./features/mode.js"
import { installAllowlist } from "./features/allowlist.js"
import { installPrivateChat } from "./features/privatechat.js"
import { installTpa } from "./features/tpa.js"
import { installModeration } from "./core/moderation.js"
import { installChat } from "./features/chat.js"
import { installHealthCheck } from "./core/health.js"
import { installSetup } from "./features/setup.js"
import { installTerms } from "./features/terms.js"

// ---------------------------------------------------------------- commands

command({
    name: "admin",
    description: "Open the staff panel",
    perm: "admin.panel",
    run: (player) => openPanel(player)
})


// ------------------------------------------------------------------- events

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (!initialSpawn) return
    system.run(() => {
        onPlayerJoin(player)
        if (!adminplusDisabled() && has(player, "admin.panel")) {
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
installBotDetection()
installChatCheck()
installChatModeration()
installHiding()
installVanish()
installPresence()
installDeathMessages()
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
installTpa()
installGrants()
installCleanup()
installEnderView()
installEnderBlocks()
installAllowlist()
installSetup()
installTerms()

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
