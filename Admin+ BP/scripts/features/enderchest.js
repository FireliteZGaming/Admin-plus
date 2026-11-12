import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable, BIG, bigSlotFor, isBigDivider } from "../core/chestUI.js"
import {
    snapshot, enderSnapshot, slotLabel, itemLine, transfer, moveTo
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
// THE SCREEN is the `big` chest size, which exists for this: 72 buttons laid
// out the way the game lays out a chest. Ender chest on the top three rows, a
// full-row break, their pack, then the hotbar alone under a thin gap. The first
// 63 are a 9x7 grid; the hotbar's nine are placed by hand so its gap can be the
// width of the panel's own edge rather than a whole row.
//
// PICKING UP AND PUTTING DOWN, because a form cannot drag. It is not a missing
// feature: a form's only channel back to script is "button N was pressed", so
// there is no message that could carry "slot 3 was dropped onto slot 17", and
// no resource pack can invent one. What a pack CAN do is draw the screen, which
// is why the chest grid exists at all.
//
// So the gesture becomes two taps instead of one drag, and the outcome is the
// same one — including landing on an occupied slot, which swaps.
//
//   YOUR OWN     tap a stack to lift it, tap anywhere to set it down. Tap
//                where it came from to put it back.
//   SOMEBODY     everything on screen is theirs, so a tap takes it off them,
//   ELSE'S       exactly as /invsee does. Looking needs admin.invsee; taking
//                needs to outrank them as well.
//
// The "Real chest" button is the escape hatch for anyone who wants actual
// dragging, and it costs what dragging costs on Bedrock: something real to
// open, and one tap on it.


/**
 * Which real slot a grid cell stands for — the inverse of the layout.
 *
 * Needed because picking up and putting down has to work on EMPTY cells too,
 * and the drawn buttons only cover the occupied ones.
 */
function refForSlot(slot) {
    if (slot >= BIG.container && slot < BIG.divider) {
        return { kind: "ender", index: slot - BIG.container }
    }
    if (slot >= BIG.pack && slot < BIG.pack + 27) {
        return { kind: "slot", index: 9 + (slot - BIG.pack) }
    }
    if (slot >= BIG.hotbar && slot < BIG.hotbar + 9) {
        return { kind: "slot", index: slot - BIG.hotbar }
    }
    return undefined      // a break row: not a slot at all
}

function sameRef(a, b) {
    return !!a && !!b && a.kind === b.kind && a.index === b.index
}

export async function enderScreen(viewer, target, back, held) {
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

    // The held stack is named in the TITLE rather than drawn into the break row.
    // A button there renders as an item floating in what is meant to read as
    // empty space, which looked like a bug rather than a control.
    const heading = own ? "Ender chest" : `${target.name}'s ender chest`
    const form = new ChestForm("big")
        .title(held ? `${heading} · holding ${held.label}` : heading)
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

    // The way through to a real container, when the world allows one. It is a
    // button rather than the default because a container cannot be opened from
    // script at all — the Player class has no method for it — so the drag view
    // always costs a tap on something in the world, and putting that between
    // the player and their own chest made `/ec` feel broken.
    const response = await form.show(viewer)
    if (response.canceled) return back ? back() : undefined

    const again = (carry = held) => enderScreen(viewer, target, back, carry)

    const slot = response.selection
    const ref = refForSlot(slot)

    // PICK UP AND PUT DOWN, which is dragging without the drag. Only on your
    // own chest: rearranging somebody else's while they are using it is a
    // different feature with different consequences, and staff want to TAKE.
    if (own && ref) {
        if (held) {
            if (sameRef(held.ref, ref)) return again(undefined)      // put it back
            const moved = moveTo(viewer, held.ref, ref)
            if (!moved.ok) { err(viewer, moved.reason); return again(undefined) }
            return again(undefined)
        }
        const there = atSlot.get(slot)
        if (!there) return again()                                   // empty, nothing to lift
        return again({
            ref,
            label: there.label,
            typeId: there.typeId,
            amount: there.amount,
            enchanted: there.enchants.length > 0
        })
    }

    const picked = atSlot.get(slot)
    if (!picked || isBigDivider(slot)) return again()
    return takeFrom(viewer, target, picked, again)
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
        return err(viewer, "Ender chests are turned off on this server.")
    }

    const targets = selected ?? []
    if (!targets.length) return open(viewer, viewer)
    if (targets.length > 1) {
        return err(viewer, "That selector matched more than one player — this opens one chest at a time.")
    }

    const target = targets[0]
    if (target.id === viewer.id) return open(viewer, viewer)

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
    return open(viewer, target)
}

/**
 * Straight to the screen, with no step in between.
 *
 * THE COMMAND MUST OPEN SOMETHING IMMEDIATELY. That rules out leading with the
 * drag view, because a container cannot be opened from script — `Player` has no
 * method for it, the DDUI `CustomForm` has no slot control, and no vanilla
 * command opens one either (checked 2026-09-06 against the API reference and
 * the command list). The engine opens a container only when a player interacts
 * with one, so the drag view will always cost a tap on something in the world.
 *
 * A form has the opposite pair of properties: it opens on demand and can never
 * have slots. That is not a coincidence — it is the same fact from both sides,
 * and it is why the chest UI is a form wearing a chest's clothes.
 *
 * So the instant screen leads and the drag view is a button inside it, taken
 * deliberately when somebody actually wants to move things around.
 */
function open(viewer, target) {
    return enderScreen(viewer, target, undefined)
}

const PLAYER = [{ name: "player", type: CustomCommandParamType.PlayerSelector }]

// The parameter list is a CONSTANT, which is how two source-scanning audits
// once reported these as taking no player at all. Anything that counts player
// arguments has to read commandSpecs(), not the text of the file.
command({
    name: "ec",
    description: "Open your ender chest. Staff can open a player's",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})

command({
    name: "enderchest",
    description: "Open your ender chest. Staff can open a player's",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected)
})
