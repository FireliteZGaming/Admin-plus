import { EquipmentSlot } from "@minecraft/server"

// Reading — and, where staff are allowed to, editing — another player's
// inventory.
//
// The Bedrock constraint that shapes this whole file: server-ui forms have no
// drag slots and there is no hook for the vanilla inventory screen, so a live
// side-by-side "invsee" like the Java plugin is not on the table. What IS
// possible is a faithful *listing* plus per-item actions, which turns out to
// cover what invsee is actually used for: proving what somebody is carrying,
// and taking it off them.
//
// Everything here is written against plain shapes rather than live Player
// objects — a container is anything with `size` and `getItem`, an item is
// anything with `typeId` and `amount` — so the reading half can be tested
// without a running game.

/** Worn slots, in the order a person would read them off a body. */
export const EQUIPMENT = [
    { slot: EquipmentSlot.Head, label: "Head" },
    { slot: EquipmentSlot.Chest, label: "Chest" },
    { slot: EquipmentSlot.Legs, label: "Legs" },
    { slot: EquipmentSlot.Feet, label: "Feet" },
    { slot: EquipmentSlot.Offhand, label: "Offhand" }
]

/** A player's first nine container slots are the hotbar. */
const HOTBAR = 9
const DEFAULT_SIZE = 36
/** A vanilla ender chest, single-block: three rows of nine. */
const ENDER_SIZE = 27

/**
 * Never let a missing component take the whole screen down. An item that
 * refuses to describe itself should read as a plain item, not as an error.
 */
function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

/** "minecraft:diamond_pickaxe" -> "Diamond Pickaxe". */
export function prettyName(typeId) {
    const bare = String(typeId ?? "").split(":").pop() ?? ""
    const words = bare.split("_").filter(Boolean)
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(" ")
    return words || "Unknown item"
}

function readEnchants(stack) {
    const component = safe(() => stack.getComponent("minecraft:enchantable"))
    const list = safe(() => component?.getEnchantments(), [])
    return (list ?? []).map(entry => ({
        id: prettyName(entry?.type?.id ?? entry?.type ?? ""),
        level: entry?.level ?? 1
    }))
}

function readDurability(stack) {
    const component = safe(() => stack.getComponent("minecraft:durability"))
    const max = component?.maxDurability
    if (typeof max !== "number" || max <= 0) return undefined
    const left = Math.max(0, max - (component.damage ?? 0))
    return { left, max, percent: Math.round((left / max) * 100) }
}

/**
 * One item, flattened into something a form button can render.
 * @returns {object|undefined} undefined for an empty slot
 */
export function describeItem(stack, ref) {
    if (!stack) return undefined
    return {
        ref,
        typeId: stack.typeId,
        // A renamed item is worth flagging: on a duped or spawned item the
        // custom name is often the only tell.
        renamed: !!stack.nameTag,
        label: stack.nameTag || prettyName(stack.typeId),
        amount: stack.amount ?? 1,
        lore: safe(() => stack.getLore(), []) ?? [],
        enchants: readEnchants(stack),
        durability: readDurability(stack)
    }
}

/** Where a slot sits, said the way a player would say it. */
export function slotLabel(ref) {
    if (!ref) return "Unknown slot"
    if (ref.kind === "equipment") {
        return EQUIPMENT.find(e => e.slot === ref.slot)?.label ?? "Equipment"
    }
    if (ref.kind === "ender") return `Ender ${ref.index + 1}`
    return ref.index < HOTBAR ? `Hotbar ${ref.index + 1}` : `Slot ${ref.index + 1}`
}

function containerOf(player) {
    return safe(() => player.getComponent("minecraft:inventory")?.container)
}

/**
 * The ender chest, which turns out to be an ordinary Container after all.
 *
 * This file used to say a player's ender chest was out of reach, and the whole
 * pack believed it — the API reference lists no ender component under Player,
 * and no addon installed on this machine reads one, Minecraft Essentials
 * included. `minecraft:ender_inventory` is nevertheless real, and gives back a
 * Container like any other: 27 slots, getItem, setItem.
 *
 * BOTH SPELLINGS ARE TRIED. Vanilla component ids work with or without the
 * namespace and the pack writes the prefixed form everywhere else, but this one
 * is load-bearing and undocumented enough that being wrong about the spelling
 * would look exactly like "the player has an empty ender chest" — a silent
 * wrong answer in a moderation tool, which is the worst kind.
 */
function enderOf(player) {
    return safe(() => player.getComponent("minecraft:ender_inventory")?.container)
        ?? safe(() => player.getComponent("ender_inventory")?.container)
}

/** The container a ref points into. */
function containerFor(player, ref) {
    return ref?.kind === "ender" ? enderOf(player) : containerOf(player)
}

function equippableOf(player) {
    return safe(() => player.getComponent("minecraft:equippable"))
}

/**
 * Everything a player is carrying and wearing.
 *
 * `readable` is false when the inventory component is not there at all — a
 * state worth showing honestly rather than rendering as "empty", because
 * "they have nothing" and "we could not look" mean very different things to
 * somebody deciding whether to ban.
 */
export function snapshot(player) {
    const container = containerOf(player)
    const slots = []
    if (container) {
        const size = container.size ?? DEFAULT_SIZE
        for (let index = 0; index < size; index++) {
            const item = describeItem(safe(() => container.getItem(index)), { kind: "slot", index })
            if (item) slots.push(item)
        }
    }

    const equippable = equippableOf(player)
    const equipment = EQUIPMENT.map(({ slot, label }) => ({
        slot,
        label,
        item: describeItem(safe(() => equippable?.getEquipment(slot)), { kind: "equipment", slot })
    }))

    return {
        readable: !!container,
        slots,
        equipment,
        stacks: slots.length,
        items: slots.reduce((total, item) => total + item.amount, 0),
        worn: equipment.filter(entry => entry.item).length
    }
}

/**
 * What is in their ender chest.
 *
 * Separate from snapshot() rather than folded into it because the two are read
 * in different situations and one can fail while the other works — and, again,
 * "empty" and "could not look" have to stay tellable apart.
 */
export function enderSnapshot(player) {
    const container = enderOf(player)
    const slots = []
    const size = container?.size ?? ENDER_SIZE
    if (container) {
        for (let index = 0; index < size; index++) {
            const item = describeItem(safe(() => container.getItem(index)), { kind: "ender", index })
            if (item) slots.push(item)
        }
    }
    return {
        readable: !!container,
        size,
        slots,
        stacks: slots.length,
        items: slots.reduce((total, item) => total + item.amount, 0)
    }
}

/**
 * Move one of a player's own slots into their own ender chest.
 *
 * The other half of a usable /ec. Forms have no drag slots, so depositing has
 * to be a tap on the item you want moved rather than a drag into a grid — but
 * the result is the same and it is the real ender chest on the other end.
 *
 * Same ordering as transfer(), and for the same reason: it lands in the ender
 * chest FIRST and the original slot is only cleared once that worked, so a full
 * ender chest costs you nothing instead of eating the stack.
 */
export function deposit(player, ref) {
    const stack = itemAt(player, ref)
    if (!stack) return { ok: false, reason: "That slot is empty now." }
    const item = describeItem(stack, ref)

    const ender = enderOf(player)
    if (!ender) return { ok: false, reason: "Couldn't reach your ender chest." }

    let leftover
    try {
        leftover = ender.addItem(stack)
    } catch {
        return { ok: false, reason: "Couldn't put that in your ender chest." }
    }
    if (leftover) return { ok: false, reason: "Your ender chest is full — nothing was moved." }

    if (!clearSlot(player, ref)) {
        return { ok: false, reason: "Stored a copy but couldn't clear your slot — remove it by hand." }
    }
    return { ok: true, item }
}

/**
 * Move one slot's contents onto another, swapping whatever was there.
 *
 * This is dragging, minus the drag. A form only ever reports which button was
 * pressed — there is no message for "I dropped slot 3 onto slot 17" — so the
 * gesture becomes two taps: pick up, then put down. The OUTCOME is identical,
 * including landing on an occupied slot, which swaps exactly as it would if you
 * had dragged onto it.
 *
 * Both refs must belong to the same player, and neither may be equipment —
 * worn slots have their own rules about what can go in them and silently
 * refusing armour into a helmet slot would be worse than not offering it.
 *
 * @returns {{ok: true, item: object, swapped: boolean} | {ok: false, reason: string}}
 */
export function moveTo(owner, fromRef, toRef) {
    if (!fromRef || !toRef) return { ok: false, reason: "Nothing to move." }
    if (fromRef.kind === "equipment" || toRef.kind === "equipment") {
        return { ok: false, reason: "Worn slots can't be rearranged from here." }
    }
    if (fromRef.kind === toRef.kind && fromRef.index === toRef.index) {
        return { ok: false, reason: "That is where it already is." }
    }

    const from = containerFor(owner, fromRef)
    const to = containerFor(owner, toRef)
    if (!from || !to) return { ok: false, reason: "Couldn't reach that container." }

    const stack = safe(() => from.getItem(fromRef.index))
    if (!stack) return { ok: false, reason: "That slot is empty now." }
    const displaced = safe(() => to.getItem(toRef.index))

    // Write the destination FIRST. If that throws, the source is untouched and
    // nothing is lost; the other order would leave a hole on a failure.
    const landed = safe(() => { to.setItem(toRef.index, stack); return true }, false)
    if (!landed) return { ok: false, reason: "Couldn't put it there." }

    const cleared = safe(() => { from.setItem(fromRef.index, displaced); return true }, false)
    if (!cleared) {
        return { ok: false, reason: "Moved it, but couldn't clear the old slot — check for a copy." }
    }

    return { ok: true, item: describeItem(stack, toRef), swapped: !!displaced }
}

/** The live ItemStack behind a ref, or undefined if the slot is empty now. */
export function itemAt(player, ref) {
    if (!ref) return undefined
    if (ref.kind === "equipment") return safe(() => equippableOf(player)?.getEquipment(ref.slot))
    return safe(() => containerFor(player, ref)?.getItem(ref.index))
}

function clearSlot(player, ref) {
    if (ref.kind === "equipment") {
        const equippable = equippableOf(player)
        if (!equippable) return false
        return safe(() => { equippable.setEquipment(ref.slot, undefined); return true }, false)
    }
    const container = containerFor(player, ref)
    if (!container) return false
    return safe(() => { container.setItem(ref.index, undefined); return true }, false)
}

/**
 * Destroy what is in a slot.
 * @returns {{ok: boolean, item?: object, reason?: string}}
 */
export function confiscate(target, ref) {
    const stack = itemAt(target, ref)
    if (!stack) return { ok: false, reason: "That slot is empty now." }
    const item = describeItem(stack, ref)
    if (!clearSlot(target, ref)) return { ok: false, reason: "Couldn't clear that slot." }
    return { ok: true, item }
}

/**
 * Move a slot's contents into the viewer's own inventory.
 *
 * The order matters: the item is added to the viewer FIRST and only cleared
 * from the target once that succeeded. Doing it the other way round destroys
 * the item whenever the viewer's inventory is full, which is exactly when a
 * staff member is most likely to be confiscating things.
 */
export function transfer(viewer, target, ref) {
    const stack = itemAt(target, ref)
    if (!stack) return { ok: false, reason: "That slot is empty now." }
    const item = describeItem(stack, ref)

    const mine = containerOf(viewer)
    if (!mine) return { ok: false, reason: "Couldn't reach your own inventory." }

    // Not safe(): addItem returns UNDEFINED on success and the leftover stack
    // when it did not fit, so "undefined" is the good case here and collapsing
    // it into a fallback would report every successful take as a full
    // inventory. The throw and the no-room case have to stay distinguishable.
    let leftover
    try {
        leftover = mine.addItem(stack)
    } catch {
        return { ok: false, reason: "Couldn't put that in your inventory." }
    }
    if (leftover) return { ok: false, reason: "Your inventory is full — nothing was taken." }

    if (!clearSlot(target, ref)) {
        // The item is in both inventories at this point, which is a dupe. Say so
        // loudly rather than let it pass as a success.
        return { ok: false, reason: "Took a copy but couldn't clear their slot — remove it by hand." }
    }
    return { ok: true, item }
}

/** One line summarising an item, for logs and chat. */
export function itemLine(item) {
    if (!item) return "nothing"
    const parts = [`${item.label}${item.amount > 1 ? ` x${item.amount}` : ""}`]
    if (item.enchants.length) parts.push(`${item.enchants.length} enchant${item.enchants.length === 1 ? "" : "s"}`)
    if (item.renamed) parts.push("renamed")
    return parts.join(", ")
}
