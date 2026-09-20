import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, title, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { setting } from "../core/settings.js"
import { record } from "../core/logs.js"
import { ok, err, info } from "../core/util.js"
import { stripCodes } from "../core/identity.js"
import {
    ladder, getRank, saveRank, deleteRank, normaliseRankId, moveRank,
    PRESETS, BUNDLES, PERMISSION_NODES, RANK_VALUES,
    applyPreset, restoreSnapshot, hasSnapshot, snapshot,
    canEditRank, canActOn, has, rankState, rankGrant, displacedBy, defaultRank,
    playerRanks, displayRanks, heldRankIds, primaryRank, moveHeldRank,
    setRanks, grantRank, revokeRank, knownHolders, nodeLabels
} from "../core/ranks.js"

// /admin ▸ Ranks
//
//   Settings   the global ladder — order, create, edit, delete, presets
//   Players    pick a player, then add / remove their ranks and order their tags
//
// Two orderings, deliberately separate:
//   the LADDER (Settings) is the hierarchy — row 1 outranks row 2, and that is
//     where all authority comes from. No weight numbers appear in this UI.
//   a PLAYER's order (Players) is cosmetic — it only picks which of their ranks
//     is worn as the tag when they hold more than one.

// The numbers a rank carries now live in RANK_VALUES, in core/ranks.js, beside
// the code that reads them — this file used to hold its own table of one, which
// is how a value ends up editable but unread, or read but uneditable.

export async function ranksScreen(player, back) {
    const again = () => ranksScreen(player, back)
    return menu(player, {
        title: hubTitle("ranks", "Ranks"),
        body: subtitle("Ladder order is the hierarchy — the higher a rank sits, the more it outranks."),
        buttons: [
            has(player, "ranks.manage")
                ? { text: hubButton("ranks", "Ladder", "Order, create, edit, delete"), run: () => ladderScreen(player, again) }
                : null,
            has(player, "ranks.manage")
                ? { text: hubButton("presets", "Presets", "Swap the whole ladder in one move"), run: () => presetsScreen(player, again) }
                : null,
            { text: hubButton("ranks", "Players", "Give and take ranks"), run: () => rankPlayersScreen(player, again) }
        ].filter(Boolean),
        back
    })
}

// ============================================================= Ranks ▸ Ladder

function ladderLine(rank, index) {
    const flags = []
    if (rank.staff) flags.push("staff")
    if (rank.default) flags.push("default")
    const suffix = flags.length ? ` §8(${flags.join(", ")})` : ""
    return `§8${index + 1}. §r${rank.display}§r${suffix}`
}

async function ladderScreen(player, back) {
    const ranks = ladder()
    return pagedMenu(player, {
        title: hubTitle("settings", "Rank ladder"),
        body: subtitle("Strongest at the top. Tap a rank to edit or move it."),
        items: ranks,
        render: (rank) => ({ text: ladderLine(rank, ranks.indexOf(rank)) }),
        onPick: rank => rankScreen(player, rank.id, () => ladderScreen(player, back)),
        extra: [
            { text: "§a+ Create rank", run: () => createRankScreen(player, () => ladderScreen(player, back)) },
            { text: hubEntry("presets", "≡ Presets", "Replace the whole ladder"), run: () => presetsScreen(player, () => ladderScreen(player, back)) },
            hasSnapshot() ? { text: "§8↺ Undo last ladder change", run: () => undoScreen(player, () => ladderScreen(player, back)) } : null
        ].filter(Boolean),
        back
    })
}

async function undoScreen(player, back) {
    const yes = await confirm(player, title("Undo"),
        "Restore the ladder to its state before the last preset or delete?\n\n§7Player assignments are not touched.", "§eRestore")
    if (!yes) return back()
    restoreSnapshot()
    ok(player, "Ladder restored from the last snapshot.")
    return back()
}

/** One rank: move it, edit it, delete it. */
export async function rankScreen(player, rankId, back) {
    const rank = getRank(rankId)
    if (!rank) { err(player, "That rank no longer exists."); return back() }

    const rows = ladder()
    const index = rows.findIndex(r => r.id === rankId)
    const editable = canEditRank(player, rank)
    const inherits = rank.inherits?.length ? rank.inherits.join(", ") : "nothing"
    const nodes = rank.perms?.length ? rank.perms.join(", ") : "none"
    const metaLine = Object.entries(rank.meta ?? {}).map(([k, v]) => `${k}=${v}`).join(", ") || "defaults"
    const outranks = index < rows.length - 1 ? rows[index + 1].display : "§7nothing"
    const under = index > 0 ? rows[index - 1].display : "§7nothing"

    const body = [
        `${rank.display}§r §8(id: ${rank.id})`,
        subtitle(`Row ${index + 1} of ${rows.length}${rank.staff ? " · staff" : ""}${rank.default ? " · default rank" : ""}`),
        "",
        `§fUnder: §r${under}`,
        `§fOutranks: §r${outranks}`,
        "",
        `§fInherits: §7${inherits}`,
        `§fNodes: §7${nodes}`,
        `§fMeta: §7${metaLine}`,
        editable ? "" : "\n§cThis rank sits at or above yours — view only."
    ].join("\n")

    const canMoveUp = editable && index > 0 && canEditRank(player, rows[index - 1])
    const canMoveDown = editable && index < rows.length - 1

    return menu(player, {
        title: title(`Rank · ${rank.id}`),
        body,
        buttons: editable ? [
            canMoveUp ? { text: "§7▲ Move up §8· outrank " + rows[index - 1].id, run: () => { moveRank(rankId, -1); return rankScreen(player, rankId, back) } } : null,
            canMoveDown ? { text: "§7▼ Move down §8· drop below " + rows[index + 1].id, run: () => { moveRank(rankId, 1); return rankScreen(player, rankId, back) } } : null,
            { text: "§bBasics §8· name, colour, staff", run: () => basicsScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bPermissions §8· on / off", run: () => nodeGroupsScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bInheritance", run: () => inheritScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bCooldowns & limits §8· numbers", run: () => valuesScreen(player, rankId, "cooldown", () => rankScreen(player, rankId, back)) },
            { text: "§cDelete rank", run: () => deleteScreen(player, rankId, back) }
        ].filter(Boolean) : [],
        back
    })
}

async function createRankScreen(player, back) {
    const values = await modal(player, hubTitle("settings", "Create rank"), [
        {
            id: "id",
            type: "text",
            label: "Rank id §8· lowercase, no spaces. Also the tag: rank:<id>",
            placeholder: "coowner"
        },
        {
            id: "display",
            type: "text",
            label: [
                "Display §8· exactly how it shows in chat and on nametags",
                "§8Colour with §§ codes, e.g. §§c§§lCo-Owner → §c§lCo-Owner",
                "§80-9 a-f colours · l bold · o italic · r reset"
            ].join("\n"),
            placeholder: "§c§lCo-Owner"
        },
        { id: "staff", type: "toggle", label: "Counts as staff", default: false },
        {
            id: "replaces",
            type: "toggle",
            label: "Replaces lower ranks when granted" +
                "\n§8Off for a cosmetic rank meant to sit alongside others.",
            default: true
        }
    ])
    if (!values) return back()
    const id = normaliseRankId(values.id)
    if (!id) { err(player, "That rank id isn't usable."); return back() }
    if (getRank(id)) { err(player, `A rank called §f${id}§c already exists.`); return back() }

    saveRank(id, {
        display: values.display || `§7${id}`,
        staff: values.staff,
        // Inherit the default rank, because granting this one REPLACES it — a
        // new rank that inherited nothing would quietly cost the player the
        // basics everybody starts with.
        inherits: [defaultRank()?.id].filter(Boolean),
        perms: [],
        meta: {}
    })
    ok(player, `Created §f${id}§a at the bottom of the ladder — move it up from its screen.`)
    return rankScreen(player, id, back)
}

async function basicsScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const values = await modal(player, hubTitle("ranks", `Basics · ${rankId}`), [
        { id: "display", type: "text", label: "Display", default: rank.display },
        { id: "staff", type: "toggle", label: "Counts as staff", default: rank.staff },
        { id: "isDefault", type: "toggle", label: "Default rank for new players", default: !!rank.default }
    ])
    if (!values) return back()
    saveRank(rankId, {
        display: values.display,
        staff: values.staff,
        default: values.isDefault
    })
    ok(player, `Updated §f${rankId}§a.`)
    return back()
}

async function deleteScreen(player, rankId, back) {
    const yes = await confirm(player, title("Delete rank"),
        `Delete §f${rankId}§r?\n\n§7Everyone holding it loses it. Undoable from the ladder screen.`, "§cDelete")
    if (!yes) return back()
    snapshot()
    deleteRank(rankId)
    record(player, "rank.delete", undefined, rankId, { kind: "ladder" })
    ok(player, `Deleted rank §f${rankId}§a.`)
    return back()
}

// ------------------------------------------------------------------ presets

export async function presetsScreen(player, back) {
    return menu(player, {
        title: hubTitle("presets", "Ladder presets"),
        body: subtitle("A preset replaces the entire ladder.\nPlayers keep their assignments — anyone holding an id that still\nexists keeps their rank. A snapshot is saved first, so this is undoable."),
        buttons: Object.keys(PRESETS).map(key => ({
            text: `§l${PRESETS[key].name}§r\n§7${PRESETS[key].description}`,
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
    const yes = await confirm(player, title(preset.name),
        `${preset.description}\n\n§fLadder:\n${rows}\n\n§cThis replaces your current ladder.`, "§cApply preset")
    if (!yes) return back()
    applyPreset(key)
    record(player, "rank.preset", undefined, preset.name, { kind: "ladder" })
    ok(player, `Applied the §f${preset.name}§a preset.`)
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
        title: title(`Quick fill · ${rankId}`),
        body: subtitle("Adds a set of permissions in one press.\n§8Nothing is ever taken away — switch things off in Permissions."),
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
                    ok(player, `Added §f${added.length}§a permission${added.length === 1 ? "" : "s"} to §f${rankId}§a.`)
                    return again()
                }
            }
        }),
        back
    })
}

async function nodeGroupsScreen(player, rankId, back) {
    return menu(player, {
        title: title(`Permissions · ${rankId}`),
        body: subtitle("Every permission is a simple on/off.\n§8Off means the rank says nothing about it — the holder just gets\n§8whatever the default rank already gives them."),
        buttons: [
            // The shortcut lives WITH the thing it is a shortcut for, so the
            // relationship is visible instead of needing to be explained.
            {
                text: "§eQuick fill §8· add a ready-made set",
                run: () => quickFillScreen(player, rankId, () => nodeGroupsScreen(player, rankId, back))
            },
            ...Object.keys(PERMISSION_NODES).map(group => ({
                text: group,
                run: () => nodeGroupScreen(player, rankId, group, () => nodeGroupsScreen(player, rankId, back))
            })),
            // **Numbers belong with the switches, not on a separate screen
            // called "Meta".** "May they set homes" and "how many" are one
            // question asked twice, and answering them in two different places
            // is how a rank ends up allowed something it has a limit of zero
            // for. Asked for 2026-09-19, in the shape Essentials uses: a
            // permission that carries a value.
            {
                text: "§bCooldowns & limits §8· numbers, not switches",
                run: () => valuesScreen(player, rankId, "cooldown", () => nodeGroupsScreen(player, rankId, back))
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
        title: title(`${group} · ${rankId}`),
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
    ok(player, `Updated permissions for §f${rankId}§a.`)
    return back()
}
async function inheritScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const others = ladder().filter(r => r.id !== rankId)
    if (!others.length) { info(player, "There are no other ranks to inherit from."); return back() }

    const values = await modal(player, title(`Inherits · ${rankId}`),
        others.map(other => ({
            id: other.id,
            type: "toggle",
            label: `${other.display}§r`,
            default: rank.inherits?.includes(other.id)
        })))
    if (!values) return back()

    const picked = others.filter(o => values[o.id]).map(o => o.id)
    if (picked.some(id => inheritsFrom(id, rankId))) {
        err(player, "That would create an inheritance loop — pick a rank that doesn't already inherit this one.")
        return back()
    }
    saveRank(rankId, { inherits: picked })
    ok(player, `Updated inheritance for §f${rankId}§a.`)
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
async function valuesScreen(player, rankId, kind, back) {
    const rank = getRank(rankId)
    if (!rank) return back()
    const keys = Object.keys(RANK_VALUES).filter(k => RANK_VALUES[k].kind === kind)
    const other = kind === "cooldown" ? "limit" : "cooldown"
    const heading = kind === "cooldown" ? "Cooldowns" : "Limits"

    const values = await modal(player, title(`${heading} · ${rankId}`),
        keys.map(key => ({
            id: key,
            type: "slider",
            label: `${RANK_VALUES[key].label}\n§8${RANK_VALUES[key].hint}`,
            min: RANK_VALUES[key].min,
            max: RANK_VALUES[key].max,
            step: 1,
            default: Number(rank.meta?.[key] ?? RANK_VALUES[key].fallback)
        })),
        kind === "cooldown"
            ? "§8Seconds to wait. 0 is no wait.\n§8Staff ranks ignore cooldowns entirely."
            : "§8How many they may have. 0 switches the feature off for this rank.")

    if (!values) return back()
    saveRank(rankId, { meta: { ...rank.meta, ...values } })
    ok(player, `Updated ${heading.toLowerCase()} for §f${rankId}§a.`)

    // Straight on to the other half rather than back out — somebody setting a
    // rank's homes almost always wants to set its cooldown in the same sitting.
    return menu(player, {
        title: title(`${heading} · ${rankId}`),
        body: subtitle("Saved."),
        buttons: [{
            text: `§bNow the ${other}s`,
            run: () => valuesScreen(player, rankId, other, back)
        }],
        back
    })
}

// ============================================================ Ranks ▸ Players

export async function rankPlayersScreen(player, back) {
    const online = world.getAllPlayers()
    return pagedMenu(player, {
        title: hubTitle("ranks", "Ranks · players"),
        body: subtitle(`${online.length} online.`),
        items: online,
        render: target => {
            const rank = primaryRank(target)
            const self = target.id === player.id ? " §8(you)" : ""
            return { text: `${rank ? rank.display + "§r " : ""}${target.name}${self}` }
        },
        onPick: target => playerRankScreen(player, target.id, target.name, () => rankPlayersScreen(player, back)),
        extra: [
            { text: "§7Known players §8· includes offline", run: () => offlinePlayersScreen(player, () => rankPlayersScreen(player, back)) }
        ],
        back
    })
}

async function offlinePlayersScreen(player, back) {
    const holders = knownHolders()
    if (!holders.length) { info(player, "No player records yet."); return back() }
    const onlineIds = new Set(world.getAllPlayers().map(p => p.id))
    return pagedMenu(player, {
        title: hubTitle("ranks", "Known players"),
        body: subtitle("Everyone Admin+ has seen. Offline players can still be re-ranked —\nthe change lands now and their tags catch up on next join."),
        items: holders,
        render: holder => {
            const rank = getRank(heldRankIds(holder.id)[0])
            return { text: `${rank ? rank.display + "§r " : ""}${holder.name || "§8(unknown)"}${onlineIds.has(holder.id) ? " §a•" : ""}` }
        },
        onPick: holder => playerRankScreen(player, holder.id, holder.name, () => offlinePlayersScreen(player, back)),
        back
    })
}

/** One player's ranks: what they hold, plus add / remove / display order. */
export async function playerRankScreen(player, targetId, targetName, back) {
    const held = displayRanks(targetId)
    const strongest = playerRanks(targetId)[0]
    const list = held.length
        ? held.map((r, i) => `  §8${i + 1}. §r${r.display}${i === 0 ? " §8← tag" : ""}`).join("\n")
        : "  §7none"
    const allowed = canActOn(player, targetId) && has(player, "ranks.grant")
    const online = world.getAllPlayers().some(p => p.id === targetId)
    const again = () => playerRankScreen(player, targetId, targetName, back)

    return menu(player, {
        title: title(targetName || "Unknown"),
        body: [
            online ? "§a• online" : "§8offline",
            "",
            "§fRanks held §8(display order):",
            list,
            "",
            `§fAuthority: §r${strongest?.display ?? "§7none"}`,
            "§8Authority always comes from the ladder, not this order —",
            "§8reordering here only changes which tag shows.",
            allowed ? "" : "\n§cThey outrank you — you can't change their ranks."
        ].join("\n"),
        buttons: allowed ? [
            { text: "§a+ Add rank", run: () => addRankScreen(player, targetId, targetName, again) },
            { text: "§c- Remove rank", run: () => removeRankScreen(player, targetId, targetName, again) },
            held.length > 1
                ? { text: "§7⇅ Display order §8· which tag shows", run: () => displayOrderScreen(player, targetId, targetName, again) }
                : null,
            { text: "§bSet rank §8· replace everything they hold", run: () => setRankScreen(player, targetId, targetName, again) }
        ].filter(Boolean) : [],
        back
    })
}

/** Reorder just this player's held ranks — cosmetic, never authority. */
async function displayOrderScreen(player, targetId, targetName, back) {
    const held = displayRanks(targetId)
    if (held.length < 2) return back()
    return menu(player, {
        title: title(`Display order · ${targetName}`),
        body: subtitle("The first rank is the tag they wear.\n§8This does not change what they can do."),
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
        title: title(rank.id),
        body: `${rank.display}§r\n${subtitle(`Position ${index + 1} of ${held.length}`)}`,
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
    if (!options.length) { err(player, "No ranks left to add that sit below your own."); return back() }
    return pagedMenu(player, {
        title: title(`Add rank · ${targetName}`),
        items: options,
        render: rank => ({ text: `${rank.display}§r` }),
        onPick: async rank => {
            // Say what a promotion will drop before it drops it.
            const losing = displacedBy(targetId, rank.id)
            if (losing.length) {
                const list = losing.map(r => r.display + "§r").join("§7, ")
                const yes = await confirm(player, hubTitle("ranks", "Promote"),
                    `Give §f${targetName}§r ${rank.display}§r?` +
                    `${String.fromCharCode(10)}${String.fromCharCode(10)}§7This replaces: ${list}` +
                    `${String.fromCharCode(10)}§8Turn off "Replaces lower ranks" on the rank to stack instead.`,
                    "§aPromote")
                if (!yes) return back()
            }
            const before = heldRankIds(targetId)
            grantRank(targetId, rank.id, targetName)
            record(player, "rank.grant", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} is now ${rank.display}§a.`)
            notify(targetId, `You were given the ${rank.display}§r rank.`)
            return back()
        },
        back
    })
}

async function removeRankScreen(player, targetId, targetName, back) {
    const held = heldRankIds(targetId).map(getRank).filter(Boolean).filter(rank => canEditRank(player, rank))
    if (!held.length) { err(player, "They hold no ranks you're allowed to remove."); return back() }
    return pagedMenu(player, {
        title: title(`Remove rank · ${targetName}`),
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
    if (!options.length) { err(player, "There are no ranks below your own to grant."); return back() }
    return pagedMenu(player, {
        title: title(`Set rank · ${targetName}`),
        body: subtitle("Replaces every rank they currently hold."),
        items: options,
        render: rank => ({ text: `${rank.display}§r` }),
        onPick: async rank => {
            const yes = await confirm(player, title("Set rank"),
                `Set §f${targetName}§r to ${rank.display}§r?\n\n§7Their other ranks are removed.`, "§aSet rank")
            if (!yes) return back()
            const before = heldRankIds(targetId)
            setRanks(targetId, [rank.id], targetName)
            record(player, "rank.set", { id: targetId, name: targetName }, rank.id,
                { kind: "ranks", ranks: before })
            ok(player, `${targetName} is now ${rank.display}§a.`)
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
