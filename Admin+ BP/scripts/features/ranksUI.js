import { world } from "@minecraft/server"
import { menu, pagedMenu, modal, confirm, title, subtitle } from "../core/ui.js"
import { hubTitle, hubButton, hubEntry } from "../core/theme.js"
import { setting } from "../core/settings.js"
import { record } from "../core/logs.js"
import { ok, err, info } from "../core/util.js"
import {
    ladder, getRank, saveRank, deleteRank, normaliseRankId, moveRank,
    PRESETS, BUNDLES, PERMISSION_NODES,
    applyPreset, restoreSnapshot, hasSnapshot, snapshot,
    canEditRank, canActOn, has, displacedBy,
    playerRanks, displayRanks, heldRankIds, primaryRank, moveHeldRank,
    setRanks, grantRank, revokeRank, knownHolders
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

const META_KEYS = {
    tpCooldown: { label: "Teleport cooldown (seconds)" + "\n§8Staff ranks ignore cooldowns entirely.", min: 0, max: 60, fallback: 3 }
}

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
            { text: "§bPermission bundles", run: () => bundlesScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bPermissions §8· on / off", run: () => nodeGroupsScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bInheritance", run: () => inheritScreen(player, rankId, () => rankScreen(player, rankId, back)) },
            { text: "§bMeta values §8· limits", run: () => metaScreen(player, rankId, () => rankScreen(player, rankId, back)) },
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
        replacesLower: values.replaces,
        inherits: [],
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
        { id: "isDefault", type: "toggle", label: "Default rank for new players", default: !!rank.default },
        {
            id: "replaces",
            type: "toggle",
            label: "Replaces lower ranks when granted" +
                "\n§8On: giving this rank drops the weaker ones (a promotion)." +
                "\n§8Off: it stacks on top of what they already hold.",
            default: rank.replacesLower !== false
        }
    ])
    if (!values) return back()
    saveRank(rankId, {
        display: values.display,
        staff: values.staff,
        default: values.isDefault,
        replacesLower: values.replaces
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

async function bundlesScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const keys = Object.keys(BUNDLES)
    const owned = key => BUNDLES[key].nodes.every(n => rank.perms.includes(n))
    const values = await modal(player, title(`Bundles · ${rankId}`),
        keys.map(key => ({
            id: key,
            type: "toggle",
            label: `${BUNDLES[key].label}\n§8${BUNDLES[key].nodes.join(", ")}`,
            default: owned(key)
        })))
    if (!values) return back()

    let perms = [...rank.perms]
    for (const key of keys) {
        const nodes = BUNDLES[key].nodes
        if (values[key]) {
            for (const node of nodes) if (!perms.includes(node)) perms.push(node)
        } else if (owned(key)) {
            perms = perms.filter(p => !nodes.includes(p))
        }
    }
    saveRank(rankId, { perms })
    ok(player, `Updated bundles for §f${rankId}§a.`)
    return back()
}

async function nodeGroupsScreen(player, rankId, back) {
    return menu(player, {
        title: title(`Permissions · ${rankId}`),
        body: subtitle("Every permission is a simple on/off.\n§8Off means the rank says nothing about it — the holder just gets\n§8whatever the default rank already gives them."),
        buttons: Object.keys(PERMISSION_NODES).map(group => ({
            text: group,
            run: () => nodeGroupScreen(player, rankId, group, () => nodeGroupsScreen(player, rankId, back))
        })),
        back
    })
}

async function nodeGroupScreen(player, rankId, group, back) {
    const rank = getRank(rankId)
    const nodes = PERMISSION_NODES[group]

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

    const values = await modal(player, hubTitle("ranks", group),
        nodes.map(node => dropdown
            ? {
                id: node,
                type: "dropdown",
                label: node,
                options: ["Default", "§aAllow", "§cDeny"],
                default: stateOf(node)
            }
            : {
                id: node,
                type: "toggle",
                label: node,
                default: rank.perms.includes(node)
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
        } else if (value) {
            perms.push(node)
        }
    }

    // Switching back to toggles would otherwise strand a denial the toggle view
    // cannot show or clear, so say plainly that they are still in force.
    const denials = perms.filter(p => p.startsWith("-") && nodes.includes(p.slice(1)))
    saveRank(rankId, { perms })
    ok(player, `Updated permissions for §f${rankId}§a.`)
    if (denials.length && !dropdown) {
        info(player, `§7Still denied here: §f${denials.join(", ")}§7 — switch the editor to dropdown in < Code > to clear them.`)
    }
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

async function metaScreen(player, rankId, back) {
    const rank = getRank(rankId)
    const keys = Object.keys(META_KEYS)
    const values = await modal(player, title(`Meta · ${rankId}`),
        keys.map(key => ({
            id: key,
            type: "slider",
            label: META_KEYS[key].label,
            min: META_KEYS[key].min,
            max: META_KEYS[key].max,
            step: 1,
            default: Number(rank.meta?.[key] ?? META_KEYS[key].fallback)
        })))
    if (!values) return back()
    saveRank(rankId, { meta: { ...rank.meta, ...values } })
    ok(player, `Updated meta for §f${rankId}§a.`)
    return back()
}

// ============================================================ Ranks ▸ Players

async function rankPlayersScreen(player, back) {
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
