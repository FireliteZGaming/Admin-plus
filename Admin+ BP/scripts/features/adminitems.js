import { world, system, ItemStack } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff, canActOn } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable } from "../core/chestUI.js"
import { worldToken, makeBanHammer, HAMMER_NAME } from "../core/banhammer.js"

// /items — grab an admin item without vanishing or opening /admin.
//
// It opens the same chest-grid window /invsee uses, but as a PICKER: click a
// slot and that item lands in your inventory. It is the à-la-carte version of
// the /mm bar — the Ban Hammer, a Teleport compass and a Knockback stick,
// available one at a time without entering staff mode.
//
// The items are signed the way the Ban Hammer is: a per-world serial in the
// lore, which players cannot write. A compass renamed on an anvil is inert.
// The sigil differs from the staff-mode tools' ("Admin+ staff tool") so the two
// never trigger each other's handlers — a /mm compass and an /items compass are
// distinct items with distinct code paths, even though both teleport.

const SIGIL = "§8Admin+ item"

/**
 * The catalogue. `gate` decides who SEES the slot in the chest and, checked
 * again at use time, whether it does anything — the same belt-and-braces the
 * Ban Hammer uses, so an item that outlives its holder's permission is inert
 * rather than a backdoor.
 */
const ITEMS = {
    hammer: {
        slot: 11,
        // The Ban Hammer is minted by core/banhammer.js and caught by its own
        // global handler; /items only hands it over. Only for people allowed to
        // ban permanently, exactly as in the /mm bar.
        gate: p => has(p, "admin.banperm"),
        make: () => makeBanHammer(),
        name: HAMMER_NAME,
        lines: ["§7Swing it at somebody to ban them."],
        typeId: "minecraft:mace"
    },
    teleport: {
        slot: 13,
        gate: p => has(p, "admin.tp"),
        make: () => signItem("minecraft:compass", "§b§lTeleport", "§7Use it to jump to a random player."),
        name: "§b§lTeleport",
        lines: ["§7Use it to jump to a random player."],
        typeId: "minecraft:compass"
    },
    knockback: {
        slot: 15,
        gate: p => has(p, "admin.staffmode"),
        make: () => signItem("minecraft:stick", "§c§lKnockback", "§7Hit somebody to send them flying."),
        name: "§c§lKnockback",
        lines: ["§7Hit somebody to send them flying."],
        typeId: "minecraft:stick"
    }
}

function safe(fn, fallback) {
    try { const v = fn(); return v === undefined ? fallback : v } catch { return fallback }
}

/** Mint a signed item — a vanilla item plus the lore signature. */
function signItem(typeId, name, blurb) {
    const stack = new ItemStack(typeId, 1)
    stack.nameTag = name
    stack.setLore([blurb, `${SIGIL} · #${worldToken()}`])
    return stack
}

/** Is this the /items version of one of ours, and which key? */
function itemKey(stack) {
    if (!stack?.typeId) return undefined
    let lore = []
    try { lore = stack.getLore() ?? [] } catch { return undefined }
    if (!lore.some(line => String(line).includes(`${SIGIL} · #${worldToken()}`))) return undefined
    for (const [key, def] of Object.entries(ITEMS)) {
        if (def.typeId === stack.typeId && def.name === stack.nameTag) return key
    }
    return undefined
}

function mainhandOf(player) {
    return safe(() => player.getComponent("minecraft:inventory")?.container
        ?.getItem(player.selectedSlotIndex ?? 0))
}

// ------------------------------------------------------------ the picker

command({
    name: "items",
    description: "Open the admin item chest — /items",
    perm: "admin.staffmode",
    run: (player) => {
        if (!chestUIAvailable()) {
            return err(player, "The item chest can't draw on this runtime.")
        }

        // Only the slots this person is allowed to take. An empty chest means
        // their rank grants none of them, which is worth saying rather than
        // showing a blank window.
        const offered = Object.entries(ITEMS).filter(([, def]) => def.gate(player))
        if (!offered.length) {
            return info(player, "§7There are no admin items your rank can take.")
        }

        const chest = new ChestForm("large").title("Admin items")
        // selection index -> item key. ActionFormData hands back the button
        // INDEX, and ChestForm lays buttons out one per slot in order, so the
        // index is the slot number.
        const bySlot = new Map()
        for (const [key, def] of offered) {
            chest.button(def.slot, def.name, def.lines, def.typeId)
            bySlot.set(def.slot, key)
        }

        chest.show(player).then(res => {
            if (res.canceled || typeof res.selection !== "number") return
            const key = bySlot.get(res.selection)
            if (!key) return
            give(player, key)
        }).catch(e => console.warn(`[Admin+] /items form failed: ${e}`))
    }
})

function give(player, key) {
    const def = ITEMS[key]
    if (!def || !def.gate(player)) return err(player, "You can't take that one.")

    const container = safe(() => player.getComponent("minecraft:inventory")?.container)
    if (!container) return err(player, "Couldn't reach your inventory.")

    let leftover
    try { leftover = container.addItem(def.make()) }
    catch (e) { return err(player, `Couldn't make that item: ${e}`) }
    if (leftover) return err(player, "Your inventory is full.")

    record(player, "admin.items", player, key)
    ok(player, `${def.name}§a is in your inventory.`)
}

// ------------------------------------------------------------ the knockback

/**
 * Send a player flying the way the attacker is facing.
 *
 * "Infinite" would throw them into unloaded chunks and lose them, so this is
 * "very strong" instead — dramatic, recoverable. Three ways to apply it, tried
 * in order, because the signature changed across runtimes:
 *   * applyKnockback(VectorXZ, vertical)      the current shape
 *   * applyKnockback(x, z, horizontal, vertical)  the older four-argument one
 *   * applyImpulse(Vector3)                    the fallback that always exists
 */
const KB_STRENGTH = 4
const KB_LIFT = 0.7

function knockback(attacker, victim) {
    const dir = safe(() => attacker.getViewDirection(), { x: 0, y: 0, z: 0 })
    let x = dir.x ?? 0, z = dir.z ?? 0
    const len = Math.hypot(x, z) || 1
    x /= len; z /= len

    if (safe(() => { victim.applyKnockback({ x: x * KB_STRENGTH, z: z * KB_STRENGTH }, KB_LIFT); return true }, false)) return true
    if (safe(() => { victim.applyKnockback(x, z, KB_STRENGTH, KB_LIFT); return true }, false)) return true
    return safe(() => { victim.applyImpulse({ x: x * KB_STRENGTH, y: KB_LIFT, z: z * KB_STRENGTH }); return true }, false)
}

export function installAdminItems() {
    // Seed the world serial, same as the Ban Hammer does — worldToken() writes,
    // and module evaluation is read-only.
    system.run(() => { try { worldToken() } catch { /* seeded on first use */ } })

    const hit = world.afterEvents?.entityHitEntity
    if (hit?.subscribe) {
        hit.subscribe(event => {
            const attacker = event.damagingEntity
            const victim = event.hitEntity
            if (!attacker || !victim || victim.typeId !== "minecraft:player") return
            if (attacker.id === victim.id) return
            if (itemKey(mainhandOf(attacker)) !== "knockback") return

            // Checked at swing time, like the hammer: the stick answers to the
            // node now, not to when it was handed out.
            if (!has(attacker, "admin.staffmode")) return
            if (!canActOn(attacker, victim)) return

            system.run(() => {
                if (knockback(attacker, victim)) {
                    record(attacker, "admin.knockback", victim, "knockback stick")
                }
            })
        })
    } else {
        console.warn("[Admin+] entityHitEntity unavailable — the Knockback stick will not fire")
    }

    // The Teleport compass, standalone (staff mode has its own; this one works
    // without entering it).
    const use = world.afterEvents?.itemUse
    if (use?.subscribe) {
        use.subscribe(event => {
            const player = event.source
            if (!player) return
            if (itemKey(event.itemStack) !== "teleport") return
            if (!has(player, "admin.tp")) return
            system.run(() => teleportToRandom(player))
        })
    }

    return true
}

function teleportToRandom(player) {
    const candidates = world.getAllPlayers().filter(o => o.id !== player.id && !isStaff(o))
    if (!candidates.length) return info(player, "§7Nobody to jump to.")
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    try {
        player.teleport(target.location, { dimension: target.dimension })
        info(player, `§7Jumped to §f${displayName(target)}§7.`)
    } catch (e) {
        err(player, `Couldn't teleport: ${e}`)
    }
}

export { ITEMS, signItem, itemKey, knockback, SIGIL }
