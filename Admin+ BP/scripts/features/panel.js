import { menu, subtitle } from "../core/ui.js"
import { ADMINPLUS_VERSION } from "../config.js"
import { primaryRank, has } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ranksScreen } from "./ranksUI.js"
import { actionsScreen } from "./actions.js"
import { codeScreen, canUseCode, allValuesScreen, configPresetsScreen, factoryResetScreen } from "./code.js"
import { hasOperator } from "../core/devgate.js"
import { warpsScreen } from "./warps.js"
import { claimsScreen } from "./claims.js"
import { claimLimit } from "../core/claims.js"
import { flag } from "../core/settings.js"
import { reportsScreen, reportsBadge } from "./reports.js"
import { logsScreen } from "./logsUI.js"
import { settingsScreen } from "./settingsUI.js"
import { automodHubScreen } from "./automodUI.js"
import { serverPresetsScreen } from "./serverPresets.js"
import { hologramsScreen } from "./holograms.js"
import { creditsScreen } from "./credits.js"
import { detectServerPreset } from "../core/serverPresets.js"
import { infoScreen } from "./info.js"

// /admin — the staff panel.
//
// Six choices, each named for what a staff member came to do, and each in its
// own colour so you can tell which part of the panel you are in:
//
//   Players   find somebody and deal with them
//   Ranks     make ranks and hand them out
//   Places    warps, spawn, floating text, land claims
//   Logs      what happened and who did it
//   Server    how the server works for everybody
//   Help      what everything does
//
// Things the viewer cannot use are left out rather than shown and refused, so
// a junior moderator's panel looks small, not locked. Personal things (your own
// homes and claims) live in /menu, which every player has.

export async function openPanel(player) {
    const again = () => openPanel(player)
    const buttons = []

    // Waiting reports go first, and only when there are any.
    const badge = reportsBadge(player)
    if (badge) buttons.push({ text: badge, run: () => reportsScreen(player, again) })

    buttons.push({
        text: hubButton("actions", "Players", "Find a player to help, warn or punish"),
        run: () => actionsScreen(player, again)
    })
    if (has(player, "ranks.view")) {
        buttons.push({
            text: hubButton("ranks", "Ranks", "Make ranks and give them to players"),
            run: () => ranksScreen(player, again)
        })
    }
    if (placesButtons(player, again).length) {
        buttons.push({
            text: hubButton("warps", "Places", "Warps, spawn, floating text and land claims"),
            run: () => placesScreen(player, again)
        })
    }
    if (has(player, "admin.logs")) {
        buttons.push({
            text: hubButton("chat", "Logs", "What happened, who did it, and undo"),
            run: () => logsScreen(player, again)
        })
    }
    if (serverButtons(player, again).length) {
        buttons.push({
            text: hubButton("settings", "Server", "Settings, automod, presets and advanced"),
            run: () => serverScreen(player, again)
        })
    }
    buttons.push({
        text: hubButton("about", "Help", "What everything does, and the version"),
        run: () => helpScreen(player, again)
    })

    return menu(player, {
        title: hubTitle("ranks", "Staff panel"),
        body: subtitle(`You are ${displayName(player)}, ${primaryRank(player)?.display ?? "§7no rank"}§r§7.`),
        buttons
    })
}

// ------------------------------------------------------------------- Places

function placesButtons(player, back) {
    return [
        flag("feature.warps") || flag("feature.spawn")
            ? { text: hubEntry("warps", "Warps and spawn", "Places players can travel to"), run: () => warpsScreen(player, back) }
            : null,
        has(player, "admin.holograms")
            ? { text: hubEntry("warps", "Floating text", "Words and scoreboards that hang in the air"), run: () => hologramsScreen(player, back) }
            : null,
        flag("feature.claims") && (claimLimit(player) > 0 || has(player, "admin.claims"))
            ? { text: hubEntry("warps", "Land claims", "Land that players have protected"), run: () => claimsScreen(player, back) }
            : null
    ].filter(Boolean)
}

async function placesScreen(player, back) {
    const again = () => placesScreen(player, back)
    return menu(player, {
        title: hubTitle("warps", "Places"),
        body: subtitle("Where players can go, and what they have claimed."),
        buttons: placesButtons(player, again),
        back
    })
}

// ------------------------------------------------------------------- Server

/**
 * Server, as the user laid it out on 2026-11-12: Settings (every switch, in
 * groups that say what they hold), Automod, and Advanced. Server presets is the
 * one that fits none of those: it sets up the whole server in one step.
 */
function serverButtons(player, back) {
    const settings = has(player, "admin.settings")
    return [
        settings
            ? { text: hubButton("settings", "Settings", "Switch things on and off: travel, chat, names, moderation, extras"), run: () => settingsScreen(player, back) }
            : null,
        has(player, "admin.automod")
            ? { text: hubButton("settings", "Automod", "Ore alerts, fast breaking, chat flooding, chat screening"), run: () => automodHubScreen(player, back) }
            : null,
        has(player, "presets.apply")
            ? { text: hubButton("presets", "Server presets", `Set up the whole server in one step · now: ${detectServerPreset().label}`), run: () => serverPresetsScreen(player, back) }
            : null,
        settings || canUseCode(player)
            ? { text: hubButton("settings", "Advanced", "Every setting, saved setups and reset"), run: () => advancedScreen(player, back) }
            : null
    ].filter(Boolean)
}

async function serverScreen(player, back) {
    const again = () => serverScreen(player, back)
    return menu(player, {
        title: hubTitle("settings", "Server"),
        body: subtitle("How this server works for everyone."),
        buttons: serverButtons(player, again),
        back
    })
}

// Fine-tuning that most servers never need, kept out of the way. Factory reset
// also needs OPERATOR, because throwing away every change at once is a bigger
// act than changing one value; its own screen checks again.
async function advancedScreen(player, back) {
    const again = () => advancedScreen(player, back)
    const settings = has(player, "admin.settings")
    return menu(player, {
        title: hubTitle("settings", "Advanced"),
        body: subtitle("For fine-tuning. Most servers never need these."),
        buttons: [
            settings
                ? { text: hubEntry("settings", "Every setting", "Change any value, one at a time"), run: () => allValuesScreen(player, again) }
                : null,
            settings
                ? { text: hubEntry("presets", "Saved setups", "Save your settings, or load a saved set"), run: () => configPresetsScreen(player, again) }
                : null,
            canUseCode(player)
                ? { text: hubEntry("code", "< Code >", "Edit every setting as text"), run: () => codeScreen(player, again) }
                : null,
            settings && hasOperator(player)
                ? { text: hubEntry("actions", "Factory reset", "Undo every change and go back to the defaults"), run: () => factoryResetScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

// --------------------------------------------------------------------- Help

async function helpScreen(player, back) {
    const again = () => helpScreen(player, back)
    return menu(player, {
        title: hubTitle("about", "Help"),
        body: [
            `§l§bAdmin§d+§r §7version ${ADMINPLUS_VERSION}`,
            "",
            `§7Your rank: §r${primaryRank(player)?.display ?? "§7none"}`,
            "§7This panel is for staff. Every player has §f/menu§7.",
            "§7Type a command on its own and it asks for the rest."
        ].join("\n"),
        buttons: [
            { text: hubEntry("about", "What can I do?", "Commands and tools, explained"), run: () => infoScreen(player, again) },
            { text: hubEntry("about", "Credits", "Who made Admin+"), run: () => creditsScreen(player, again) }
        ],
        back
    })
}
