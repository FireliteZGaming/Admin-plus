import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { queueTeleport } from "../core/teleport.js"
import { teleportTo } from "../core/warps.js"
import {
    homesOf, getHome, setHome, deleteHome, homeLimit, normaliseHomeId
} from "../core/homes.js"

// /home — one command, and a screen behind it.
//
// **It used to be four commands**: /sethome, /home, /homes, /delhome. That is
// the Essentials shape and it is four things to remember, three of which you
// use once a week. Asked for 2026-09-20: one command that opens a screen you
// pick from.
//
//   /home
//     ├─ Teleport   the list, tap one, go
//     └─ Homes      make one, move one, rename one, delete one
//
// `/home <name>` still goes straight there. It costs nothing to keep and it is
// what somebody types on their fourth day; the bare command is what they type
// on their first, and that is the one that opens the screen.
//
// A warp is the server's, a home is yours — so homes are stored per player,
// never listed to anybody else, and there is no staff screen for reading them.
// Somebody's base coordinates are the one thing on a survival server genuinely
// worth hiding.

const OFF = "Homes are turned off on this server."

/** Go to one, through the shared warmup so it cannot be used to flee a fight. */
function goHome(player, home) {
    return queueTeleport(player, home.display, () => {
        if (teleportTo(player, home)) ok(player, `Home — §f${home.display}§a.`)
        else err(player, "That home is in a dimension that isn't loaded.")
    }, "home.cooldown")
}

command({
    name: "home",
    description: "Go to one of your homes, or set one",
    optional: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.homes")) return info(player, OFF)

        // Named: go. That is the whole point of having named them.
        if (name) {
            const home = getHome(player.id, name)
            if (!home) {
                const mine = homesOf(player.id)
                return err(player, mine.length
                    ? `No home called §f${name}§c. You have: §f${mine.map(h => h.display).join("§c, §f")}`
                    : `You haven't set a home yet. Use §f/home§c and pick §fHomes§c.`)
            }
            return goHome(player, home)
        }
        return homesScreen(player, () => {})
    }
})

// -------------------------------------------------------------------- screens

export async function homesScreen(player, back) {
    if (!flag("feature.homes")) { info(player, OFF); return back() }

    const again = () => homesScreen(player, back)
    const mine = homesOf(player.id)
    const limit = homeLimit(player)

    if (limit <= 0) {
        info(player, "Your rank can't set homes.")
        return back()
    }

    return menu(player, {
        title: hubTitle("warps", "Homes"),
        body: subtitle(mine.length
            ? `${mine.length} of ${limit} set.`
            : "Nothing set yet. Open Homes to make your first one."),
        buttons: [
            // Teleport first: going somewhere is what this is for, and
            // managing the list is the rarer job.
            mine.length
                ? { text: hubEntry("warps", "Teleport", `Go to one of your ${mine.length}`), run: () => travelScreen(player, again) }
                : null,
            { text: hubEntry("warps", "Homes", mine.length ? "Make, move, rename or delete" : "Make your first one"), run: () => manageScreen(player, again) }
        ].filter(Boolean),
        back
    })
}

/** The going-somewhere half. */
async function travelScreen(player, back) {
    const mine = homesOf(player.id)
    if (!mine.length) { info(player, "You haven't set a home yet."); return back() }

    // One home and nothing to choose between: go, rather than showing a list of
    // one. The screen exists to pick from, and there is nothing to pick.
    if (mine.length === 1) return goHome(player, mine[0])

    return pagedMenu(player, {
        title: hubTitle("warps", "Teleport"),
        body: subtitle("Tap one to go."),
        items: mine,
        render: home => ({ text: `§f${home.display}§r\n§8${where(home)}` }),
        onPick: home => goHome(player, home),
        back
    })
}

/** The keeping-them-tidy half. */
async function manageScreen(player, back) {
    const again = () => manageScreen(player, back)
    const mine = homesOf(player.id)
    const limit = homeLimit(player)

    return pagedMenu(player, {
        title: hubTitle("warps", "Homes"),
        body: subtitle(`${mine.length} of ${limit} used.`),
        items: mine,
        render: home => ({ text: `§f${home.display}§r\n§8${where(home)}` }),
        onPick: home => homeScreen(player, home, again),
        extra: [
            mine.length < limit
                ? { text: hubEntry("warps", "New home", "Where you are standing now"), run: () => createScreen(player, again) }
                : { text: `§8Full — ${limit} of ${limit}\n§8Delete one to make room`, run: again }
        ],
        back
    })
}

function where(home) {
    return `${Math.round(home.x)}, ${Math.round(home.y)}, ${Math.round(home.z)}`
        + ` · ${String(home.dimension).replace("minecraft:", "")}`
}

async function homeScreen(player, home, back) {
    return menu(player, {
        title: hubTitle("warps", home.display),
        body: subtitle(where(home)),
        buttons: [
            { text: hubEntry("warps", "Go", "Travel there"), run: () => goHome(player, home) },
            { text: hubEntry("warps", "Move it here", "Put this home where you stand"), run: async () => {
                const result = setHome(player, home.display)
                if (!result.ok) return err(player, result.reason)
                ok(player, `Moved §f${home.display}§a here.`)
                return back()
            } },
            { text: hubEntry("warps", "Rename", "Same place, different name"), run: () => renameScreen(player, home, back) },
            { text: "§cDelete", run: () => deleteScreen(player, home, back) }
        ],
        back
    })
}

async function createScreen(player, back) {
    const values = await modal(player, hubTitle("warps", "New home"), [
        { id: "name", type: "text", label: "What to call it", placeholder: "base" }
    ])
    if (!values) return back()
    const result = setHome(player, String(values.name ?? "").trim() || "home")
    if (!result.ok) return err(player, result.reason)
    ok(player, result.replaced
        ? `Moved §f${result.home.display}§a here.`
        : `Home §f${result.home.display}§a set.`)
    return back()
}

/**
 * Rename without moving.
 *
 * Done as a delete-then-set rather than an edit in place, because the id IS the
 * name — and the new home is written at the OLD coordinates, not at the
 * player's feet. Renaming somewhere you are not standing must not quietly move
 * it to where you are.
 */
async function renameScreen(player, home, back) {
    const values = await modal(player, hubTitle("warps", `Rename ${home.display}`), [
        { id: "name", type: "text", label: "New name", placeholder: home.display }
    ])
    if (!values) return back()
    const wanted = String(values.name ?? "").trim()
    if (!wanted || normaliseHomeId(wanted) === home.id) return back()

    if (getHome(player.id, wanted)) {
        return err(player, `You already have a home called §f${wanted}§c.`)
    }
    deleteHome(player.id, home.id)
    const result = setHome(player, wanted, { x: home.x, y: home.y, z: home.z })
    if (!result.ok) {
        // Put it back rather than losing it to a failed rename.
        setHome(player, home.display, { x: home.x, y: home.y, z: home.z })
        return err(player, result.reason)
    }
    ok(player, `§f${home.display}§a is now §f${result.home.display}§a.`)
    return back()
}

async function deleteScreen(player, home, back) {
    const yes = await confirm(player, hubTitle("warps", `Delete ${home.display}`),
        `Delete your home §f${home.display}§r?\n\n§8You can set it again later.`,
        "§cDelete")
    if (!yes) return back()
    deleteHome(player.id, home.id)
    ok(player, `Deleted §f${home.display}§a.`)
    return back()
}
