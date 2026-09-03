import { ItemStack, EnchantmentTypes } from "@minecraft/server"
import { Table } from "./storage.js"

// The Ban Hammer.
//
// A real vanilla mace — not a custom item — so it swings, smashes and feels
// exactly like the mace does, because it IS one. What makes it the Ban Hammer
// is data a player cannot put on a mace themselves.
//
// The forgery problem, and why lore is the answer: a player can rename anything
// on an anvil, so the name alone proves nothing — anyone could type "§4Ban
// §5Hammer" into an anvil and go hunting. Bedrock gives players no way to set
// LORE, at all. So the lore line is the signature. It also carries a per-world
// serial, which means a hammer issued on one world is inert on another, and a
// hammer built by hand — even by someone who knows the format — is inert unless
// they guessed this world's number.
//
// Curse of Vanishing does two jobs: it is what makes the hammer shimmer (a
// vanilla item can only glint if it genuinely holds an enchantment), and it
// means the hammer cannot be looted off a dev who dies holding it.

export const HAMMER_ITEM = "minecraft:mace"
export const HAMMER_NAME = "§4Ban §5Hammer"

const meta = new Table("banhammer", {})

function safe(fn, fallback) {
    try {
        const value = fn()
        return value === undefined ? fallback : value
    } catch { return fallback }
}

/**
 * This world's serial, made once and kept.
 *
 * Not called while modules evaluate — that context is read-only and the first
 * call writes. installBanHammer seeds it on the first tick instead.
 */
export function worldToken() {
    let token = meta.get("token")
    if (!token) {
        token = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
        meta.set("token", token)
    }
    return token
}

/** The signature line, which doubles as something readable in the tooltip. */
export function loreFor() {
    return [
        `§8Issued by Admin+ · #${worldToken()}`,
        "§8Only this one works. A renamed mace is just a mace."
    ]
}

/** Is this stack the genuine article? */
export function isBanHammer(stack) {
    if (!stack || stack.typeId !== HAMMER_ITEM) return false
    if (stack.nameTag !== HAMMER_NAME) return false
    const lore = safe(() => stack.getLore(), []) ?? []
    return lore.some(line => String(line).includes(`#${worldToken()}`))
}

/** Mint one. */
export function makeBanHammer() {
    const stack = new ItemStack(HAMMER_ITEM, 1)
    stack.nameTag = HAMMER_NAME
    stack.setLore(loreFor())

    // The shimmer. If the enchantment cannot be applied on this runtime the
    // hammer still works — it just looks like an ordinary named mace, which is
    // a cosmetic loss, not a broken one.
    safe(() => {
        const enchantable = stack.getComponent("minecraft:enchantable")
        const type = EnchantmentTypes.get("vanishing") ?? EnchantmentTypes.get("minecraft:vanishing")
        if (enchantable && type) enchantable.addEnchantment({ type, level: 1 })
    })

    return stack
}
