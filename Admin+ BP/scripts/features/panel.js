import { menu, subtitle } from "../core/ui.js"
import { ADMINPLUS_VERSION } from "../config.js"
import { playerRanks, primaryRank, topWeight, isStaff, has } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { hubTitle, hubButton, HUB } from "../core/theme.js"
import { ranksScreen } from "./ranksUI.js"
import { actionsScreen } from "./actions.js"
import { codeScreen, canUseCode, allValuesScreen, configPresetsScreen, factoryResetScreen, previewLine } from "./code.js"
import { hasOperator } from "../core/devgate.js"
import { channelsScreen } from "./chatUI.js"
import { warpsScreen } from "./warps.js"
import { reportsScreen, reportsBadge } from "./reports.js"
import { teleportTuningScreen } from "./tuning.js"
import { logsScreen } from "./logsUI.js"
import { configurationScreen } from "./configUI.js"
import { automodScreen } from "./automod.js"
import { serverPresetsScreen } from "./serverPresets.js"
import { hologramsScreen } from "./holograms.js"
import { opBlocksScreen } from "./opblocks.js"
import { creditsScreen } from "./credits.js"
import { detectServerPreset } from "../core/serverPresets.js"

// /admin — the panel root.
//
// Each hub carries its own colour (core/theme.js) so you can tell at a glance
// which branch you are in. Sections the viewer has no permission for are left
// out entirely rather than shown and refused — a Helper's panel should look
// small, not locked.

export async function openPanel(player) {
    const buttons = []

    // Reports sit ABOVE everything, with a divider under them, and only when
    // something is waiting — an empty Reports button would be noise on a quiet
    // server. Bedrock forms have no separator element, so the divider is a
    // label-only button that simply re-renders the panel.
    const badge = reportsBadge(player)
    if (badge) {
        buttons.push({ text: badge, run: () => reportsScreen(player, () => openPanel(player)) })
        buttons.push({ text: "§8────────────", run: () => openPanel(player) })
    }

    buttons.push({
        text: hubButton("actions", "Actions", "Pick a player: names, ranks, moderation"),
        run: () => actionsScreen(player, () => openPanel(player))
    })

    if (has(player, "ranks.view")) {
        buttons.push({
            text: hubButton("ranks", "Ranks", "The ladder, and who holds what"),
            run: () => ranksScreen(player, () => openPanel(player))
        })
    }

    if (has(player, "admin.logs")) {
        buttons.push({
            text: hubButton("settings", "Logs", "Who did what, and undo"),
            run: () => logsScreen(player, () => openPanel(player))
        })
    }

    buttons.push({
        text: hubButton("warps", "Warps", "Named destinations and spawn"),
        run: () => warpsScreen(player, () => openPanel(player))
    })

    if (has(player, "admin.holograms")) {
        buttons.push({
            text: hubButton("warps", "Holograms", "Floating text and score leaderboards"),
            run: () => hologramsScreen(player, () => openPanel(player))
        })
    }

    if (has(player, "admin.opblocks")) {
        buttons.push({
            text: hubButton("settings", "Operator blocks", "Barriers, deny and allow zones, borders"),
            run: () => opBlocksScreen(player, () => openPanel(player))
        })
    }

    if (has(player, "admin.settings")) {
        buttons.push({
            text: hubButton("settings", "Settings", "Chat channels, features, teleport tuning"),
            run: () => settingsScreen(player, () => openPanel(player))
        })
    }

    // Presets sits at the root because it is not a setting — it changes the
    // whole shape of the server at once, and that deserves to be as visible as
    // the things it changes.
    if (has(player, "presets.apply")) {
        buttons.push({
            text: hubButton("presets", "Presets", `Whole-server shapes · currently ${detectServerPreset().label}`),
            run: () => serverPresetsScreen(player, () => openPanel(player))
        })
    }

    // Dev tag + operator only. Absent for everyone else, not disabled.
    if (canUseCode(player)) {
        buttons.push({
            text: hubButton("code", "< Code >", "The whole config as one editable text file"),
            run: () => codeScreen(player, () => openPanel(player))
        })
    }

    buttons.push({
        text: hubButton("about", "About Admin+"),
        run: () => aboutScreen(player, () => openPanel(player))
    })

    return menu(player, {
        title: hubTitle("ranks", "Admin panel"),
        body: subtitle(`Signed in as ${primaryRank(player)?.display ?? "§7no rank"}§r§7 (${displayName(player)}).`),
        buttons
    })
}

// Settings is where the config lives now.
//
// The bottom three moved out of < Code > when that section became the text
// editor it was named after. They were never dev-only in spirit — a preset and
// a reset are settings, and this is where somebody would look for them.
//
// Factory Reset additionally wants OPERATOR, because discarding every changed
// value at once is a different size of act from editing one. The screen checks
// again on entry; this only keeps the button from appearing.
async function settingsScreen(player, back) {
    const again = () => settingsScreen(player, back)
    return menu(player, {
        title: hubTitle("settings", "Settings"),
        body: [
            subtitle("Pack-wide configuration."),
            "",
            `§8Chat now reads: §r${previewLine()}`
        ].join("\n"),
        buttons: [
            has(player, "admin.automod")
                ? { text: hubButton("settings", "Automod", "Ore alerts, break rate, chat flooding"), run: () => automodScreen(player, again) }
                : null,
            { text: hubButton("settings", "Configuration", "Turn features on and off"), run: () => configurationScreen(player, again) },
            has(player, "chat.manage")
                ? { text: hubButton("settings", "Chat channels", "Create, gate and order the chats"), run: () => channelsScreen(player, again) }
                : null,
            { text: hubButton("settings", "Teleport tuning", "Warmup, cooldown, TPA expiry"), run: () => teleportTuningScreen(player, again) },
            { text: hubButton("settings", "All values", "Every config value, one field at a time"), run: () => allValuesScreen(player, again) },
            { text: hubButton("presets", "Config presets", "Named baselines for the values above"), run: () => configPresetsScreen(player, again) },
            hasOperator(player)
                ? { text: hubButton("actions", "Factory Reset", "Throw away every change, back to defaults"), run: () => factoryResetScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function aboutScreen(player, back) {
    const ranks = playerRanks(player).map(r => r.display).join("§7, ") || "§7none"
    const authority = topWeight(player) === Infinity
        ? "§dunrestricted §8(owner or operator)"
        : `§f${topWeight(player)}`

    return menu(player, {
        title: hubTitle("about", "About"),
        body: [
            `§l§bAdmin§d+§r §8v${ADMINPLUS_VERSION}`,
            "",
            `§fYour ranks: §r${ranks}`,
            `§fAuthority: §r${authority}`,
            `§fStaff: §7${isStaff(player) ? "yes" : "no"}`,
            `§fServer shape: §7${detectServerPreset().label}`,
            "",
            "§7Management lives in this panel — there are no",
            "§7/setrank-style commands to remember.",
            "",
            `§7Hubs: ${HUB.actions}Actions ${HUB.ranks}Ranks ${HUB.warps}Warps ${HUB.presets}Presets ${HUB.settings}Settings`,
            "",
            "§8Not working? §f/function check",
            "",
            "§7Commands: §f/admin §f/chat §f/gm §f/a:tp §f/warp §f/warps §f/spawn §f/tpa §f/report §f/mute §f/unmute §f/unban §f/sudo §f/vanish §f/invsee §f/online §f/broadcast §f/clearchat §f/lagclear"
        ].join("\n"),
        buttons: [
            { text: "§7Credits§r\n§8Who built it, and what was learned from whom", run: () => creditsScreen(player, () => aboutScreen(player, back)) }
        ],
        back
    })
}
