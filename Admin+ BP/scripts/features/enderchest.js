import { CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, canActOn } from "../core/ranks.js"
import { flag } from "../core/settings.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { openEnderView } from "../core/enderview.js"
import { placeEnderChest } from "../core/enderblock.js"
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
// THE SCREEN is the `big` chest size, which exists for this: 72 buttons laid
// out the way the game lays out a chest. Ender chest on the top three rows, a
// full-row break, their pack, then the hotbar alone under a thin gap. The first
// 63 are a 9x7 grid; the hotbar's nine are placed by hand so its gap can be the
// width of the panel's own edge rather than a whole row.
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


/**
 * The one cell of the break row that is a control.
 *
 * The break is otherwise never drawn into, so a single item in the middle of it
 * reads as a deliberate button rather than as a stray slot — and it is the only
 * free cell on the screen, because the other 71 are real inventory.
 */
const DRAG_SLOT = BIG.divider + 4

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

    // The way through to a real container, when the world allows one. It is a
    // button rather than the default because a container cannot be opened from
    // script at all — the Player class has no method for it — so the drag view
    // always costs a tap on something in the world, and putting that between
    // the player and their own chest made `/ec` feel broken.
    if (flag("enderchest.dragUI")) {
        form.button(DRAG_SLOT, "§bDrag view",
            ["§7A real chest you can drag and shift-click in.",
                "§8Puts a marker in front of you to tap."],
            "minecraft:ender_chest", 1, true)
    }

    const response = await form.show(viewer)
    if (response.canceled) return back ? back() : undefined

    const again = () => enderScreen(viewer, target, back)

    if (response.selection === DRAG_SLOT && flag("enderchest.dragUI")) {
        const view = openEnderView(viewer, target)
        if (view.ok) {
            return info(viewer, own
                ? "§7Tap the marker in front of you."
                : `§7Tap the marker — that is ${displayName(target)}§7's ender chest, live.`)
        }
        err(viewer, view.reason)
        return again()
    }

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
function openFor(viewer, selected, mode) {
    if (!flag("feature.enderchest")) {
        return err(viewer, "Ender chests are turned off here.")
    }

    const targets = selected ?? []
    if (!targets.length) return open(viewer, viewer, mode)
    if (targets.length > 1) {
        return err(viewer, "That selector matched more than one player — this opens one chest at a time.")
    }

    const target = targets[0]
    if (target.id === viewer.id) return open(viewer, viewer, mode)

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
    return open(viewer, target, mode)
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
function open(viewer, target, mode) {
    // A/B TEST, 2026-09-06. Neither mechanism can open a container outright —
    // nothing can — so the question is which interaction costs least, and that
    // is a question only a playtest answers. `/enderchest` and `/ec` are
    // temporarily DIFFERENT so the two can be compared side by side; they go
    // back to being the same command once one of them wins.
    // THE BLOCK ROUTE, and it is only possible on your own chest: a placed
    // ender chest always shows whoever opens it THEIR contents, so it can never
    // be used to look inside somebody else's. Staff keep the entity routes.
    if (mode === "block" && flag("enderchest.dragUI")) {
        if (viewer.id === target.id) {
            const put = placeEnderChest(viewer)
            if (put.ok) {
                return info(viewer, "§7Your ender chest is in front of you — it clears itself when you close it.")
            }
            info(viewer, `§8${put.reason} Showing the tap view instead.`)
            return enderScreen(viewer, target, undefined)
        }
        mode = "marker"
    }

    if (mode && flag("enderchest.dragUI")) {
        const view = openEnderView(viewer, target, mode)
        if (view.ok) {
            const how = mode === "ride"
                ? "§7Seated. Open your inventory — the chest should be beside it."
                : "§7Tap the marker in front of you."
            return info(viewer, how)
        }
        info(viewer, `§8${view.reason} Showing the tap view instead.`)
    }
    return enderScreen(viewer, target, undefined)
}

const PLAYER = [{ name: "player", type: CustomCommandParamType.PlayerSelector }]

command({
    name: "ec",
    description: "Open your ender chest — /ec, or /ec <player> for staff",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected, "block")
})

command({
    name: "enderchest",
    description: "Open your ender chest — /enderchest, or /enderchest <player> for staff",
    optional: PLAYER,
    run: (viewer, [selected]) => openFor(viewer, selected, "marker")
})
