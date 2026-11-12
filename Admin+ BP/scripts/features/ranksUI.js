import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { setting, flag } from "../core/settings.js"
import { record } from "../core/logs.js"
import { ok, err, info } from "../core/util.js"
import { stripCodes, displayName } from "../core/identity.js"
import { STYLES, STYLE_IDS, paint } from "../core/nametag.js"
import {
    ladder, getRank, saveRank, deleteRank, normaliseRankId, moveRank,
    PRESETS, BUNDLES, PERMISSION_NODES, RANK_VALUES,
    applyPreset, restoreSnapshot, hasSnapshot, snapshot,
    canEditRank, canActOn, has, rankState, rankGrant, displacedBy, defaultRank,
    playerRanks, displayRanks, heldRankIds, primaryRank, moveHeldRank,
    setRanks, grantRank, revokeRank, knownHolders, nodeLabels, refreshNameTag, topWeight
} from "../core/ranks.js"

// /admin ▸ Ranks
//
// Opening Ranks shows the ranks themselves, strongest first, because that is
// what somebody came to look at. Everything else hangs off that list:
//
//   tap a rank         change its name, colour, permissions, limits, effect
//   + New rank         a name and a colour; no ids and no § codes to type
//   Give a rank        pick a player, then give or take ranks
//   Rank templates     replace the whole list with a ready-made one
//
// Two orders, kept apart on purpose:
//   the LIST order is the hierarchy. A rank outranks everything below it, and
//     that is where all authority comes from. No weight numbers are shown.
//   a PLAYER's own order only picks which of their ranks shows as their tag.
//
// The numbers a rank carries live in RANK_VALUES in core/ranks.js, beside the
// code that reads them.

/** The colours a rank can be given without typing a § code. */
const COLOURS = [
    ["White", "f"], ["Gray", "7"], ["Dark gray", "8"], ["Black", "0"],
    ["Red", "c"], ["Dark red", "4"], ["Gold", "6"], ["Yellow", "e"],
    ["Green", "a"], ["Dark green", "2"], ["Aqua", "b"], ["Dark aqua", "3"],
    ["Blue", "9"], ["Dark blue", "1"], ["Pink", "d"], ["Purple", "5"]
]
const COLOUR_OPTIONS = COLOURS.map(([label, code]) => `§${code}${label}`)

/**
 * How a rank's display text is made up, read back so the editor can show it.
 * `simple` means one colour and maybe bold, which the colour list can redraw
 * exactly. Anything fancier (two colours, like VIP+) is kept unless changed.
 * Bedrock has no strikethrough or underline: k, l, o and r are the only
 * formatting letters, and every other code is a colour.
 */
function lookOf(display) {
    const text = String(display ?? "")
    return {
        name: stripCodes(text),
        code: (text.match(/§([0-9a-jmnpqstuv])/i) ?? [])[1],
        bold: text.includes("§l"),
        simple: /^(§[0-9a-jmnpqstuv])?(§l)?[^§]*$/i.test(text)
    }
}

/** A rank's name as plain text, for titles and messages. */
const nameOf = rank => stripCodes(String(rank?.display ?? "")) || rank?.id || "this rank"

export async function ranksScreen(player, back) {
    // Somebody who may hand out ranks but not edit them goes straight to the
    // one thing they can do.
    if (!has(player, "ranks.manage")) return rankPlayersScreen(player, back)
    return ladderScreen(player, back)
}

// ================================================================ the list

function ladderLine(rank, index) {
    const flags = []
    if (rank.staff) flags.push("staff")
    if (rank.default) flags.push("new players get it")
    const suffix = flags.length ? `\n§8${flags.join(" · ")}` : ""
    return `§8${index + 1}. §r${rank.display}§r${suffix}`
}

async function ladderScreen(player, back) {
    const ranks = ladder()
    const again = () => ladderScreen(player, back)
    return pagedMenu(player, {
        title: hubTitle("ranks", "Ranks"),
        body: subtitle("Strongest first. A rank outranks every rank below it.\nTap a rank to change it."),
        items: ranks,
        render: (rank) => ({ text: ladderLine(rank, ranks.indexOf(rank)) }),
        onPick: rank => rankScreen(player, rank.id, again),
        extra: [
            { text: hubEntry("presets", "+ New rank", "Pick a name and a colour"), run: () => createRankScreen(player, again) },
            { text: hubEntry("ranks", "Give a rank to a player", "Or take one away"), run: () => rankPlayersScreen(player, again) },
            { text: hubEntry("presets", "Rank templates", "Replace the whole list with a ready-made one"), run: () => presetsScreen(player, again) },
            hasSnapshot()
                ? { text: "§8↺ Undo last change\n§8Puts back the list from before the last template or delete", run: () => undoScreen(player, again) }
                : null
        ].filter(Boolean),
        back
    })
}

async function undoScreen(player, back) {
    const yes = await confirm(player, hubTitle("ranks", "Undo last change"),
        "Put the rank list back the way it was before the last template or delete?\n\n§7Players keep the ranks they have.", "§eUndo")
    if (!yes) return back()
    restoreSnapshot()
    ok(player, "The rank list is back the way it was.")
    return back()
}

/** One rank: what it is, what it can do, and every way to change it. */
export async function rankScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) { err(player, "That rank no longer exists."); return back() }

    const rows = ladder()
    const index = rows.findIndex(r => r.id === rankId)
    const editable = canEditRank(player, rank)
    const again = () => rankScreen(player, rankId, back)

    // What the HOLDER ends up with, per group, counted the same way the
    // switches are drawn, so this summary and those screens always agree.
    const groups = Object.entries(PERMISSION_NODES).map(([group, nodes]) => {
        const on = nodes.filter(node => ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)).length
        if (!on) return null
        return `§7${group}: §f${on === nodes.length ? "all" : `${on} of ${nodes.length}`}`
    }).filter(Boolean)
    const parents = (rank.inherits ?? []).map(id => getRank(id)).filter(Boolean)
    const notes = [rank.staff ? "staff" : null, rank.default ? "new players get it" : null].filter(Boolean)

    const body = [
        `${rank.display}§r`,
        subtitle(`Number ${index + 1} of ${rows.length}${notes.length ? ` · ${notes.join(" · ")}` : ""}`),
        "",
        "§fWhat it can do:",
        ...(groups.length ? groups : ["§7Nothing yet"]),
        parents.length ? `\n§fAlso gets everything from: §r${parents.map(r => r.display + "§r").join("§7, ")}` : "",
        editable ? "" : "\n§cThis rank is at or above yours, so you can only look."
    ].join("\n")

    const canMoveUp = editable && index > 0 && canEditRank(player, rows[index - 1])
    const canMoveDown = editable && index < rows.length - 1

    return menu(player, {
        title: hubTitle("ranks", nameOf(rank)),
        body,
        buttons: editable ? [
            { text: hubEntry("ranks", "Name and colour", "How it looks, and whether it is staff"), run: () => basicsScreen(player, rankId, again) },
            { text: hubEntry("ranks", "What it can do", "Turn permissions on and off"), run: () => nodeGroupsScreen(player, rankId, again) },
            { text: hubEntry("ranks", "Limits and cooldowns", "Homes, land claims and wait times"), run: () => valuesScreen(player, rankId, "limit", again) },
            { text: hubEntry("ranks", "Name effect", "Colours that move along the name"), run: () => nametagStyleScreen(player, rankId, again) },
            { text: hubEntry("ranks", "Also gets permissions from", parents.length ? parents.map(nameOf).join(", ") : "No other rank"), run: () => inheritScreen(player, rankId, again) },
            canMoveUp ? { text: `§7▲ Move up §8· above ${nameOf(rows[index - 1])}`, run: () => { moveRank(rankId, -1); return again() } } : null,
            canMoveDown ? { text: `§7▼ Move down §8· below ${nameOf(rows[index + 1])}`, run: () => { moveRank(rankId, 1); return again() } } : null,
            { text: "§cDelete this rank", run: () => deleteScreen(player, rankId, back) }
        ].filter(Boolean) : [],
        back
    })
}

/**
 * A new rank from a name and a colour.
 *
 * There used to be an id field ("lowercase, no spaces, also the tag") and a
 * display field that wanted § codes typed by hand. Both are gone: the id is
 * made from the name, and the colour comes from a list drawn in its own
 * colours. There also used to be a "replaces lower ranks" switch that was
 * never saved anywhere, so it did nothing; it is gone too.
 *
 * Only places and parents at or below the maker's own rank are offered, so
 * making a rank can never hand out more than its maker has.
 */
export async function createRankScreen(player, back) {
    const mine = topWeight(player)
    const usable = ladder().filter(r => (r.weight ?? 0) <= mine)
    if (!usable.length) { err(player, "You can only make ranks below your own, and there are none to place it under."); return back() }
    const fallback = defaultRank()
    const fallbackAt = usable.findIndex(r => r.id === fallback?.id)

    const values = await modal(player, hubTitle("ranks", "New rank"), [
        { id: "name", type: "text", label: "Name\n§8Shown in chat and above heads", placeholder: "Helper" },
        { id: "colour", type: "dropdown", label: "Colour", options: COLOUR_OPTIONS, default: 7 },
        { id: "bold", type: "toggle", label: "Bold", default: false },
        { id: "staff", type: "toggle", label: "Staff rank\n§8Gets staff chat and staff alerts", default: false },
        {
            id: "from", type: "dropdown",
            label: "Also gets everything from\n§8It starts with all of that rank's permissions",
            options: ["§7No other rank", ...usable.map(r => `${r.display}§r`)],
            // New players' rank by default, so the new rank never loses the
            // basics when it replaces that one.
            default: fallbackAt >= 0 ? fallbackAt + 1 : 0
        },
        {
            id: "below", type: "dropdown",
            label: "Put it just below",
            options: usable.map(r => `${r.display}§r`),
            // Just above the new players' rank, where Helper, VIP or Builder
            // usually belongs.
            default: Math.max(0, fallbackAt - 1)
        }
    ])
    if (!values) return back()

    const name = stripCodes(String(values.name ?? "")).trim()
    if (!name) { err(player, "Give the rank a name."); return back() }
    const base = normaliseRankId(name)
    if (!base) { err(player, "Use letters or numbers in the name."); return back() }
    let id = base
    for (let n = 2; getRank(id); n++) id = `${base}${n}`

    const code = (COLOURS[values.colour] ?? COLOURS[7])[1]
    const display = `§${code}${values.bold ? "§l" : ""}${name}`
    const parent = values.from ? usable[values.from - 1] : undefined
    saveRank(id, { display, staff: !!values.staff, inherits: parent ? [parent.id] : [], perms: [], meta: {} })

    // A new rank lands at the bottom. Walk it up to just below the chosen one.
    const target = usable[values.below] ?? usable[usable.length - 1]
    for (let guard = 0; guard < 64; guard++) {
        const order = ladder().map(r => r.id)
        if (order.indexOf(id) <= order.indexOf(target.id) + 1) break
        if (!moveRank(id, -1)) break
    }

    ok(player, `Made the ${display}§a rank. Use §fWhat it can do§a to give it more.`)
    return rankScreen(player, id, back)
}

export async function basicsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const look = lookOf(rank.display)
    // A rank with more than one colour (VIP+) cannot be redrawn from one
    // colour, so the list offers to keep it as it is.
    const options = look.simple ? COLOUR_OPTIONS : ["§7Keep the current colours", ...COLOUR_OPTIONS]
    const shift = look.simple ? 0 : 1
    const current = look.simple ? Math.max(0, COLOURS.findIndex(([, code]) => code === look.code)) : 0

    const values = await modal(player, hubTitle("ranks", `Name and colour · ${look.name || rankId}`), [
        { id: "name", type: "text", label: "Name", default: look.name },
        { id: "colour", type: "dropdown", label: "Colour", options, default: current },
        { id: "bold", type: "toggle", label: "Bold", default: look.bold },
        { id: "staff", type: "toggle", label: "Staff rank\n§8Gets staff chat and staff alerts", default: !!rank.staff },
        { id: "isDefault", type: "toggle", label: "New players get this rank", default: !!rank.default }
    ])
    if (!values) return back()

    const name = stripCodes(String(values.name ?? "")).trim() || look.name
    let display
    if (!look.simple && values.colour === 0) {
        // Kept as it is, unless the name or bold changed. Then it is rebuilt
        // from the first colour it had.
        display = name === look.name && !!values.bold === look.bold
            ? rank.display
            : `§${look.code ?? "f"}${values.bold ? "§l" : ""}${name}`
    } else {
        const code = (COLOURS[values.colour - shift] ?? COLOURS[0])[1]
        display = `§${code}${values.bold ? "§l" : ""}${name}`
    }
    saveRank(rankId, { display, staff: !!values.staff, default: !!values.isDefault })
    ok(player, `Saved ${display}§a.`)
    return back()
}

async function deleteScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const shown = rank?.display ?? rankId
    const yes = await confirm(player, hubTitle("ranks", "Delete rank"),
        `Delete ${shown}§r?\n\n§7Everyone who has it loses it. You can undo this from the rank list.`, "§cDelete")
    if (!yes) return back()
    snapshot()
    deleteRank(rankId)
    record(player, "rank.delete", undefined, rankId, { kind: "ladder" })
    ok(player, `Deleted ${shown}§a.`)
    return back()
}

// ---------------------------------------------------------------- templates

export async function presetsScreen(player, back) {
    return menu(player, {
        title: hubTitle("presets", "Rank templates"),
        body: subtitle("Each template is a full set of ranks. Using one replaces your rank list.\nPlayers keep any rank that still exists, and you can undo it from the rank list."),
        buttons: Object.keys(PRESETS).map(key => ({
            text: `§l${PRESETS[key].name}§r\n§8${PRESETS[key].description}`,
            run: () => applyPresetScreen(player, key, back)
        })),
        back
    })
}

async function applyPresetScreen(player, key, back) {
    const preset = PRESETS[key]
    const rows = Object.values(preset.ranks)
        .sort((a, b) => b.weight - a.weight)
        .map((r, i) => `  §8${i + 1}. §r${r.display}`)
        .join("\n")
    const yes = await confirm(player, hubTitle("presets", preset.name),
        `${preset.description}\n\n§fRanks:\n${rows}\n\n§cThis replaces your current rank list.`, "§cUse this template")
    if (!yes) return back()
    applyPreset(key)
    record(player, "rank.preset", undefined, preset.name, { kind: "ladder" })
    ok(player, `Now using the §f${preset.name}§a ranks.`)
    return back()
}

// -------------------------------------------------------------- permissions

/**
 * Quick fill. A bundle is a SHORTCUT, not a second kind of permission.
 *
 * These used to be toggles on a screen of their own, sitting beside the real
 * permissions and looking exactly like them — so nothing said which was the
 * state and which the shortcut. Even the person who commissioned this pack
 * could not tell them apart, which is a UI problem rather than a reading one.
 *
 * They also overlapped, which made them quietly destructive. Every node in
 * "Moderation — light" is inside "Moderation — full", and a bundle showed as ON
 * once you owned all of it — so ticking the full one lit the light one too,
 * without being touched, and unticking that stripped eight nodes back out of
 * the bundle you actually wanted.
 *
 * So they only ADD now. Press one, watch the permissions change, fine-tune them
 * next door. Nothing here can take a permission away, and a rank's permissions
 * live in exactly one place.
 */
async function quickFillScreen(player, rankId, back) {
    const again = () => quickFillScreen(player, rankId, back)
    const rank = getRank(rankId)
    const has = key => BUNDLES[key].nodes.every(n => rank.perms.includes(n))

    return menu(player, {
        title: hubTitle("ranks", `Ready-made sets · ${nameOf(rank)}`),
        body: subtitle("Each one switches on a group of permissions in one tap.\n§8Nothing is switched off here. Do that in What it can do."),
        buttons: Object.keys(BUNDLES).map(key => {
            const bundle = BUNDLES[key]
            const done = has(key)
            const size = bundle.nodes.length
            return {
                text: `${done ? "§8" : "§b"}${bundle.label}\n§8${size} permission${size === 1 ? "" : "s"}${done ? " · already on" : ""}`,
                run: () => {
                    const perms = [...rank.perms]
                    const added = bundle.nodes.filter(node => !perms.includes(node))
                    if (!added.length) {
                        info(player, "§7They already have every one of those.")
                        return again()
                    }
                    saveRank(rankId, { perms: [...perms, ...added] })
                    ok(player, `Switched on §f${added.length}§a permission${added.length === 1 ? "" : "s"} for ${rank.display}§a.`)
                    return again()
                }
            }
        }),
        back
    })
}

async function nodeGroupsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    return menu(player, {
        title: hubTitle("ranks", `What it can do · ${nameOf(rank)}`),
        body: subtitle("Each switch turns one permission on or off for this rank.\n§8Off means this rank adds nothing. Players still get what\n§8their other ranks give them."),
        buttons: [
            // The shortcut lives WITH the thing it is a shortcut for, so the
            // relationship is visible instead of needing to be explained.
            {
                text: "§eReady-made sets §8· switch on a group at once",
                run: () => quickFillScreen(player, rankId, () => nodeGroupsScreen(player, rankId, back))
            },
            // Each group says how much of it is on, counted the way the
            // switches inside are drawn, so the number and the page agree.
            ...Object.entries(PERMISSION_NODES).map(([group, nodes]) => {
                const on = nodes.filter(node => ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)).length
                return {
                    text: hubEntry("ranks", group, `${on} of ${nodes.length} on`),
                    run: () => nodeGroupScreen(player, rankId, group, () => nodeGroupsScreen(player, rankId, back))
                }
            }),
            // **Numbers belong with the switches, not on a separate screen
            // called "Meta".** "May they set homes" and "how many" are one
            // question asked twice, and answering them in two different places
            // is how a rank ends up allowed something it has a limit of zero
            // for. Asked for 2026-09-19, in the shape Essentials uses: a
            // permission that carries a value.
            {
                text: "§bLimits and cooldowns §8· numbers, not switches",
                run: () => valuesScreen(player, rankId, "limit", () => nodeGroupsScreen(player, rankId, back))
            }
        ],
        back
    })
}

/** Beyond this many switches a form stops being trustworthy — see below. */
const NODES_PER_PAGE = 14

/**
 * A group, paged when it is big enough to need it.
 *
 * Operator carries one node per vanilla command, so it is fifty-six switches.
 * That is exactly the shape that has now bitten this pack twice: `modal()`
 * pairs answers to fields BY INDEX, and a response that comes back short leaves
 * the tail reading as off — which on THIS screen would quietly strip
 * permissions from a rank. Fourteen at a time, and a page that did come back
 * short can only cost that page.
 *
 * The write path already rewrites only the nodes it was handed, so a page is a
 * correct unit of work with no further care.
 */
async function nodeGroupScreen(player, rankId, group, back) {
    const all = PERMISSION_NODES[group] ?? []
    if (all.length <= NODES_PER_PAGE) {
        return nodePageScreen(player, rankId, group, all, back)
    }

    const again = () => nodeGroupScreen(player, rankId, group, back)
    const rank = getRank(rankId)
    const pages = []
    for (let i = 0; i < all.length; i += NODES_PER_PAGE) pages.push(all.slice(i, i + NODES_PER_PAGE))

    return menu(player, {
        title: hubTitle("ranks", `${group} · ${nameOf(rank)}`),
        body: subtitle(`${all.length} permissions, ${pages.length} pages.
§8Each page saves on its own.`),
        buttons: pages.map(nodes => {
            const on = nodes.filter(n => rankState(rank, n) !== "none").length
            // Labelled by the same rule as the switches inside, so the range on
            // the button and the rows behind it read as the same words.
            const shown = nodeLabels(all)
            const first = shown[all.indexOf(nodes[0])]
            const last = shown[all.indexOf(nodes[nodes.length - 1])]
            return {
                text: hubEntry("ranks", `${first} – ${last}`,
                    on ? `${on} of ${nodes.length} on` : "none on"),
                run: () => nodePageScreen(player, rankId, group, nodes, again)
            }
        }),
        back
    })
}

async function nodePageScreen(player, rankId, group, nodes, back) {
    const rank = getRank(rankId)

    // Two editor styles, chosen in < Code > ("ranks.permissionEditor"):
    //
    //   toggle    on = granted, off = this rank says nothing and the default
    //             rank's answer stands. Fewer decisions, no way to write a
    //             denial by accident.
    //   dropdown  Default / Allow / Deny per node. Deny writes "-node", which
    //             beats anything inherited — the only way to carve a hole in an
    //             inherited wildcard.
    const dropdown = String(setting("ranks.permissionEditor")).trim().toLowerCase() === "dropdown"
    const stateOf = node => rank.perms.includes(node) ? 1 : (rank.perms.includes(`-${node}`) ? 2 : 0)

    /**
     * The control says what THIS rank states, because that is what it writes.
     * The note beside it says what the holder actually ends up with — a
     * different question, and the one people were reading the switch as
     * answering.
     *
     * Without it the screen looked plainly wrong: an Admin inherits most of Mod
     * and holds "chat.*", so row after row read OFF while the holder obviously
     * had the thing. rankState() resolves it exactly as has() does.
     */
    // Labelled, not spelled out — see nodeLabels in core/ranks.js. Computed
    // over the WHOLE group rather than this page, so page two of Operator
    // cannot shorten differently from page one.
    const whole = PERMISSION_NODES[group] ?? nodes
    const shown = nodeLabels(whole)
    const nameOf = node => shown[whole.indexOf(node)] ?? node

    const labelFor = node => {
        const name = nameOf(node)
        // SAY WHERE IT CAME FROM. "inherited" on its own sent somebody hunting
        // through an empty Inherits list for a rank that had been granting
        // itself ban through its own `admin.*` the whole time.
        const { state, via } = rankGrant(rank, node)
        const rankName = r => stripCodes(String(r?.display ?? "")) || r?.id || "a rank above"
        if (state === "wildcard") return `${name}\n§8· has it already, from its own ${via}`
        if (state === "inherited") return `${name}\n§8· inherited from ${rankName(via)}`
        if (state === "denied" && !rank.perms.includes(`-${node}`)) {
            const from = typeof via === "string" ? `its own ${via}` : rankName(via)
            return `${name}\n§8· denied by ${from}`
        }
        return name
    }

    const values = await modal(player, hubTitle("ranks", group),
        nodes.map(node => dropdown
            ? {
                id: node,
                type: "dropdown",
                label: labelFor(node),
                options: ["Default", "§aAllow", "§cDeny"],
                default: stateOf(node)
            }
            : {
                id: node,
                type: "toggle",
                // **The switch shows what the HOLDER ends up with, not what
                // this rank happens to state.** It used to show the latter, so
                // a node arriving through inheritance or a wildcard read OFF
                // while the person plainly had it — and turning it off did
                // nothing, because there was nothing of this rank's to remove.
                //
                // Reported 2026-09-13 in exactly those words: "even if it's
                // toggled off it somehow has that". Now off means off.
                label: labelFor(node),
                default: ["own", "wildcard", "inherited"].includes(rankGrant(rank, node).state)
            }))
    if (!values) return back()

    // Either way, this group's nodes are rewritten from scratch — anything the
    // rank said about them before is replaced, never merged.
    const perms = rank.perms.filter(p => !nodes.includes(p) && !nodes.includes(p.replace(/^-/, "")))
    for (const node of nodes) {
        const value = values[node]
        if (dropdown) {
            if (value === 1) perms.push(node)
            else if (value === 2) perms.push(`-${node}`)
        } else {
            // **A toggle can now write and clear a denial**, which is what
            // makes "off" mean off for something the rank did not grant itself.
            //
            //   on  + nothing had it      -> state it
            //   on  + a denial had it off -> the denial is simply not rewritten
            //   on  + it flows in already -> write nothing, let it flow
            //   off + it flows in already -> write "-node", the only thing that
            //                                can carve a hole in an inherited
            //                                grant or a wildcard
            //
            // `state` is read BEFORE the edit, from the rank as saved.
            const { state } = rankGrant(rank, node)
            const flowsIn = state === "wildcard" || state === "inherited"
            if (value) {
                if (!flowsIn) perms.push(node)
            } else if (flowsIn || state === "denied") {
                perms.push(`-${node}`)
            }
        }
    }

    saveRank(rankId, { perms })
    ok(player, `Saved what ${rank.display}§a can do.`)
    return back()
}

async function inheritScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const others = ladder().filter(r => r.id !== rankId)
    if (!others.length) { info(player, "There are no other ranks to take permissions from."); return back() }

    const values = await modal(player, hubTitle("ranks", `Also gets permissions from · ${nameOf(rank)}`),
        others.map(other => ({
            id: other.id,
            type: "toggle",
            label: `${other.display}§r`,
            default: rank.inherits?.includes(other.id)
        })))
    if (!values) return back()

    const picked = others.filter(o => values[o.id]).map(o => o.id)
    if (picked.some(id => inheritsFrom(id, rankId))) {
        err(player, "That would make a loop: one of those ranks already gets its permissions from this one.")
        return back()
    }
    saveRank(rankId, { inherits: picked })
    const names = picked.map(id => nameOf(getRank(id)))
    ok(player, names.length
        ? `${rank.display}§a now also gets everything from §f${names.join(", ")}§a.`
        : `${rank.display}§a no longer gets permissions from another rank.`)
    return back()
}

function inheritsFrom(rankId, ancestorId, seen = new Set()) {
    if (rankId === ancestorId) return true
    if (seen.has(rankId)) return false
    seen.add(rankId)
    return (getRank(rankId)?.inherits ?? []).some(parent => inheritsFrom(parent, ancestorId, seen))
}

/**
 * The numbers a rank carries, drawn from core/ranks.js's RANK_VALUES.
 *
 * Generated rather than listed, so a value added to that table gets a slider
 * here without anybody editing this file — and, the part that matters, a
 * feature cannot start reading a number that nobody can set.
 *
 * Cooldowns and limits are two screens because they answer different questions
 * and a single form of five sliders is a wall. They link to each other rather
 * than sitting behind separate buttons, so getting between them is one tap.
 */
/**
 * The one rank value that is a CHOICE rather than a number.
 *
 * Its own screen rather than a field on the values form, because that form is
 * generated from `RANK_VALUES` as sliders and a dropdown among five sliders is
 * the kind of mixed form where people mis-tap. It also gets to SHOW each style,
 * which a dropdown of names cannot: the list below paints every option in its
 * own colours, on this rank's own name, so the choice is made by looking rather
 * than by guessing what "Void" means.
 */
async function nametagStyleScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const current = String(rank.meta?.["nametag.style"] ?? "none")
    const sample = stripCodes(rank.display) || rankId

    return pagedMenu(player, {
        title: hubTitle("ranks", `Name effect · ${nameOf(rank)}`),
        body: [
            subtitle("Colours that move along the name above their head.\nIn chat, the same colours stand still."),
            flag("feature.namecolour")
                ? "§8Each effect is shown on this rank's name."
                : "§cName effects are off for the whole server.§r §8Turn them on in Server ▸ Features.",
            "§8While an effect is on, it replaces a nickname's own colours."
        ].join("\n"),
        items: STYLE_IDS,
        render: (id) => {
            const style = STYLES[id]
            const shown = id === "none"
                ? `§7${sample}`
                : paint(sample, style.ramp, 0)
            const mark = id === current ? " §a✓" : ""
            return { text: `${shown}§r${mark}\n§8${style.label} · ${style.hint}` }
        },
        onPick: (id) => {
            saveRank(rankId, { meta: { ...rank.meta, "nametag.style": id } })
            ok(player, `${rank.display}§a now uses §f${STYLES[id].label}§a.`)
            // Repaint immediately rather than waiting on the tick, so the
            // change is visible the moment the form closes.
            for (const p of world.getAllPlayers()) refreshNameTag(p)
            return nametagStyleScreen(player, rankId, back)
        },
        back
    })
}

async function valuesScreen(player, rankId, kind, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const keys = Object.keys(RANK_VALUES).filter(k => RANK_VALUES[k].kind === kind)
    const other = kind === "cooldown" ? "limit" : "cooldown"
    const heading = kind === "cooldown" ? "Cooldowns" : "Limits"
    // modal() has no text area of its own, and this explanation used to be
    // passed to it as an extra argument it ignored, so nobody ever saw it. It
    // goes on the first slider now, where it is read before anything moves.
    const rule = kind === "cooldown"
        ? "§8Seconds to wait between uses. 0 means no wait.\n§8Staff skip cooldowns unless the server turns that off."
        : "§8How many they may have. 0 turns the feature off for this rank."

    const values = await modal(player, hubTitle("ranks", `${heading} · ${nameOf(rank)}`),
        keys.map((key, i) => ({
            id: key,
            type: "slider",
            label: `${i === 0 ? `${rule}\n\n§r` : ""}${RANK_VALUES[key].label}\n§8${RANK_VALUES[key].hint}`,
            min: RANK_VALUES[key].min,
            max: RANK_VALUES[key].max,
            step: 1,
            default: Number(rank.meta?.[key] ?? RANK_VALUES[key].fallback)
        })))

    if (!values) return back()
    saveRank(rankId, { meta: { ...rank.meta, ...values } })
    ok(player, `Saved the ${heading.toLowerCase()} for ${rank.display}§a.`)

    // Straight on to the other half rather than back out: somebody setting a
    // rank's homes usually wants to set its cooldowns in the same sitting.
    return menu(player, {
        title: hubTitle("ranks", `${heading} · ${nameOf(rank)}`),
        body: subtitle("Saved."),
        buttons: [{
            text: `§bNext: ${other === "cooldown" ? "cooldowns" : "limits"}`,
            run: () => valuesScreen(player, rankId, other, back)
        }],
        back
    })
}

// ================================================ giving ranks to players

export async function rankPlayersScreen(player, back) {
    const online = world.getAllPlayers()
    return pagedMenu(player, {
        title: hubTitle("ranks", "Give a rank to a player"),
        body: subtitle(`${online.length} online. Tap a player.`),
        items: online,
        render: target => {
            const rank = primaryRank(target)
            const self = target.id === player.id ? " §8(you)" : ""
            return { text: `${rank ? rank.display + "§r " : ""}${displayName(target)}${self}` }
        },
        onPick: target => playerRankScreen(player, target.id, target.name, () => rankPlayersScreen(player, back)),
        extra: [
            { text: "§7Everyone seen\n§8Includes players who are offline", run: () => offlinePlayersScreen(player, () => rankPlayersScreen(player, back)) }
        ],
        back
    })
}

async function offlinePlayersScreen(player, back) {
    const holders = knownHolders()
    if (!holders.length) { info(player, "Nobody has been seen yet."); return back() }
    const onlineIds = new Set(world.getAllPlayers().map(p => p.id))
    return pagedMenu(player, {
        title: hubTitle("ranks", "Everyone seen"),
        body: subtitle("Everyone Admin+ has seen. §a•§7 means online.\nA change to someone offline applies now and shows when they next join."),
        items: holders,
        render: holder => {
            const rank = getRank(heldRankIds(holder.id)[0])
            return { text: `${rank ? rank.display + "§r " : ""}${holder.name || "§8(unknown)"}${onlineIds.has(holder.id) ? " §a•" : ""}` }
        },
        onPick: holder => playerRankScreen(player, holder.id, holder.name, () => offlinePlayersScreen(player, back)),
        back
    })
}

/** One player's ranks: what they have, plus give, take away and tag order. */
export async function playerRankScreen(player, targetId, targetName, back) {
    const held = displayRanks(targetId)
    const list = held.length
        ? held.map((r, i) => `  §8${i + 1}. §r${r.display}${i === 0 ? " §8← shown as their tag" : ""}`).join("\n")
        : "  §7none"
    const allowed = canActOn(player, targetId) && has(player, "ranks.grant")
    const online = world.getAllPlayers().some(p => p.id === targetId)
    const again = () => playerRankScreen(player, targetId, targetName, back)

    return menu(player, {
        title: hubTitle("ranks", targetName || "Unknown"),
        body: [
            online ? "§a• online" : "§8offline",
            "",
            "§fRanks:",
            list,
            "",
            "§7What they can do comes from all their ranks together.",
            "§7The order only picks which tag they show.",
            allowed ? "" : "\n§cThey outrank you, so you can't change their ranks."
        ].join("\n"),
        buttons: allowed ? [
            { text: "§a+ Give a rank", run: () => addRankScreen(player, targetId, targetName, again) },
            { text: "§c- Take a rank away", run: () => removeRankScreen(player, targetId, targetName, again) },
            held.length > 1
                ? { text: "§7Change which tag shows", run: () => displayOrderScreen(player, targetId, targetName, again) }
                : null,
            { text: "§bReplace all their ranks with one", run: () => setRankScreen(player, targetId, targetName, again) }
        ].filter(Boolean) : [],
        back
    })
}

/** Reorder just this player's ranks. It changes the tag, never authority. */
async function displayOrderScreen(player, targetId, targetName, back) {
    const held = displayRanks(targetId)
    if (held.length < 2) return back()
    return menu(player, {
        title: hubTitle("ranks", `Which tag shows · ${targetName}`),
        body: subtitle("The top rank is the tag they show.\n§8This does not change what they can do."),
        buttons: held.map((rank, index) => ({
            text: `§8${index + 1}. §r${rank.display}${index === 0 ? " §8← tag" : ""}`,
            run: () => moveHeldScreen(player, targetId, targetName, rank.id, () => displayOrderScreen(player, targetId, targetName, back))
        })),
        back
    })
}

async function moveHeldScreen(player, targetId, targetName, rankId, back) {
    const held = displayRanks(targetId)
    const index = held.findIndex(r => r.id === rankId)
    const rank = held[index]
    if (!rank) return back()
    return menu(player, {
        title: hubTitle("ranks", nameOf(rank)),
        body: `${rank.display}§r\n${subtitle(`Number ${index + 1} of ${held.length}`)}`,
        buttons: [
            index > 0 ? { text: "§7▲ Move up", run: () => { moveHeldRank(targetId, rankId, -1); return moveHeldScreen(player, targetId, targetName, rankId, back) } } : null,
            index < held.length - 1 ? { text: "§7▼ Move down", run: () => { moveHeldRank(targetId, rankId, 1); return moveHeldScreen(player, targetId, targetName, rankId, back) } } : null,
            index > 0 ? { text: "§b★ Make this their tag", run: () => { while (moveHeldRank(targetId, rankId, -1)) { /* to the top */ } ok(player, `${targetName} now shows ${rank.display}§a.`); return back() } } : null
        ].filter(Boolean),
        back
    })
}

/** Ranks the actor may hand out: strictly below their own row. */
export function grantableRanks(player) {
    return ladder().filter(rank => canEditRank(player, rank))
}

async function addRankScreen(player, targetId, targetName, back) {
    const held = heldRankIds(targetId)
    const options = grantableRanks(player).filter(rank => !held.includes(rank.id))
    if (!options.length) { err(player, "There are no more ranks below your own to give."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Give a rank · ${targetName}`),
        items: options,
        render: rank => ({ text: `${rank.display}§r` }),
        onPick: async rank => {
            // Say what giving this rank takes away before it happens. (The
            // old prompt also pointed at a "Replaces lower ranks" switch,
            // which was never saved anywhere and so never did anything.)
            const losing = displacedBy(targetId, rank.id)
            if (losing.length) {
                const list = losing.map(r => r.display + "§r").join("§7, ")
                const yes = await confirm(player, hubTitle("ranks", "Give rank"),
                    `Give §f${targetName}§r the ${rank.display}§r rank?` +
                    `${String.fromCharCode(10)}${String.fromCharCode(10)}§7It replaces their ${list}§7 rank.`,
                    "§aGive rank")
                if (!yes) return back()
            }
            const before = heldRankIds(targetId)
            grantRank(targetId, rank.id, targetName)
            record(player, "rank.grant", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} now has ${rank.display}§a.`)
            notify(targetId, `You were given the ${rank.display}§r rank.`)
            return back()
        },
        back
    })
}

async function removeRankScreen(player, targetId, targetName, back) {
    const held = heldRankIds(targetId).map(getRank).filter(Boolean).filter(rank => canEditRank(player, rank))
    if (!held.length) { err(player, "They have no ranks you are allowed to take away."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Take a rank away · ${targetName}`),
        items: held,
        render: rank => ({ text: `${rank.display}§r` }),
        onPick: rank => {
            const before = heldRankIds(targetId)
            revokeRank(targetId, rank.id, targetName)
            record(player, "rank.revoke", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `Removed ${rank.display}§a from ${targetName}.`)
            notify(targetId, `The ${rank.display}§r rank was removed.`)
            return back()
        },
        back
    })
}

async function setRankScreen(player, targetId, targetName, back) {
    const options = grantableRanks(player)
    if (!options.length) { err(player, "There are no ranks below your own to give."); return back() }
    return pagedMenu(player, {
        title: hubTitle("ranks", `Replace all ranks · ${targetName}`),
        body: subtitle("Removes every rank they have and gives them this one."),
        items: options,
        render: rank => ({ text: `${rank.display}§r` }),
        onPick: async rank => {
            const yes = await confirm(player, hubTitle("ranks", "Replace all ranks"),
                `Give §f${targetName}§r only ${rank.display}§r?\n\n§7Their other ranks are removed.`, "§aReplace")
            if (!yes) return back()
            const before = heldRankIds(targetId)
            setRanks(targetId, [rank.id], targetName)
            record(player, "rank.set", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} now has only ${rank.display}§a.`)
            notify(targetId, `Your rank is now ${rank.display}§r.`)
            return back()
        },
        back
    })
}

export function notify(targetId, text) {
    const target = world.getAllPlayers().find(p => p.id === targetId)
    if (target) info(target, text)
}
