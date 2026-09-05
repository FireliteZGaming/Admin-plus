import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable, BIG, bigSlotFor, isBigDivider } from "../core/chestUI.js"
import {
    snapshot, enderSnapshot, slotLabel, itemLine, transfer, deposit
} from "../core/inventory.js"

// /ec and /enderchest — the real ender chest, on screen.
//
// This was written off as impossible twice: the script API documents no ender
// chest anywhere on Player, and of every addon installed on this machine — a
// full essentials pack among them — not one reads it. The component is
// `minecraft:ender_inventory` and it hands back an ordinary Container. The
// lesson is the one CLAUDE.md already draws twice over: "the API cannot do X"
// is not "X is impossible", and the way you find out is by reading a pack that
// does it rather than by reasoning about the docs.
//
// THE SCREEN is the `big` chest size, which exists for this: 9x9, laid out the
// way the game lays out a chest. Ender chest on the top three rows, a break,
// their pack, another break, and the hotbar alone on the bottom row — the two
// breaks are real rows of the grid that are never filled, over flat background
// with no slot squares.
//
// TAPPING, because forms still have no drag slots. What a tap does depends on
// which half you tapped and whose chest it is, and in both cases it is the only
// thing it could sensibly mean:
//
//   YOUR OWN     top -> take it out.  bottom -> put it in.
//                A working two-way ender chest without a single drag.
//   SOMEBODY     everything on screen is theirs, so a tap takes it off them,
//   ELSE'S       exactly as /invsee does. Looking needs admin.invsee; taking
//                needs to outrank them as well.


export async function enderScreen(viewer, target, back) {
    const own = viewer.id === target.id
    if (!chestUIAvailable()) {
        // The list view is invsee's fallback and it covers the inventory half.
        // The ender half has no words-only screen yet, and inventing a worse
        // one here would be a second thing to keep working.
        err(viewer, "The ender chest screen needs the resource pack — check it is on, above other packs.")
        return back ? back() : undefined
    }

    const ender = enderSnapshot(target)
    if (!ender.readable) {
        err(viewer, `Couldn't read ${own ? "your" : `${displayName(target)}'s`} ender chest — they may have just left.`)
        return back ? back() : undefined
    }
    const carried = snapshot(target)

    const form = new ChestForm("big").title(own ? "Ender chest" : `${target.name}'s ender chest`)
    const atSlot = new Map()

    // The chest half.
    for (const item of ender.slots) {
        const slot = BIG.container + item.ref.index
        atSlot.set(slot, item)
        form.button(slot, item.label, tooltip(item, own, true),
            item.typeId, item.amount, item.enchants.length > 0)
    }

    // The inventory half, in the same shape the player sees their own.
    for (const item of carried.slots) {
        const slot = bigSlotFor(item.ref.index)
        if (slot === undefined) continue
        atSlot.set(slot, item)
        form.button(slot, item.label, tooltip(item, own, false),
            item.typeId, item.amount, item.enchants.length > 0)
    }

    const response = await form.show(viewer)
    if (response.canceled) return back ? back() : undefined

    const again = () => enderScreen(viewer, target, back)
    const picked = atSlot.get(response.selection)
    if (!picked || isBigDivider(response.selection)) return again()

    return own
        ? moveOwn(viewer, picked, again)
        : takeFrom(viewer, target, picked, again)
}

/**
 * Your own chest: the tap moves the stack to the other half.
 *
 * Both directions re-read the slot before moving anything, so a stack that
 * changed between the form being drawn and the tap lands as a refusal rather
 * than as the wrong item moving.
 */
async function moveOwn(player, item, again) {
    const toChest = item.ref.kind !== "ender"
    const result = toChest ? deposit(player, item.ref) : transfer(player, player, item.ref)
    if (!result.ok) { err(player, result.reason); return again() }
    ok(player, toChest
        ? `Stored §f${itemLine(result.item)}§a.`
        : `Took §f${itemLine(result.item)}§a out.`)
    return again()
}

/** Somebody else's: the tap takes it, and only if you outrank them. */
async function takeFrom(viewer, target, item, again) {
    if (!canActOn(viewer, target)) {
        err(viewer, `${displayName(target)}§c outranks you — you can look, but not take.`)
        return again()
    }
    const result = transfer(viewer, target, item.ref)
    if (!result.ok) { err(viewer, result.reason); return again() }

    const where = item.ref.kind === "ender" ? "ender chest" : "inventory"
    record(viewer, "mod.enderchest.take", target, `${itemLine(result.item)} (${where})`)
    ok(viewer, `Took §f${itemLine(result.item)}§a from their ${where}.`)
    return again()
}

/** The hover text under an item. */
function tooltip(item, own, inChest) {
    const lines = []
    for (const enchant of item.enchants) lines.push(`§7${enchant.id} ${enchant.level}`)
    if (item.durability) {
        lines.push(`§8durability ${item.durability.left}/${item.durability.max} (${item.durability.percent}%)`)
    }
    for (const line of item.lore) lines.push(`§o§5${line}`)
    lines.push("")
    lines.push(`§8${slotLabel(item.ref)}`)
    if (own) lines.push(inChest ? "§aTap to take it out" : "§bTap to store it")
    else lines.push("§cTap to take it off them")
    return lines
}

// ------------------------------------------------------------------- command

/**
 * One behaviour, two names. `/ec` is what people type; `/enderchest` is what
 * they look for when they do not know that. Essentials made them the same
 * command and there is no reason to be different.
 */
function openFor(viewer, selected) {
    if (!flag("feature.enderchest")) {
        return err(viewer, "Ender chests are turned off here.")
    }

    const targets = selected ?? []
    if (!targets.length) return enderScreen(viewer, viewer, undefined)
    if (targets.length > 1) {
        return err(viewer, "That selector matched more than one player — this opens one chest at a time.")
    }

    const target = targets[0]
    if (target.id === viewer.id) return enderScreen(viewer, viewer, undefined)

    // Looking in somebody else's is the invsee permission, deliberately rather
    // than a node of its own: a new node would be absent from every rank table
    // already out there, so nobody's existing staff would have it until an
    // owner re-applied a ladder. Same reasoning as /menu and /warnings.
    if (!has(viewer, "admin.invsee")) {
        return err(viewer, "You can only open your own ender chest.")
    }

    record(viewer, "mod.enderchest", target, "opened their ender chest")
    if (has(target, "admin.invsee")) {
        // Staff get told when other staff go through them; nobody else does,
        // for the reason invsee gives — a search that announces itself is not
        // a search.
        info(target, `§7${displayName(viewer)}§7 looked in your ender chest.`)
    }
    return enderScreen(viewer, target, undefined)
}

const PLAYER = [{ name: "player", type: CustomCommandParamType.PlayerSelector }]

command({
    name: "ec",
    description: "Open your ender chest — /ec, or /ec <player> for staff",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})

command({
    name: "enderchest",
    description: "Open your ender chest — /enderchest, or /enderchest <player> for staff",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})
