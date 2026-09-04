import { ItemStack, EquipmentSlot } from "@minecraft/server"
import { Table } from "./storage.js"

// Staff mode — the stow-and-restore half. `/mm` lives in features/staffmode.js.
//
// This is the most dangerous feature in the pack, and it is worth being blunt
// about why: entering staff mode EMPTIES somebody's inventory. If the giving-it-
// back half is wrong, a staff member loses everything they own and there is no
// undo. Every decision below is about that one risk.
//
// TWO COPIES ARE KEPT, and they are not the same kind of thing:
//
//   live      the real ItemStack objects, in a Map. Putting these back is
//             LOSSLESS — it is the same object, so shulker contents, book
//             pages, map data and anything else the script API cannot read all
//             survive. Held in memory, so it dies with the session.
//
//   snapshot  a serialised description in world storage: type, count, name,
//             lore, enchantments, damage. It survives a reload, and it is a
//             RECONSTRUCTION — anything the API cannot read is not in it.
//
// So the good path uses `live` and the safety net uses `snapshot`, and exit()
// reports which one it used rather than pretending they are equivalent.
//
// ORDER IS THE OTHER HALF OF THE SAFETY. The snapshot is written to storage
// and confirmed BEFORE a single slot is cleared. If the read fails, or the
// write fails, enter() returns a refusal and the inventory is untouched. An
// inventory that was never stowed is a feature that did not start; an
// inventory that was cleared before the copy landed is a person's world gone.

const flags = new Table("staffmode", {})

/** Real ItemStacks, this session only. id -> { slots, worn } */
const live = new Map()

/** Worn slots. Mainhand is not here — it is one of the container slots. */
const EQUIP_SLOTS = [
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Offhand
]

const DEFAULT_SIZE = 36

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

export function containerOf(player) {
    return safe(() => player?.getComponent("minecraft:inventory")?.container)
}

function equippableOf(player) {
    return safe(() => player?.getComponent("minecraft:equippable"))
}

// ------------------------------------------------------------- serialisation

/** One stack -> a plain object, or null for an empty slot. Keys are short
 *  because 41 of these go into one dynamic property. */
export function serializeStack(stack) {
    if (!stack?.typeId) return null
    const out = { id: stack.typeId, n: Math.max(1, Number(stack.amount) || 1) }

    const name = safe(() => stack.nameTag)
    if (name) out.name = String(name)

    const lore = safe(() => stack.getLore(), []) ?? []
    if (lore.length) out.lore = lore.map(String)

    const enchants = safe(() => stack.getComponent("minecraft:enchantable")?.getEnchantments(), []) ?? []
    if (enchants.length) {
        out.ench = enchants.map(entry => ({
            id: entry?.type?.id ?? String(entry?.type ?? ""),
            lvl: Number(entry?.level) || 1
        })).filter(e => e.id)
    }

    const damage = safe(() => stack.getComponent("minecraft:durability")?.damage)
    if (typeof damage === "number" && damage > 0) out.dmg = damage

    return out
}

/** A plain object -> a stack. Anything that will not apply is skipped rather
 *  than thrown, because a partly-restored item beats a lost one. */
export function buildStack(plain) {
    if (!plain?.id) return undefined
    const stack = safe(() => new ItemStack(plain.id, Math.max(1, Number(plain.n) || 1)))
    if (!stack) return undefined

    if (plain.name) safe(() => { stack.nameTag = plain.name })
    if (plain.lore?.length) safe(() => stack.setLore(plain.lore.map(String)))

    if (plain.ench?.length) {
        safe(() => {
            const component = stack.getComponent("minecraft:enchantable")
            if (!component) return
            for (const entry of plain.ench) {
                safe(() => component.addEnchantment({ type: entry.id, level: entry.lvl ?? 1 }))
            }
        })
    }
    if (typeof plain.dmg === "number") {
        safe(() => {
            const component = stack.getComponent("minecraft:durability")
            if (component) component.damage = plain.dmg
        })
    }
    return stack
}

// --------------------------------------------------------------- reading out

/** Everything they are carrying, as real stacks. undefined means UNREADABLE,
 *  which is different from "carrying nothing" and must abort the whole thing. */
export function liveInventory(player) {
    const container = containerOf(player)
    if (!container) return undefined

    const size = Number(container.size) || DEFAULT_SIZE
    const slots = []
    for (let i = 0; i < size; i++) slots.push(safe(() => container.getItem(i)) ?? null)

    const worn = {}
    const equippable = equippableOf(player)
    if (equippable) {
        for (const slot of EQUIP_SLOTS) worn[slot] = safe(() => equippable.getEquipment(slot)) ?? null
    }
    return { slots, worn }
}

/** The same thing, serialised. undefined for the same reason. */
export function snapshotOf(player) {
    const held = liveInventory(player)
    if (!held) return undefined
    const worn = {}
    for (const [slot, stack] of Object.entries(held.worn)) worn[slot] = serializeStack(stack)
    return { v: 1, slots: held.slots.map(serializeStack), worn }
}

/** How many slots actually hold something — for the log line, so "stowed 0
 *  items" is visible rather than silent. */
export function countItems(snapshot) {
    const inSlots = (snapshot?.slots ?? []).filter(Boolean).length
    const onBody = Object.values(snapshot?.worn ?? {}).filter(Boolean).length
    return inSlots + onBody
}

// --------------------------------------------------------------- writing back

function writeInventory(player, slots, worn) {
    const container = containerOf(player)
    if (!container) return false
    const size = Number(container.size) || DEFAULT_SIZE
    for (let i = 0; i < size; i++) {
        safe(() => container.setItem(i, slots?.[i] ?? undefined))
    }
    const equippable = equippableOf(player)
    if (equippable) {
        for (const slot of EQUIP_SLOTS) {
            safe(() => equippable.setEquipment(slot, worn?.[slot] ?? undefined))
        }
    }
    return true
}

// ------------------------------------------------------------------ the state

const idOf = p => typeof p === "string" ? p : p?.id

export function inStaffMode(playerOrId) {
    const id = idOf(playerOrId)
    return !!id && (live.has(id) || flags.has(id))
}

/** Who is in staff mode, for the panel and /mm with no argument. */
export function staffModeList() {
    return flags.entries().map(([id, row]) => ({ id, name: row?.name ?? "?", since: row?.since ?? 0 }))
}

/** True when the flag survived a reload but the real stacks did not — so exit
 *  will have to rebuild from the snapshot. */
export function needsRebuild(playerOrId) {
    const id = idOf(playerOrId)
    return !!id && flags.has(id) && !live.has(id)
}

/**
 * Stow everything and hand over the tools.
 * @param {Array<{slot: number, stack: object}>} tools
 * @returns {{ok: boolean, reason?: string, stowed?: number}}
 */
export function enter(player, tools = []) {
    if (!player?.id) return { ok: false, reason: "no player" }
    if (inStaffMode(player)) return { ok: false, reason: "You're already in staff mode." }

    const held = liveInventory(player)
    const snapshot = snapshotOf(player)
    if (!held || !snapshot) {
        return { ok: false, reason: "Couldn't read your inventory, so nothing was touched." }
    }

    // The copy lands FIRST. If this throws, we have cleared nothing.
    try {
        flags.set(player.id, { name: player.name, since: Date.now(), snapshot })
    } catch (e) {
        console.error(`[Admin+] staff mode: could not store ${player.name}'s inventory: ${e}`)
        return { ok: false, reason: "Couldn't save your inventory, so nothing was touched." }
    }
    if (!flags.has(player.id)) {
        return { ok: false, reason: "Couldn't save your inventory, so nothing was touched." }
    }

    live.set(player.id, held)

    writeInventory(player, [], {})
    const container = containerOf(player)
    for (const tool of tools) {
        safe(() => container?.setItem(tool.slot, tool.stack))
    }

    const stowed = countItems(snapshot)
    console.log(`[Admin+] staff mode: ${player.name} in, stowed ${stowed} item stack(s)`)
    return { ok: true, stowed }
}

/**
 * Give it all back.
 * @returns {{ok: boolean, reason?: string, lossless?: boolean, restored?: number}}
 */
export function exit(player) {
    if (!player?.id) return { ok: false, reason: "no player" }
    const flag = flags.get(player.id)
    const held = live.get(player.id)
    if (!flag && !held) return { ok: false, reason: "You're not in staff mode." }

    // Drop the tools before anything else, so a failure below cannot leave both
    // the tools and the real inventory in play at once.
    writeInventory(player, [], {})

    let lossless = false
    let restored = 0
    if (held) {
        writeInventory(player, held.slots, held.worn)
        lossless = true
        restored = held.slots.filter(Boolean).length + Object.values(held.worn).filter(Boolean).length
    } else if (flag?.snapshot) {
        const slots = (flag.snapshot.slots ?? []).map(buildStack)
        const worn = {}
        for (const [slot, plain] of Object.entries(flag.snapshot.worn ?? {})) worn[slot] = buildStack(plain)
        writeInventory(player, slots, worn)
        restored = countItems(flag.snapshot)
    }

    live.delete(player.id)
    flags.delete(player.id)
    console.log(`[Admin+] staff mode: ${player.name} out, restored ${restored} stack(s) ` +
        `(${lossless ? "the originals" : "rebuilt from the saved copy"})`)
    return { ok: true, lossless, restored }
}

/** Testing seam: forget the in-memory half without touching storage, which is
 *  exactly what a world reload does. */
export function __forgetLive(playerOrId) { live.delete(idOf(playerOrId)) }
