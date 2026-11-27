import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable, BIG, bigSlotFor, isBigDivider } from "../core/chestUI.js"
import { snapshot, enderSnapshot, slotLabel, itemLine, transfer } from "../core/inventory.js"

// /ec and /enderchest: a player's ender chest, on screen. A STAFF tool since
// 3.1.7, the user: "reactivate enderchests under staff tools as it's an
// invsee ... You can't view your own either". It is /invsee for the ender
// chest: always on (no switch), behind the invsee permission, and only for
// somebody else's chest. Players open their own with an ender chest block,
// as the game intends.
//
// The component is `minecraft:ender_inventory` and it hands back an ordinary
// Container. This was written off as impossible twice: the script API
// documents no ender chest anywhere on Player. "The API cannot do X" is not
// "X is impossible" (CLAUDE.md).
//
// THE SCREEN is the `big` chest size: 72 buttons laid out the way the game
// lays out a chest. Their ender chest on the top three rows, a full-row break,
// their pack, then their hotbar. A tap takes the item off them, exactly as
// /invsee does. Looking needs admin.invsee; taking needs to outrank them too.
//
// IT CANNOT TAKE THE WRONG THING (3.1.7, "patch that so if it looks like it
// breaks it won't"). The screen is a picture of the moment it opened; if they
// moved or used the item since, transfer() sees the slot no longer holds what
// was drawn and refuses, then the screen opens again as it is now. And a take
// only goes into an empty slot of yours, so a nearly full inventory can never
// end up with part of a stack while all of it stays with them.

export async function enderScreen(viewer, target, back) {
    if (!chestUIAvailable()) {
        err(viewer, "The ender chest screen needs the Admin+ resource pack. Check that it is on and above other packs.")
        return back ? back() : undefined
    }

    const ender = enderSnapshot(target)
    if (!ender.readable) {
        err(viewer, `Couldn't read ${displayName(target)}'s ender chest. They may have just left.`)
        return back ? back() : undefined
    }
    const carried = snapshot(target)

    const form = new ChestForm("big").title(`${target.name}'s ender chest`)
    const atSlot = new Map()

    // The chest half.
    for (const item of ender.slots) {
        const slot = BIG.container + item.ref.index
        atSlot.set(slot, item)
        form.button(slot, item.label, tooltip(item), item.typeId, item.amount, item.enchants.length > 0)
    }

    // Their inventory, in the shape they see it.
    for (const item of carried.slots) {
        const slot = bigSlotFor(item.ref.index)
        if (slot === undefined) continue
        atSlot.set(slot, item)
        form.button(slot, item.label, tooltip(item), item.typeId, item.amount, item.enchants.length > 0)
    }

    const response = await form.show(viewer)
    if (response.canceled) return back ? back() : undefined

    const again = () => enderScreen(viewer, target, back)
    const slot = response.selection
    const picked = atSlot.get(slot)
    if (!picked || isBigDivider(slot)) return again()
    return takeFrom(viewer, target, picked, again)
}

/** The tap takes it, and only if you outrank them. */
async function takeFrom(viewer, target, item, again) {
    if (!canActOn(viewer, target)) {
        err(viewer, `${displayName(target)}§c outranks you, so you can look but not take.`)
        return again()
    }
    const result = transfer(viewer, target, item.ref, item)
    if (!result.ok) { err(viewer, result.reason); return again() }

    const where = item.ref.kind === "ender" ? "ender chest" : "inventory"
    record(viewer, "mod.enderchest.take", target, `${itemLine(result.item)} (${where})`)
    ok(viewer, `Took §f${itemLine(result.item)}§a from their ${where}.`)
    return again()
}

/** The hover text under an item. */
function tooltip(item) {
    const lines = []
    for (const enchant of item.enchants) lines.push(`§7${enchant.id} ${enchant.level}`)
    if (item.durability) {
        lines.push(`§8durability ${item.durability.left}/${item.durability.max} (${item.durability.percent}%)`)
    }
    for (const line of item.lore) lines.push(`§o§5${line}`)
    lines.push("")
    lines.push(`§8${slotLabel(item.ref)}`)
    lines.push("§cTap to take it off them")
    return lines
}

// ------------------------------------------------------------------- command

/** Somebody else's ender chest, straight to the screen. */
function openFor(viewer, selected) {
    const targets = selected ?? []
    if (targets.length > 1) {
        return err(viewer, "That matched more than one player. This opens one chest at a time.")
    }
    const target = targets[0]
    if (!target) return err(viewer, "Pick the player whose ender chest you want to see.")
    if (target.id === viewer.id) {
        return err(viewer, "This is for looking in another player's ender chest. Open your own with an ender chest.")
    }

    record(viewer, "mod.enderchest", target, "opened their ender chest")
    if (has(target, "admin.invsee")) {
        // Staff get told when other staff go through them; nobody else does,
        // for the reason invsee gives: a search that announces itself is not
        // a search.
        info(target, `§7${displayName(viewer)}§7 looked in your ender chest.`)
    }
    return enderScreen(viewer, target, undefined)
}

// Leave the player off and the game's player list is offered (core/ask.js);
// the asker isn't on it, since this is never for your own chest.
const PLAYER = [{ name: "player", type: CustomCommandParamType.PlayerSelector }]

// The parameter list is a CONSTANT, which is how two source-scanning audits
// once reported these as taking no player at all. Anything that counts player
// arguments has to read commandSpecs(), not the text of the file.
command({
    name: "ec",
    description: "Look in a player's ender chest, and take things out",
    perm: "admin.invsee",
    mandatory: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})

command({
    name: "enderchest",
    description: "Look in a player's ender chest, and take things out (same as /ec)",
    perm: "admin.invsee",
    mandatory: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})
