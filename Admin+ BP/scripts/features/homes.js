import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { flag } from "../core/settings.js"
import { queueTeleport } from "../core/teleport.js"
import { teleportTo } from "../core/warps.js"
import {
    homesOf, getHome, setHome, deleteHome, homeLimit, normaliseHomeId
} from "../core/homes.js"

// /sethome, /home, /homes, /delhome — and the same thing in the panel.
//
// **A warp is the server's, a home is yours.** Everything here follows from
// that: nobody else's homes are listed, named, or counted anywhere a player can
// see, and there is no staff screen for reading them. Somebody's base
// coordinates are the one thing on a survival server worth actually hiding, and
// a panel that shows them to every moderator is a griefing tool with a nice UI.
//
// How many you may have is a RANK value (`home.limit`), not a config number —
// "more homes" is a natural thing to hand out with a rank, and hardcoding it
// means every world gets one person's guess. 0 means this rank sets none.

const NO_HOMES = "Homes are turned off here."

/** Their homes, or a message explaining why the list is empty. */
function mineOrWhy(player) {
    if (!flag("feature.homes")) return { list: [], why: NO_HOMES }
    const list = homesOf(player.id)
    if (list.length) return { list }
    return {
        list,
        why: homeLimit(player) > 0
            ? "You haven't set a home yet — stand where you want it and use §f/sethome§7."
            : "Your rank can't set homes."
    }
}

/** Go to one, through the shared warmup so it cannot be used to flee a fight. */
function goHome(player, home) {
    return queueTeleport(player, home.display, () => {
        if (teleportTo(player, home)) ok(player, `Home — §f${home.display}§a.`)
        else err(player, "That home is in a dimension that isn't loaded.")
    }, "home.cooldown")
}

command({
    name: "sethome",
    description: "Set a home where you stand — /sethome [name]",
    optional: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        const result = setHome(player, name || "home")
        if (!result.ok) return err(player, result.reason)
        const limit = homeLimit(player)
        const used = homesOf(player.id).length
        return ok(player, result.replaced
            ? `Moved §f${result.home.display}§a here.`
            : `Home §f${result.home.display}§a set. §7(${used}/${limit})`)
    }
})

command({
    name: "home",
    description: "Go to one of your homes — /home [name]",
    optional: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        const { list, why } = mineOrWhy(player)
        if (!list.length) return info(player, why)

        // No name and exactly one home is the overwhelmingly common case, so it
        // goes straight there rather than opening a menu to pick from one.
        if (!name) {
            if (list.length === 1) return goHome(player, list[0])
            return homesScreen(player, () => {})
        }
        const home = getHome(player.id, name)
        if (!home) {
            return err(player, `No home called §f${name}§c. You have: §f`
                + list.map(h => h.display).join("§c, §f"))
        }
        return goHome(player, home)
    }
})

command({
    name: "homes",
    description: "List your homes — /homes",
    run: (player) => homesScreen(player, () => {})
})

command({
    name: "delhome",
    description: "Delete one of your homes — /delhome <name>",
    mandatory: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.homes")) return info(player, NO_HOMES)
        const home = getHome(player.id, name)
        if (!home) return err(player, `You have no home called §f${name}§c.`)
        deleteHome(player.id, normaliseHomeId(name))
        return ok(player, `Deleted §f${home.display}§a.`)
    }
})

// ------------------------------------------------------------------- the panel

export async function homesScreen(player, back) {
    const again = () => homesScreen(player, back)
    const { list, why } = mineOrWhy(player)
    const limit = homeLimit(player)

    if (!list.length) {
        info(player, why)
        return back()
    }

    return pagedMenu(player, {
        title: hubTitle("warps", "Your homes"),
        body: subtitle(`${list.length} of ${limit} used.`),
        items: list,
        render: home => ({
            text: `§f${home.display}§r\n§8${Math.round(home.x)}, ${Math.round(home.y)}, `
                + `${Math.round(home.z)} · ${String(home.dimension).replace("minecraft:", "")}`
        }),
        onPick: home => homeScreen(player, home, again),
        extra: [
            { text: hubEntry("warps", "Set one here", "Where you are standing now"), run: () => setHereScreen(player, again) }
        ],
        back
    })
}

async function homeScreen(player, home, back) {
    return menu(player, {
        title: hubTitle("warps", home.display),
        body: [
            subtitle(`${Math.round(home.x)}, ${Math.round(home.y)}, ${Math.round(home.z)}`),
            `§8${String(home.dimension).replace("minecraft:", "")}`
        ].join("\n"),
        buttons: [
            { text: hubEntry("warps", "Go", "Travel there"), run: () => goHome(player, home) },
            { text: hubEntry("warps", "Move it here", "Put this home where you stand"), run: async () => {
                const result = setHome(player, home.display)
                if (!result.ok) return err(player, result.reason)
                ok(player, `Moved §f${home.display}§a here.`)
                return back()
            } },
            { text: "§cDelete", run: () => deleteScreen(player, home, back) }
        ],
        back
    })
}

async function setHereScreen(player, back) {
    const values = await modal(player, hubTitle("warps", "Set a home"), [
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

async function deleteScreen(player, home, back) {
    const yes = await confirm(player, hubTitle("warps", `Delete ${home.display}`),
        `Delete your home §f${home.display}§r?\n\n§8You can set it again later.`,
        "§cDelete")
    if (!yes) return back()
    deleteHome(player.id, home.id)
    ok(player, `Deleted §f${home.display}§a.`)
    return back()
}
