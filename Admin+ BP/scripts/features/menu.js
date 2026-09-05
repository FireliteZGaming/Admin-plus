import { world } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { primaryRank, memberSince, isStaff } from "../core/ranks.js"
import { warningCount } from "../core/warnings.js"
import { muteRecord } from "../core/moderation.js"
import { remainingLabel } from "../core/grants.js"
import { isVanished } from "../core/vanish.js"
import { prefsOf, setPref, changedCount, PREFS } from "../core/prefs.js"
import { requestTo, requestHere } from "./tpa.js"
import { askPrivateChat } from "./privatechat.js"
import { reportForm } from "./reports.js"
import { warpListScreen } from "./warps.js"
import { canUseConsole, consoleScreen } from "./console.js"

// /menu — the other half of panel-first.
//
// /admin exists so staff never have to memorise commands. Members had no such
// thing: everything they can do is a command they have to be told about once
// and then remember forever. This is the same idea pointed the other way.
//
// It is NOT a small /admin. The verbs are different: staff ACT ON players,
// members REACH them. So the section is called People rather than Actions, and
// nothing in here does anything to anybody without their consent.
//
// No permission node. A menu of things you were already allowed to do is not a
// privilege, and gating it would mean a member on an existing world being
// refused until somebody re-applied the ladder — rank tables are per world, so
// a node added in an update reaches nobody already running. Same reasoning as
// /warnings.

const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"]

/** "3 September". Written out rather than toLocaleDateString, which is not
 *  dependable on this runtime and would read differently per client anyway. */
function dayLabel(ts) {
    if (!ts) return undefined
    try {
        const d = new Date(ts)
        return `${d.getDate()} ${MONTHS[d.getMonth()]}`
    } catch { return undefined }
}

/**
 * The lines above the buttons.
 *
 * Deliberately answers rather than statistics. A member's own numbers stop
 * being interesting after two seconds; what they actually want to know is why
 * chat is ignoring them and how much trouble they are in — questions they would
 * otherwise have to interrupt a moderator to ask.
 *
 * Conditional lines only. Four lines of "none" would push the buttons off a
 * phone screen to tell somebody nothing.
 */
export function statsLines(player) {
    const lines = []

    const rank = primaryRank(player)
    lines.push(`§f${displayName(player)}§r${rank ? ` §8·§r ${rank.display}` : ""}`)

    const since = dayLabel(memberSince(player))
    if (since) lines.push(`§8Here since ${since}`)

    const warnings = warningCount(player)
    if (warnings) {
        lines.push(`§e${warnings} warning${warnings === 1 ? "" : "s"}§8 · /warnings to read them`)
    }

    // The one that earns its place. A muted player types, watches nothing
    // happen, and asks staff why. This says what happened and when it ends.
    const mute = muteRecord(player)
    if (mute) {
        lines.push(mute.until
            ? `§c⚠ Muted — ${remainingLabel(mute.until)} left`
            : "§c⚠ Muted")
        if (mute.reason) lines.push(`§8   "${mute.reason}"`)
    }

    return lines
}

export async function openMenu(player) {
    const again = () => openMenu(player)
    const buttons = []

    buttons.push({
        text: hubButton("ranks", "People", "Teleport, private chat, or report someone"),
        run: () => peopleScreen(player, again)
    })

    if (flag("feature.warps") || flag("feature.spawn")) {
        buttons.push({
            text: hubButton("warps", "Travel", "Warps and spawn"),
            run: () => warpListScreen(player, again)
        })
    }

    const changed = changedCount(player)
    buttons.push({
        text: hubButton("settings", "Settings",
            changed ? `Yours alone · ${changed} changed` : "Yours alone · teleports, messages"),
        run: () => settingsScreen(player, again)
    })

    // The Creator/Dev console, when the world allows it. Last, and coloured as
    // the dev escape hatch so it reads as apart from the member-facing rows
    // above it — because it is.
    if (canUseConsole(player)) {
        buttons.push({
            text: hubButton("code", "Console", "Run a server command"),
            run: () => consoleScreen(player, again)
        })
    }

    return menu(player, {
        title: hubTitle("ranks", "Menu"),
        body: statsLines(player).join("\n"),
        buttons
    })
}

/**
 * Who else is here.
 *
 * Vanished players are left out. A member seeing a hidden moderator in a list
 * would undo the entire point of vanish, and it would be this screen that gave
 * them away rather than anything the moderator did.
 */
function visibleOthers(player) {
    return world.getAllPlayers()
        .filter(p => p.id !== player.id && !isVanished(p))
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
}

async function peopleScreen(player, back) {
    const others = visibleOthers(player)
    if (!others.length) {
        info(player, "§7Nobody else is online.")
        return back()
    }
    return menu(player, {
        title: hubTitle("ranks", "People"),
        body: subtitle(`${others.length} other player${others.length === 1 ? "" : "s"} online.`),
        buttons: others.map(target => ({
            text: hubEntry("ranks", displayName(target), primaryRank(target)?.display ?? ""),
            run: () => personScreen(player, target, () => peopleScreen(player, back))
        })),
        back
    })
}

async function personScreen(player, target, back) {
    // Re-read them every time: this screen can sit open while they leave, and
    // acting on a stale Player object throws rather than saying they are gone.
    const still = world.getAllPlayers().find(p => p.id === target.id)
    if (!still) { err(player, `${displayName(target)} has left.`); return back() }

    const buttons = []
    if (flag("feature.tpa")) {
        buttons.push({
            text: hubEntry("warps", "Teleport to them", "Asks first — they can say no"),
            run: () => { requestTo(player, still); return back() }
        })
        buttons.push({
            text: hubEntry("warps", "Ask them to come here", "Asks first — they can say no"),
            run: () => { requestHere(player, still); return back() }
        })
    }
    if (flag("feature.pm")) {
        buttons.push({
            text: hubEntry("ranks", "Private chat", "A two-person chat, if they accept"),
            run: () => { askPrivateChat(player, still); return back() }
        })
    }
    if (flag("feature.reports")) {
        buttons.push({
            text: hubEntry("actions", "Report", "Tell staff about them"),
            run: () => reportForm(player, still)
        })
    }

    return menu(player, {
        title: hubTitle("ranks", displayName(still)),
        body: [
            `§f${displayName(still)}§r${primaryRank(still) ? ` §8·§r ${primaryRank(still).display}` : ""}`,
            isStaff(still) ? "§8Staff" : "",
            "",
            buttons.length ? "§8Nothing here happens without their say-so." : "§7There is nothing you can do from here."
        ].filter(Boolean).join("\n"),
        buttons,
        back
    })
}

/**
 * The player's own switches.
 *
 * Every one of these is read by a feature — see PREFS in core/prefs.js, which
 * names the file that honours each. A screen of switches that change nothing is
 * worse than no screen, because the player believes they turned something off.
 */
async function settingsScreen(player, back) {
    const current = prefsOf(player)
    const values = await modal(player, hubTitle("settings", "Your settings"),
        current.map(p => ({
            id: p.key,
            type: "toggle",
            label: `${p.label}\n§8${p.help}`,
            default: p.on
        })))
    if (!values) return back()

    const changed = []
    for (const p of current) {
        const now = !!values[p.key]
        if (now === p.on) continue
        setPref(player, p.key, now)
        changed.push(`${p.label} ${now ? "§aon" : "§8off"}`)
    }

    if (!changed.length) { info(player, "§7Nothing changed."); return back() }
    ok(player, `Updated: §r${changed.join("§a, ")}§a.`)
    return back()
}

command({
    name: "menu",
    description: "Your menu — teleports, private chat and your own settings",
    run: (player) => openMenu(player)
})

export { PREFS }
