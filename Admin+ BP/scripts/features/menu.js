import { world } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, modal, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { tile } from "../core/look.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { displayName, stripCodes } from "../core/identity.js"
import { primaryRank, memberSince, isStaff, has, badgedTags, chatNameFor } from "../core/ranks.js"
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
import { homesScreen } from "./homes.js"
import { homeLimit } from "../core/homes.js"
import { claimsScreen } from "./claims.js"
import { claimLimit } from "../core/claims.js"
import { infoScreen } from "./info.js"
import { canPersonalize, personalizeScreen } from "./personalize.js"
import { runPackCommand } from "../core/dispatch.js"

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
            ? `§c⚠ Muted: ${remainingLabel(mute.until)} left`
            : "§c⚠ Muted")
        if (mute.reason) lines.push(`§8   "${mute.reason}"`)
    }

    return lines
}

/** How many lines the Profile card holds beside the model. */
const PROFILE_LINES = 6

/**
 * The Profile card's words, beside the player's own model, in Admin+'s own
 * look (2.12.3). The user: "in /menu, you can see your skin and then right by
 * it it has your rank, and stuff". Their name in their name effect, their
 * gamertag when they go by another name, their badge and tags, then what the
 * plain menu says. Never more than the card holds.
 */
export function profileLines(player) {
    const shown = displayName(player)
    const lines = [`§f${chatNameFor(player, shown)}§r`]
    if (stripCodes(shown) !== player.name) lines.push(`§8${player.name}`)
    const tags = badgedTags(player)
    if (tags) lines.push(tags)
    lines.push(...statsLines(player).slice(1))
    return lines.slice(0, PROFILE_LINES)
}

export async function openMenu(player) {
    const again = () => openMenu(player)
    const buttons = []

    if (travelButtons(player, again).length) {
        buttons.push({
            text: hubButton("warps", "Travel", "Spawn, warps, homes and more"),
            tile: tile("travel", "Travel", "Spawn, warps, homes"),
            run: () => travelScreen(player, again)
        })
    }

    buttons.push({
        text: hubButton("ranks", "People", "Teleport, private chat and reports"),
        tile: tile("people", "People", "Teleport and chat"),
        run: () => peopleScreen(player, again)
    })

    if (flag("feature.claims") && claimLimit(player) > 0) {
        buttons.push({
            text: hubButton("warps", "Land claims", "Protect what you build"),
            tile: tile("claims", "Land claims", "Protect your builds"),
            run: () => claimsScreen(player, again)
        })
    }

    const changed = changedCount(player)
    buttons.push({
        text: hubButton("settings", "My settings",
            changed ? `${changed} changed · only affects you` : "Teleport requests and messages · only affects you"),
        tile: tile("settings", "My settings", changed ? `${changed} changed` : "Only affects you"),
        run: () => settingsScreen(player, again)
    })

    // Personalization (2.12.0, Beta): how you look to everyone else.
    if (canPersonalize(player)) {
        buttons.push({
            text: hubButton("chat", "Personalization", "Your name effects · only you change them"),
            tile: tile("personalize", "Personalization", "Name effects"),
            run: () => personalizeScreen(player, again)
        })
    }

    buttons.push({
        text: hubButton("about", "Help", "What you can do on this server"),
        tile: tile("help", "Help", "What you can do"),
        run: () => infoScreen(player, again)
    })

    // The Creator/Dev console, when the world allows it. Last, and coloured as
    // the dev escape hatch so it reads as apart from the member-facing rows
    // above it — because it is.
    if (canUseConsole(player)) {
        buttons.push({
            text: hubButton("code", "Console", "Run a server command"),
            tile: tile("console", "Console", "Run a command"),
            run: () => consoleScreen(player, again)
        })
    }

    // Tiles in Admin+'s own look (Beta), like /admin, under a Profile card. On
    // Default nothing changes: the body is the plain lines, as it always was.
    return menu(player, {
        title: hubTitle("ranks", "Menu"),
        body: statsLines(player).join("\n"),
        profile: profileLines(player).join("\n"),
        buttons,
        layout: "tiles"
    })
}

/**
 * Every way to go somewhere, in one place, so nobody has to know the commands.
 *
 * Each button runs the real command through core/dispatch.js, so the warmup,
 * the cooldown, the feature switch and the permission all apply exactly as if
 * it had been typed. Only what is switched on and allowed is shown.
 */
function travelButtons(player, back) {
    const run = name => {
        const result = runPackCommand(player, name)
        if (result && !result.ok) err(player, result.reason)
    }
    return [
        flag("feature.spawn") && has(player, "spawn.use")
            ? { text: hubEntry("warps", "Spawn", "The world's starting point"), run: () => run("spawn") }
            : null,
        flag("feature.warps") && has(player, "warp.use")
            ? { text: hubEntry("warps", "Warps", "Places the staff have set up"), run: () => warpListScreen(player, back) }
            : null,
        flag("feature.homes") && homeLimit(player) > 0
            ? { text: hubEntry("warps", "My homes", "Go home, or set a new one"), run: () => homesScreen(player, back) }
            : null,
        flag("feature.back")
            ? { text: hubEntry("warps", "Go back", "To where you were, or where you died"), run: () => run("back") }
            : null,
        flag("feature.rtp")
            ? { text: hubEntry("warps", "Random place", "Somewhere safe and far away"), run: () => run("rtp") }
            : null
    ].filter(Boolean)
}

async function travelScreen(player, back) {
    const again = () => travelScreen(player, back)
    return menu(player, {
        title: hubTitle("warps", "Travel"),
        body: subtitle("Where do you want to go?"),
        buttons: travelButtons(player, again),
        back
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
            text: hubEntry("warps", "Teleport to them", "Asks first. They can say no."),
            run: () => { requestTo(player, still); return back() }
        })
        buttons.push({
            text: hubEntry("warps", "Ask them to come here", "Asks first. They can say no."),
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
            buttons.length ? "§8Nothing here happens unless they agree." : "§7Nothing here is open to you for this player."
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
    description: "Open your menu: travel, people and settings",
    run: (player) => openMenu(player)
})

export { PREFS }
