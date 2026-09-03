import { CustomCommandParamType, EquipmentSlot } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, confirm } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable } from "../core/chestUI.js"
import { snapshot, slotLabel, itemLine, confiscate, transfer } from "../core/inventory.js"

// /invsee <player> — look inside somebody's inventory.
//
// Two views of the same thing:
//
//   CHEST  the real one. A 9x6 grid of item icons, laid out the way their
//          inventory actually is: hotbar and pack in the first 36 slots, the
//          armour they are wearing on the row below, offhand at the end. Tap an
//          item and it comes to you. It works by a resource-pack trick — see
//          core/chestUI.js for how, and why the sentinel strings must not be
//          changed.
//
//   LIST   the fallback. An ordinary form, one row per stack, with everything
//          spelled out in words. Slower to read but it needs no resource pack
//          at all, so it still works if the RP is missing, disabled, or losing
//          a fight with another pack that overrides the same UI. Turn it on
//          with invsee.chestUI = false in < Code >.
//
// Looking is gated on admin.invsee. TAKING is gated on the hierarchy as well:
// you can read the inventory of somebody who outranks you, but you cannot pull
// things out of it. Both are logged, because "staff went through my stuff" is a
// complaint that needs an answer either way.

/** Where each worn piece sits in the 54-slot grid — the bottom two rows. */
const WORN_SLOT = {
    [EquipmentSlot.Head]: 36,
    [EquipmentSlot.Chest]: 37,
    [EquipmentSlot.Legs]: 38,
    [EquipmentSlot.Feet]: 39,
    [EquipmentSlot.Offhand]: 44
}

export async function invseeScreen(viewer, target, back) {
    const allowed = target.id === viewer.id || canActOn(viewer, target)
    const useChest = flag("invsee.chestUI") && chestUIAvailable()
    return useChest
        ? chestView(viewer, target, allowed, back)
        : listView(viewer, target, allowed, back)
}

// ------------------------------------------------------------- the chest view

async function chestView(viewer, target, allowed, back) {
    const snap = snapshot(target)
    if (!snap.readable) {
        err(viewer, `Couldn't read ${displayName(target)}'s inventory — they may have just left.`)
        return back ? back() : undefined
    }

    const form = new ChestForm("large").title(`${target.name}'s inventory`)
    const atSlot = new Map()

    for (const item of snap.slots) {
        atSlot.set(item.ref.index, item)
        form.button(item.ref.index, item.label, tooltip(item, allowed),
            item.typeId, item.amount, item.enchants.length > 0)
    }

    for (const entry of snap.equipment) {
        if (!entry.item) continue
        const slot = WORN_SLOT[entry.slot]
        if (slot === undefined) continue
        atSlot.set(slot, entry.item)
        form.button(slot, `§b${entry.label}§r · ${entry.item.label}`, tooltip(entry.item, allowed),
            entry.item.typeId, entry.item.amount, entry.item.enchants.length > 0)
    }

    const response = await form.show(viewer)
    if (response.canceled) return back ? back() : undefined

    const picked = atSlot.get(response.selection)
    if (!picked) return chestView(viewer, target, allowed, back)   // an empty slot

    if (!allowed) {
        err(viewer, `${displayName(target)}§c outranks you — you can look, but not take.`)
        return chestView(viewer, target, allowed, back)
    }

    // Between drawing the form and the tap, they may have moved, dropped or
    // eaten it. transfer() re-reads the slot, so the worst case is a refusal
    // rather than taking the wrong thing.
    const result = transfer(viewer, target, picked.ref)
    if (!result.ok) {
        err(viewer, result.reason)
        return chestView(viewer, target, allowed, back)
    }

    record(viewer, "mod.invsee.take", target, itemLine(result.item))
    ok(viewer, `Took §f${itemLine(result.item)}§a from ${displayName(target)}.`)
    return chestView(viewer, target, allowed, back)
}

/** The hover text under an item's name. */
function tooltip(item, allowed) {
    const lines = []
    for (const enchant of item.enchants) lines.push(`§7${enchant.id} ${enchant.level}`)
    if (item.durability) {
        lines.push(`§8durability ${item.durability.left}/${item.durability.max} (${item.durability.percent}%)`)
    }
    for (const line of item.lore) lines.push(`§o§5${line}`)
    lines.push("")
    lines.push(`§8${slotLabel(item.ref)}`)
    lines.push(allowed ? "§cTap to take it off them" : "§8Read only — they outrank you")
    return lines
}

// -------------------------------------------------------------- the list view

async function listView(viewer, target, allowed, back) {
    const snap = snapshot(target)
    const again = () => listView(viewer, target, allowed, back)

    if (!snap.readable) {
        err(viewer, `Couldn't read ${displayName(target)}'s inventory — they may have just left.`)
        return back ? back() : undefined
    }

    const body = [
        `${displayName(target)}§r`,
        `§f${snap.stacks}§7 stack${snap.stacks === 1 ? "" : "s"}§8 · §f${snap.items}§7 item${snap.items === 1 ? "" : "s"}§8 · §f${snap.worn}§7 worn`,
        allowed ? "" : "\n§cThey outrank you — you can look, but not take."
    ].filter(Boolean).join("\n")

    const worn = snap.equipment
        .filter(entry => entry.item)
        .map(entry => ({
            text: `§b${entry.label}§r §8· §f${entry.item.label}${entry.item.amount > 1 ? ` §7x${entry.item.amount}` : ""}${badges(entry.item)}`,
            run: () => itemScreen(viewer, target, entry.item, allowed, again)
        }))

    const carried = snap.slots.map(item => ({
        text: `§7${slotLabel(item.ref)}§r §8· §f${item.label}${item.amount > 1 ? ` §7x${item.amount}` : ""}${badges(item)}`,
        run: () => itemScreen(viewer, target, item, allowed, again)
    }))

    const buttons = [...worn, ...carried]
    if (!buttons.length) {
        buttons.push({ text: "§8Nothing at all — empty inventory, nothing worn", run: again })
    }
    buttons.push({ text: "§8Refresh", run: again })

    return menu(viewer, {
        title: hubTitle("actions", `${target.name}'s inventory`),
        body,
        buttons,
        back
    })
}

/** The tells worth seeing without opening the item. */
function badges(item) {
    const marks = []
    if (item.enchants.length) marks.push("§d✦")
    if (item.renamed) marks.push("§e✎")
    if (item.durability && item.durability.percent <= 20) marks.push("§c▮")
    return marks.length ? ` ${marks.join("")}` : ""
}

async function itemScreen(viewer, target, item, allowed, back) {
    const lines = [
        `§f${item.label}§r${item.renamed ? " §8(renamed)" : ""}`,
        `§8${item.typeId}`,
        `§7Amount: §f${item.amount}`,
        `§7Where: §f${slotLabel(item.ref)}`
    ]
    if (item.durability) {
        lines.push(`§7Durability: §f${item.durability.left}§8/§7${item.durability.max} §8(${item.durability.percent}%)`)
    }
    if (item.enchants.length) {
        lines.push("", "§dEnchantments")
        for (const enchant of item.enchants) lines.push(`§8· §r${enchant.id} ${enchant.level}`)
    }
    if (item.lore.length) {
        lines.push("", "§7Lore")
        for (const line of item.lore) lines.push(`§8· §r${line}`)
    }
    if (!allowed) lines.push("", "§cThey outrank you — read only.")

    return menu(viewer, {
        title: hubTitle("actions", item.label),
        body: lines.join("\n"),
        buttons: [
            allowed
                ? {
                    text: "§aTake it§r\n§8Moves the stack into your inventory",
                    run: async () => {
                        const result = transfer(viewer, target, item.ref)
                        if (!result.ok) { err(viewer, result.reason); return back() }
                        record(viewer, "mod.invsee.take", target, itemLine(result.item))
                        ok(viewer, `Took §f${itemLine(result.item)}§a from ${displayName(target)}.`)
                        return back()
                    }
                }
                : null,
            allowed
                ? {
                    text: "§cDestroy it§r\n§8Deletes the stack outright",
                    run: async () => {
                        const yes = await confirm(viewer, hubTitle("actions", "Destroy item"),
                            `Delete §f${itemLine(item)}§r from ${displayName(target)}?\n\n§8It is gone — this does not put it anywhere.`,
                            "§cDestroy")
                        if (!yes) return back()
                        const result = confiscate(target, item.ref)
                        if (!result.ok) { err(viewer, result.reason); return back() }
                        record(viewer, "mod.invsee.destroy", target, itemLine(result.item))
                        ok(viewer, `Destroyed §f${itemLine(result.item)}§a.`)
                        return back()
                    }
                }
                : null
        ].filter(Boolean),
        back
    })
}

// ------------------------------------------------------------------- command

command({
    name: "invsee",
    description: "Look inside a player's inventory — /invsee <player>",
    perm: "admin.invsee",
    mandatory: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (viewer, [selected]) => {
        const targets = selected ?? []
        if (!targets.length) return err(viewer, "No player matched that selector.")
        if (targets.length > 1) {
            return err(viewer, "That selector matched more than one player — /invsee opens one inventory at a time.")
        }
        const target = targets[0]

        if (target.id !== viewer.id) {
            record(viewer, "mod.invsee", target, "opened their inventory")
            if (has(target, "admin.invsee")) {
                // Staff get told when other staff look through them. Nobody else
                // does: an invsee that announces itself to the suspect is useless.
                info(target, `§7${displayName(viewer)}§7 looked in your inventory.`)
            }
        }
        return invseeScreen(viewer, target, undefined)
    }
})

export { WORN_SLOT }
