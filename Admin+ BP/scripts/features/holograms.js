import { world } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { record } from "../core/logs.js"
import { list, get, save, remove, removeAll, render, sync, count } from "../core/holograms.js"

// /admin ▸ Holograms, and /hologram for people who would rather type.
//
// One screen rather than five commands: floating text is placed where you are
// standing, so the only argument that ever mattered was your own position, and
// everything else is text you would rather see a form for than spell out.

const NODE = "admin.holograms"

function here(player) {
    const at = player.location
    return {
        dimension: player.dimension.id,
        x: Math.round(at.x * 10) / 10,
        y: Math.round(at.y * 10) / 10,
        z: Math.round(at.z * 10) / 10
    }
}

function where(holo) {
    const dim = String(holo.dimension).replace("minecraft:", "")
    return `${Math.round(holo.x)} ${Math.round(holo.y)} ${Math.round(holo.z)} §8· ${dim}`
}

/** First line only, for a button that has one line to spare. */
function preview(holo) {
    const text = render(holo).split("\n")[0] ?? ""
    return text.length > 40 ? text.slice(0, 39) + "…" : text
}

export async function hologramsScreen(player, back) {
    if (!has(player, NODE)) { err(player, "You can't manage holograms."); return back ? back() : undefined }
    const again = () => hologramsScreen(player, back)
    const all = list()

    return menu(player, {
        title: hubTitle("warps", "Holograms"),
        body: [
            subtitle("Floating text, and leaderboards that read a scoreboard."),
            "",
            all.length
                ? `§f${all.length}§7 placed. They rebuild themselves if anything removes them.`
                : "§8Nothing placed yet. They appear where you are standing."
        ].join("\n"),
        buttons: [
            { text: hubEntry("warps", "+ New text", "A line of writing, hanging where you stand"), run: () => textScreen(player, undefined, again) },
            { text: hubEntry("warps", "+ New leaderboard", "Top scores from a scoreboard objective"), run: () => boardScreen(player, undefined, again) },
            ...all.map(holo => ({
                text: `${holo.kind === "board" ? "§b" : "§a"}${holo.id}§r §8· ${where(holo)}\n§8${preview(holo)}`,
                run: () => oneScreen(player, holo.id, again)
            })),
            all.length
                ? { text: "§cRemove every hologram", run: () => clearScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function oneScreen(player, id, back) {
    const holo = get(id)
    if (!holo) { err(player, "That hologram is gone."); return back() }
    const again = () => oneScreen(player, id, back)

    return menu(player, {
        title: hubTitle("warps", holo.id),
        body: [
            `§fKind: §7${holo.kind === "board" ? "leaderboard" : "text"}`,
            `§fWhere: §7${where(holo)}`,
            holo.kind === "board" ? `§fObjective: §7${holo.objective || "§cnone set"}` : "",
            "",
            "§fShowing now",
            render(holo) || "§8(empty)"
        ].filter(Boolean).join("\n"),
        buttons: [
            {
                text: "§bEdit",
                run: () => holo.kind === "board" ? boardScreen(player, holo.id, again) : textScreen(player, holo.id, again)
            },
            {
                text: `§bMove it here§r\n§8${where({ ...here(player) })}`,
                run: () => {
                    save(holo.id, here(player))
                    sync()
                    record(player, "hologram.move", undefined, holo.id)
                    ok(player, `Moved §f${holo.id}§a to where you are standing.`)
                    return again()
                }
            },
            {
                text: "§cRemove",
                run: async () => {
                    const yes = await confirm(player, hubTitle("warps", holo.id),
                        `Remove §f${holo.id}§r?\n\n§8The text is deleted; nothing else is touched.`, "§cRemove")
                    if (!yes) return again()
                    remove(holo.id)
                    record(player, "hologram.delete", undefined, holo.id)
                    ok(player, `Removed §f${holo.id}§a.`)
                    return back()
                }
            }
        ],
        back
    })
}

async function textScreen(player, id, back) {
    const holo = id ? get(id) : undefined
    const values = await modal(player, hubTitle("warps", holo ? `Edit ${holo.id}` : "New text"), [
        holo
            ? null
            : { id: "id", type: "text", label: "Name §8· letters, digits, - and _", placeholder: "rules" },
        {
            id: "text",
            type: "text",
            label: "The text §8· \\n starts a new line · {ONLINE} {DAY}",
            default: holo?.text ?? "§6§lWelcome\\n§7Be nice to each other",
            placeholder: "§6§lWelcome"
        }
    ].filter(Boolean))
    if (!values) return back()

    const result = save(holo?.id ?? values.id, {
        kind: "text",
        text: values.text,
        ...(holo ? {} : here(player))
    })
    if (!result.ok) { err(player, result.reason); return back() }

    sync()
    record(player, holo ? "hologram.edit" : "hologram.create", undefined, result.holo.id)
    ok(player, `${holo ? "Updated" : "Placed"} §f${result.holo.id}§a.`)
    if (!holo) info(player, "§7It is standing where you are. Move it from its own screen.")
    return back()
}

async function boardScreen(player, id, back) {
    const holo = id ? get(id) : undefined
    const objectives = (() => {
        try { return world.scoreboard.getObjectives().map(o => o.id) } catch { return [] }
    })()

    if (!objectives.length) {
        err(player, "There are no scoreboard objectives on this world yet.")
        info(player, "§7Make one first: §f/scoreboard objectives add kills dummy \"Kills\"")
        return back()
    }

    const current = Math.max(0, objectives.indexOf(holo?.objective ?? ""))
    const values = await modal(player, hubTitle("warps", holo ? `Edit ${holo.id}` : "New leaderboard"), [
        holo
            ? null
            : { id: "id", type: "text", label: "Name §8· letters, digits, - and _", placeholder: "topkills" },
        { id: "objective", type: "dropdown", label: "Scoreboard objective", options: objectives, default: current },
        { id: "title", type: "text", label: "Heading §8· blank for none", default: holo?.title ?? "§6§lTop Players" },
        {
            id: "format",
            type: "text",
            label: "One row §8· {INDEX} {NAME} {SCORE}",
            default: holo?.format ?? "§7{INDEX}. §f{NAME} §8— §a{SCORE}"
        },
        { id: "max", type: "slider", label: "How many rows", min: 1, max: 25, step: 1, default: holo?.max ?? 10 },
        { id: "ascending", type: "toggle", label: "Lowest first §8· off means highest first", default: !!holo?.ascending }
    ].filter(Boolean))
    if (!values) return back()

    const result = save(holo?.id ?? values.id, {
        kind: "board",
        objective: objectives[values.objective] ?? objectives[0],
        title: values.title,
        format: values.format,
        max: values.max,
        ascending: !!values.ascending,
        ...(holo ? {} : here(player))
    })
    if (!result.ok) { err(player, result.reason); return back() }

    sync()
    record(player, holo ? "hologram.edit" : "hologram.create", undefined, `${result.holo.id} · ${result.holo.objective}`)
    ok(player, `${holo ? "Updated" : "Placed"} §f${result.holo.id}§a.`)
    if (!holo) info(player, "§7It is standing where you are. Move it from its own screen.")
    return back()
}

async function clearScreen(player, back) {
    const n = count()
    const yes = await confirm(player, hubTitle("warps", "Remove every hologram"),
        `Delete all §f${n}§r hologram${n === 1 ? "" : "s"}?\n\n§8There is no undo for this one.`, "§cRemove all")
    if (!yes) return back()
    removeAll()
    record(player, "hologram.clear", undefined, `${n} removed`)
    ok(player, `Removed §f${n}§a hologram${n === 1 ? "" : "s"}.`)
    return back()
}

command({
    name: "hologram",
    description: "Place and edit floating text — /hologram",
    perm: NODE,
    run: (player) => hologramsScreen(player, undefined)
})

export { NODE as HOLOGRAM_NODE }
