import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server"

// The Mirror Totem — everything that hits you hits whoever swung it instead.
//
// Two problems, and the second is the interesting one.
//
// **A totem has no durability.** `minecraft:totem_of_undying` is not a tool, so
// there is no damage component to decrement and no bar to draw. The count is
// written into the LORE instead, beside the serial, and the stack is re-minted
// on every hit. That means the charge travels with the ITEM — drop it, trade
// it, put it in a chest, and it is still the same totem with the same charges
// left. A count kept in world storage against a player id would be none of
// those things, because items have no identity to key on.
//
// **Mirroring the hit that kills you is a question about ORDER.** Healing the
// damage back afterwards is too late: they are already dead, and a corpse
// cannot be topped up. The only way to survive a lethal hit is for the damage
// never to land — so this refuses it in `beforeEvents.entityHurt`, which is the
// same two-tier shape spawn protection already uses in features/warps.js:
// cancel where the runtime allows it, and heal back where it does not.
//
// On the fallback path the lethal case genuinely cannot be saved, and the
// totem is honest about it: it is still a real totem of undying, so vanilla's
// own mechanic catches that one hit and the charge is spent restoring it.

/** An unenchanted iron helmet, which is what the brief asked for. */
export const FULL_CHARGE = 165

const MARK = "§8Mirror"

function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

/**
 * Read the charges left off a stack's lore.
 *
 * Absent means this is not one of ours — never "full". A totem somebody found
 * in a chest must not read as a fresh mirror.
 */
export function chargesOf(stack) {
    if (!stack?.typeId) return undefined
    const lore = safe(() => stack.getLore(), []) ?? []
    for (const line of lore) {
        const found = /§8Mirror §7(\d+)\/(\d+)/.exec(String(line))
        if (found) return { left: Number(found[1]), max: Number(found[2]) }
    }
    return undefined
}

/** The lore line that carries the count. */
export function chargeLine(left, max = FULL_CHARGE) {
    return `${MARK} §7${left}/${max}`
}

/**
 * Spend one charge, and say what the stack should become.
 *
 * Returns the REPLACEMENT rather than mutating, because at zero it is no longer
 * the same item: it becomes an ordinary totem of undying, which still saves
 * your life once and is a perfectly good thing to be left holding.
 */
export function spendCharge(stack, mint) {
    const charges = chargesOf(stack)
    if (!charges) return { spent: false, stack }
    const left = charges.left - 1
    if (left <= 0) {
        return { spent: true, left: 0, spent_out: true, stack: new ItemStack("minecraft:totem_of_undying", 1) }
    }
    return { spent: true, left, spent_out: false, stack: mint(left, charges.max) }
}

/** Which hand is holding one, if either. Totems work from either in vanilla. */
export function mirrorHand(player, isMirror) {
    const equippable = safe(() => player.getComponent("minecraft:equippable"))
    if (!equippable) return undefined
    for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand]) {
        const held = safe(() => equippable.getEquipment(slot))
        if (held && isMirror(held)) return { slot, stack: held }
    }
    return undefined
}

/**
 * Put the reflected damage on the attacker.
 *
 * The same number they dealt, and no cause of our own: `applyDamage` without a
 * cause reads as generic, which is right — a mirror does not invent a new kind
 * of harm, it returns the one it was given.
 *
 * Reflecting onto somebody with their OWN mirror would bounce forever, so a
 * reflection never reflects. One bounce, then it stops.
 */
export function reflect(attacker, amount) {
    if (!attacker || !(amount > 0)) return false
    return safe(() => { attacker.applyDamage(amount); return true }, false)
}

/**
 * The whole rule, in one place so both event paths agree.
 *
 * Returns what should happen, without doing any of it — which is what lets the
 * before-path and the after-path share a decision and differ only in how they
 * carry it out.
 */
export function mirrorVerdict({ victim, attacker, amount, isMirror }) {
    if (!victim || !(amount > 0)) return undefined
    // Never mirror a mirror. Two people holding one would volley a hit between
    // them until something gave, and what gave would be the server.
    if (reflecting) return undefined
    const hand = mirrorHand(victim, isMirror)
    if (!hand) return undefined
    return { hand, attacker, amount }
}

/** True while a reflected hit is being applied, so it cannot bounce back. */
let reflecting = false

export function duringReflection(fn) {
    reflecting = true
    try { return fn() } finally { reflecting = false }
}

export function isReflecting() { return reflecting }
