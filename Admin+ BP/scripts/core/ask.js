import { world, CustomCommandParamType as P } from "@minecraft/server"
import { menu, pagedMenu, modal, subtitle } from "./ui.js"
import { hubTitle } from "./theme.js"
import { info } from "./util.js"
import { has, renderTags } from "./ranks.js"
import { displayName, getNickname, stripCodes } from "./identity.js"
import { isVanished } from "./vanish.js"
import { by } from "./logs.js"

// Asking for what a command was not given.
//
// The rule for the whole pack: leave an argument off and Admin+ asks for it.
// A player becomes a pick list, a fixed set of words becomes buttons, and text
// becomes a box. core/registry.js calls askFor() for every missing argument, so
// no command has to build its own prompt and no two commands can disagree.
//
// Every function here resolves to `undefined` when the form is closed, which
// the registry reads as "never mind" and stops.

// ------------------------------------------------------------- player order

/**
 * Does this row match what was typed? Gamertag and nickname, any case, anywhere
 * in the name, with colour codes stripped from both sides first.
 */
export function matches(row, needle) {
    const want = String(needle ?? "").trim().toLowerCase()
    if (!want) return true
    const hay = [row.name]
    if (row.player) {
        hay.push(stripCodes(displayName(row.player)))
        const nick = getNickname(row.player)
        if (nick) hay.push(stripCodes(nick))
    }
    return hay.some(h => String(h ?? "").toLowerCase().includes(want))
}

/**
 * Who goes at the top: online before offline, then whoever the viewer acted on
 * most recently, then nearest. Search is the fallback for a badly ordered list,
 * so the order comes first.
 */
export function relevance(viewer, rows) {
    const acted = new Map()
    for (const entry of by(viewer.id)) {
        const id = entry.target?.id
        if (id && !acted.has(id)) acted.set(id, entry.at)
    }
    const here = viewer.location
    const distance = row => {
        if (!row.player || !here) return Number.MAX_SAFE_INTEGER
        try {
            const l = row.player.location
            return (l.x - here.x) ** 2 + (l.y - here.y) ** 2 + (l.z - here.z) ** 2
        } catch { return Number.MAX_SAFE_INTEGER }
    }
    return [...rows].sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1
        const aa = acted.get(a.id), ba = acted.get(b.id)
        if (aa !== ba) return (ba ?? 0) - (aa ?? 0)
        if (!a.online) return a.name.localeCompare(b.name)
        return distance(a) - distance(b)
    })
}

// ------------------------------------------------------------------ prompts

/** Search appears once the list is long enough to need it. */
const SEARCH_FROM = 8

/**
 * The one player pick list.
 *
 * Vanished players are hidden unless the viewer may see vanish, the same rule
 * /vanished follows. `self` adds the viewer, `only(player, viewer)` filters
 * further, and `empty` is what to say when nobody is left to list.
 *
 * @returns {Promise<import("@minecraft/server").Player | undefined>}
 */
export async function pickPlayer(viewer, options = {}) {
    const { title = "Pick a player", body, self = false, only, empty, filter = "" } = options
    const seesVanished = has(viewer, "admin.vanish")
    const everyone = world.getAllPlayers()
        .filter(p => p.id === viewer.id ? self : (seesVanished || !isVanished(p)))
        .filter(p => !only || only(p, viewer))
        .map(p => ({ online: true, id: p.id, name: p.name, player: p }))

    if (!everyone.length) {
        info(viewer, empty ?? "Nobody else is online.")
        return undefined
    }

    const rows = relevance(viewer, everyone).filter(row => matches(row, filter))
    const reopen = text => pickPlayer(viewer, { ...options, filter: text })
    const search = async () => {
        const values = await modal(viewer, hubTitle("actions", "Search players"), [
            { id: "text", type: "text", label: "Gamertag or nickname", placeholder: "part of a name" }
        ])
        return reopen(String(values?.text ?? "").trim())
    }

    const extra = []
    if (filter) extra.push({ text: `§8Clear search §7"${filter}"`, run: () => reopen("") })
    else if (everyone.length >= SEARCH_FROM) {
        extra.push({ text: "§7Search§r\n§8Find somebody by name or nickname", run: search })
    }

    return pagedMenu(viewer, {
        title: hubTitle("actions", title),
        body: subtitle(filter
            ? `${rows.length} match${rows.length === 1 ? "" : "es"} for "§f${filter}§7".`
            : body ?? "Pick somebody. Nearest first."),
        items: rows,
        render: row => {
            const tag = renderTags(row.player)
            const you = row.id === viewer.id ? " §8(you)" : ""
            return { text: `${tag ? tag + "§r " : ""}§9${displayName(row.player)}§r${you}` }
        },
        onPick: row => row.player,
        extra
    })
}

/**
 * Pick one entry from a list. `items` are rendered by `render(item)` into
 * button text; resolves to the item picked.
 */
export async function pickFrom(viewer, { title, body, items, render: draw, empty }) {
    if (!items.length) {
        if (empty) info(viewer, empty)
        return undefined
    }
    return pagedMenu(viewer, {
        title: hubTitle("actions", title),
        body: body ? subtitle(body) : undefined,
        items,
        render: item => ({ text: draw ? draw(item) : String(item) }),
        onPick: item => item
    })
}

/** One line of text. Empty counts as closing the form. */
export async function askText(viewer, { title, label, placeholder = "" }) {
    const values = await modal(viewer, hubTitle("actions", title), [
        { id: "text", type: "text", label, placeholder }
    ])
    const text = String(values?.text ?? "").trim()
    return text || undefined
}

// ---------------------------------------------------------- one missing slot

/** `a:warnaction` -> `warnaction`; `target_me_or_all` -> `target`. */
function plainName(param) {
    return String(param.name ?? "")
        .replace(/^[a-z0-9_]+:/i, "")
        .replace(/_(me_or_all|or_me)$/, "")
}

/** Types askFor() can prompt for without the command's help. */
const ASKABLE = new Set([P.PlayerSelector, P.Enum, P.String, P.Integer, P.Float])

/** Can a missing value for this parameter be asked for? */
export function askable(param) {
    return typeof param?.ask === "function" || ASKABLE.has(param?.type)
}

/**
 * Ask for one missing argument, in the shape the handler expects it.
 *
 * A parameter may carry its own `ask(player)` for lists only it knows (warps,
 * bans, waiting requests). Otherwise the type decides the prompt. `choices`
 * narrows an Enum to the values worth a button, and `label` words the prompt.
 *
 * @param {string[]} [enumValues] the registered values, for an Enum parameter
 */
export async function askFor(player, spec, param, enumValues) {
    if (typeof param.ask === "function") return param.ask(player)

    const title = `/${spec.name}`
    const label = param.label ?? plainName(param)

    if (param.type === P.PlayerSelector) {
        const picked = await pickPlayer(player, {
            title, body: param.label, self: !!param.self, only: param.only, empty: param.empty
        })
        return picked ? [picked] : undefined
    }

    if (param.type === P.Enum) {
        const values = param.choices ?? enumValues ?? []
        if (!values.length) return undefined
        return menu(player, {
            title: hubTitle("actions", title),
            body: subtitle(param.label ?? "Pick one."),
            buttons: values.map(value => ({ text: `§f${value}`, run: () => value }))
        })
    }

    const text = await askText(player, { title, label, placeholder: param.placeholder })
    if (text === undefined) return undefined
    if (param.type === P.Integer || param.type === P.Float) {
        const n = Number(text)
        if (!Number.isFinite(n)) { info(player, `"§f${text}§7" is not a number.`); return undefined }
        return param.type === P.Integer ? Math.trunc(n) : n
    }
    return text
}
