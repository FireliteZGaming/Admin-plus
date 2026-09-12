import { world, system, ItemStack, EnchantmentTypes } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff, canActOn, canTrollOn, primaryRank } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { record } from "../core/logs.js"
import { ChestForm, chestUIAvailable } from "../core/chestUI.js"
import { menu, pagedMenu, modal, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { isVanished } from "../core/vanish.js"
import { worldToken, makeBanHammer, HAMMER_NAME } from "../core/banhammer.js"
import { setting } from "../core/settings.js"
import { canNuke, nukeBlockedBy, orbitalStrike } from "../core/orbital.js"
import { trollAllowed } from "../core/trollgate.js"
import {
    TRIDENT_TAG, noteThrow, claimThrow, forgetThrows, beginStorm,
    installTridentEffects
} from "../core/trident.js"

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
    // The Orbital Strike rod. Look somewhere, use it once, and it is gone.
    //
    // A fishing rod because that is what the build this comes from used, and
    // the gesture is right: you cast it at something across the map rather than
    // standing on top of it. It breaks on use — one rod, one strike — which is
    // the only reason a thing this size can exist in an item slot at all.
    //
    // FOUR locks, checked here and again at use: the troll section, the
    // admin.troll node, operator-and-Dev, and `toggle nuke` at the console. See
    // core/orbital.js for why each one is a different kind of claim.
    orbital: {
        barSlot: 3,
        slot: 11,
        gate: p => canNuke(p),
        make: () => signItem("minecraft:fishing_rod", "§4§lOrbital Strike",
            "§7Aim at something far away and use it once."),
        name: "§4§lOrbital Strike",
        lines: ["§7Aim at something far away and use it once.",
                "§8It breaks on use. You get one."],
        typeId: "minecraft:fishing_rod"
    },
    hammer: {
        barSlot: 4,
        slot: 12,
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
        barSlot: 0,
        slot: 13,
        gate: p => has(p, "admin.tp"),
        make: () => signItem("minecraft:compass", "§b§lTeleport", "§7Use it to jump to a random player."),
        name: "§b§lTeleport",
        lines: ["§7Use it to jump to a random player."],
        typeId: "minecraft:compass"
    },
    // The Ender Eye: use it, pick somebody, be there.
    //
    // It exists because every other way to teleport needs a TARGET, and a
    // target means a selector — and a custom command's selector parameter is
    // expanded by the engine at a permission level these commands cannot have,
    // so `@p` and friends are refused before any of this pack's code runs.
    //
    // An item has no arguments to refuse. So the destination is CHOSEN FROM A
    // LIST instead of typed, which is not a consolation prize: the people using
    // this pack do not know selector syntax, and a menu of names they recognise
    // beats `@p` even where `@p` works. Looking somewhere and jumping there is
    // still in the menu, as its own entry.
    //
    // `/port` hands one over; so does /items.
    eye: {
        barSlot: 1,
        slot: 14,
        gate: p => has(p, "admin.tp"),
        make: () => signItem("minecraft:ender_eye", "§d§lEnder Eye",
            "§7Use it to pick who you jump to."),
        name: "§d§lEnder Eye",
        lines: ["§7Use it to pick who you jump to.", "§8Or a location, or whatever you are looking at."],
        typeId: "minecraft:ender_eye"
    },
    // The Spectral Trident. Throw it; red dust turns around it in the air, and
    // whatever it strikes wears a storm of it.
    //
    // A trident because a trident IS the item. An arrow is ammunition — the bow
    // picks a stack, consumes it, and spawns a generic arrow carrying none of
    // the name or lore, so you can neither tell which arrow was fired nor
    // choose which one goes. You throw the trident in your hand, so there is
    // nothing to pick and nothing to guess, and Loyalty proves the stack
    // survives the flight because returning that exact trident is what Loyalty
    // does.
    //
    // Loyalty III so it always comes back, and never Riptide — Riptide throws
    // YOU instead of the trident, which would leave the whole thing inert.
    trident: {
        barSlot: 5,
        slot: 15,
        gate: p => trollAllowed(p),
        make: () => loyalTrident(),
        name: "§c§lSpectral Trident",
        lines: ["§7Throw it. It comes back.",
                "§8Red dust swirls around whatever it hits."],
        typeId: "minecraft:trident"
    },
    knockback: {
        barSlot: 2,
        slot: 16,
        // A troll tool, and gated as one since 2.2.4. It used to answer to
        // admin.staffmode, which meant every staff member got it whatever the
        // ladder said and switching the troll section off did not take it away.
        gate: p => trollAllowed(p),
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

/**
 * A signed trident that always comes home.
 *
 * Loyalty is applied here rather than left to the holder, because the item's
 * whole promise is that you get it back — one without it is a trident you throw
 * off a cliff once. Level 3 is the fastest return vanilla offers.
 *
 * The enchantment is best-effort: if this runtime names loyalty differently the
 * trident is still a signed, working Spectral Trident that simply has to be
 * walked to. Losing the effect over a missing enchantment would be the worse
 * failure.
 */
function loyalTrident() {
    const stack = signItem("minecraft:trident", "§c§lSpectral Trident",
        "§7Throw it. It comes back.")
    safe(() => {
        const enchantable = stack.getComponent("minecraft:enchantable")
        const type = EnchantmentTypes.get("loyalty") ?? EnchantmentTypes.get("minecraft:loyalty")
        if (enchantable && type) enchantable.addEnchantment({ type, level: 3 })
    })
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
    // Deliberately NO perm of its own. It used to demand admin.staffmode, which
    // locked out a rank that holds only teleport — somebody entitled to the
    // compass and the eye could not reach the chest they were in. The ITEMS
    // decide instead: hold one and it opens, hold none and it refuses. One
    // question asked once, rather than a door and a cupboard with different
    // keys. (An operator passes every gate anyway — see has() in core/ranks.js.)
    run: (player) => {
        if (!chestUIAvailable()) {
            return err(player, "The item chest can't draw on this runtime.")
        }

        // Only the slots this person is allowed to take. An empty chest means
        // their rank grants none of them, which is worth saying rather than
        // showing a blank window.
        // Nothing allowed is a REFUSAL, not an empty cupboard. An empty chest
        // reads as "there are no items", which is a statement about the pack;
        // the true statement is about this rank.
        const offered = Object.entries(ITEMS).filter(([, def]) => def.gate(player))
        if (!offered.length) {
            return err(player, "You don't have permission to use any admin items. §7Ask an owner for a tool node under Settings ▸ Ranks ▸ Staff tools.")
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

// /port — the shortest route to the eye.
//
// It replaced the vanilla `tp` passthrough, which was registered under this
// name and could not take a selector for the reason above. Rather than leave a
// teleport command that refuses every target, `/port` hands over the thing that
// actually works. Somebody already holding one gets told so instead of
// collecting a second.
command({
    name: "port",
    description: "Get the Ender Eye — /port, then use it and pick where to go",
    perm: "admin.tp",
    run: (player) => {
        const container = safe(() => player.getComponent("minecraft:inventory")?.container)
        const held = container && safe(() => {
            for (let i = 0; i < container.size; i++) {
                if (itemKey(container.getItem(i)) === "eye") return true
            }
            return false
        }, false)
        if (held) {
            return info(player, `${ITEMS.eye.name}§7 is already in your inventory — use it.`)
        }
        give(player, "eye")
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
 * FULL SCALE since the 2.0.0 playtest. 4 was the cautious number; having felt
 * it in the world, the call was to stop being cautious. It reads from config
 * rather than a constant now, because "how hard is fun" is tuned by feel in the
 * world, not argued about in a source file.
 *
 * The old warning stands, and is why there is no ceiling in code: a big enough
 * number throws somebody into unloaded chunks and loses them. This is a knob you
 * are allowed to turn too far, and the help text says so.
 *
 * Three ways to apply it, tried in order, because the signature changed across
 * runtimes:
 *   * applyKnockback(VectorXZ, vertical)      the current shape
 *   * applyKnockback(x, z, horizontal, vertical)  the older four-argument one
 *   * applyImpulse(Vector3)                    the fallback that always exists
 */
const KB_FALLBACK = 12
const LIFT_FALLBACK = 1

/** A number from config, or the shipped one if somebody typed nonsense in. */
function tuning(key, fallback) {
    const value = Number(setting(key))
    return Number.isFinite(value) ? value : fallback
}

function knockback(attacker, victim) {
    const KB_STRENGTH = tuning("items.knockback", KB_FALLBACK)
    const KB_LIFT = tuning("items.knockbackLift", LIFT_FALLBACK)
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
            // gate now, not to when it was handed out. This is the SECOND place
            // it is asked, and the two must agree — fixing only the chest would
            // hand somebody an item that does nothing when they swing it.
            if (!trollAllowed(attacker)) return
            // canTrollOn, not canActOn: being knocked about by a peer is
            // banter, not a moderation decision. See core/ranks.js.
            if (!canTrollOn(attacker, victim)) return

            system.run(() => {
                if (knockback(attacker, victim)) {
                    record(attacker, "admin.knockback", victim, "knockback stick")
                }
            })
        })
    } else {
        console.warn("[Admin+] entityHitEntity unavailable — the Knockback stick will not fire")
    }

    // The Ender Eye goes on the BEFORE event, because a vanilla ender eye that
    // is merely handled is still thrown: it flies off toward a stronghold and
    // is gone. `cancel` is the only thing that stops that, and a cancelled
    // before-event means the AFTER event never fires — so the eye cannot be
    // handled in both places, and this is the one that has to win.
    //
    // Before-event handlers run in a read-only context, hence system.run for
    // everything that touches the world.
    const beforeUse = world.beforeEvents?.itemUse
    let eyeHandled = false
    if (beforeUse?.subscribe) {
        beforeUse.subscribe(event => {
            const player = event.source
            if (!player) return
            const key = itemKey(event.itemStack)
            // Neither of these may do what its vanilla self does: an ender eye
            // flies off toward a stronghold, a fishing rod throws a bobber.
            if (key !== "eye" && key !== "orbital") return
            event.cancel = true
            // Checked at USE time, not when it was handed over — an item that
            // outlives its holder's permission goes inert rather than becoming
            // a way round the ranks.
            system.run(() => {
                if (key === "orbital") return fireOrbital(player)
                if (has(player, "admin.tp")) openEye(player)
            })
        })
        eyeHandled = true
    } else {
        console.warn("[Admin+] beforeEvents.itemUse unavailable — the Ender Eye will be thrown when used")
    }

    // The Teleport compass, standalone (staff mode has its own; this one works
    // without entering it). The eye falls back to here only on a runtime with
    // no before event, where it will be thrown as well as answered — worse than
    // the real route, better than an item that does nothing.
    const use = world.afterEvents?.itemUse
    if (use?.subscribe) {
        use.subscribe(event => {
            const player = event.source
            if (!player) return
            const key = itemKey(event.itemStack)
            if (key === "orbital") { if (!eyeHandled) system.run(() => fireOrbital(player)); return }
            if (key !== "teleport" && (key !== "eye" || eyeHandled)) return
            if (!has(player, "admin.tp")) return
            system.run(() => key === "eye" ? openEye(player) : teleportToRandom(player))
        })
    }

    // ---------------------------------------------------------- the trident
    //
    // Three events, because a throw and its consequences are three separate
    // facts the engine never joins up for you:
    //
    //   release   the trident is still IN THEIR HAND, so this is the only
    //             moment its signature can be read at all
    //   spawn     the thrown entity appears, carrying nothing — tagged here,
    //             off the back of the release we just saw
    //   hit       the tag says it was ours, so the storm is ours to start
    const release = world.afterEvents?.itemReleaseUse
    if (release?.subscribe) {
        release.subscribe(event => {
            if (itemKey(event.itemStack) !== "trident") return
            if (!trollAllowed(event.source)) return
            noteThrow(event.source, system.currentTick ?? 0)
        })
    } else {
        console.warn("[Admin+] itemReleaseUse unavailable — the Spectral Trident will fly plain")
    }

    const spawned = world.afterEvents?.entitySpawn
    if (spawned?.subscribe) {
        spawned.subscribe(event => {
            const entity = event.entity
            if (entity?.typeId !== "minecraft:thrown_trident") return
            const thrower = claimThrow(entity, world.getAllPlayers(), system.currentTick ?? 0)
            if (!thrower) return
            safe(() => entity.addTag(TRIDENT_TAG))
        })
    }

    // Both hit events, because a trident that lands in the ground and one that
    // lands in somebody are the same throw. The storm follows a victim if there
    // is one and sits where it struck if there is not.
    for (const [name, victimOf] of [
        ["projectileHitEntity", event => safe(() => event.getEntityHit?.()?.entity)],
        ["projectileHitBlock", () => undefined]
    ]) {
        const hit = world.afterEvents?.[name]
        if (!hit?.subscribe) continue
        hit.subscribe(event => {
            const projectile = event.projectile
            if (projectile?.typeId !== "minecraft:thrown_trident") return
            if (!safe(() => projectile.hasTag(TRIDENT_TAG), false)) return
            const victim = victimOf(event)
            system.run(() => {
                if (victim) beginStorm(victim)
                else beginStorm({
                    location: event.location ?? projectile.location,
                    dimension: event.dimension ?? projectile.dimension,
                    isValid: false
                })
            })
        })
    }

    installTridentEffects()

    return true
}

// ------------------------------------------------------------ the eye

/**
 * Who this person may jump to.
 *
 * Vanished players are left out unless the holder is allowed to see vanish —
 * the same rule /vanished and the People screen follow. An eye that lists a
 * hidden moderator would give them away without their doing anything, and
 * teleporting to one would give them away twice.
 *
 * Rank does NOT filter this list. Going to somebody is not something you do TO
 * them, so `canActOn` is the wrong question; the Teleport compass has always
 * worked the same way.
 */
function jumpTargets(player) {
    const seesVanished = has(player, "admin.vanish")
    return world.getAllPlayers()
        .filter(other => other.id !== player.id)
        .filter(other => seesVanished || !isVanished(other))
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
}

/** How far away, in whole blocks, or which dimension if it is another one. */
function whereIs(player, other) {
    if (other.dimension?.id !== player.dimension?.id) {
        return `§8${String(other.dimension?.id ?? "").replace("minecraft:", "").replace(/_/g, " ")}`
    }
    const dx = other.location.x - player.location.x
    const dy = other.location.y - player.location.y
    const dz = other.location.z - player.location.z
    return `§8${Math.round(Math.hypot(dx, dy, dz))} blocks away`
}
/**
 * The eye, top level: two doors and a shortcut.
 *
 * Players and Location are the two real questions — who, or where. Looking is
 * kept beside them because it answers neither and needs no argument at all: it
 * is the only one that reaches a place nobody is standing and you cannot name.
 */
function openEye(player) {
    const others = jumpTargets(player)
    menu(player, {
        title: hubTitle("warps", "Ender Eye"),
        body: subtitle("Pick somebody, or a place."),
        buttons: [
            {
                text: others.length
                    ? `§bPlayers\n§8${others.length} online`
                    : "§8Players\n§8nobody else is online",
                run: () => others.length
                    ? eyePlayers(player, () => openEye(player))
                    : info(player, "§7Nobody else is online.")
            },
            {
                text: "§bLocation\n§8Type coordinates and go there",
                run: () => jumpToCoordinates(player, player, () => openEye(player))
            },
            {
                text: "§dWhere I'm looking\n§8Jump to the block in your crosshair",
                run: () => blinkToLook(player)
            }
        ]
    }).catch(e => console.warn(`[Admin+] Ender Eye form failed: ${e}`))
}

/** Everyone you could reach, one per row. */
function eyePlayers(player, back) {
    const targets = jumpTargets(player)
    return pagedMenu(player, {
        title: hubTitle("warps", "Players"),
        body: subtitle(`${targets.length} player${targets.length === 1 ? "" : "s"} online.`),
        items: targets,
        render: other => {
            const rank = primaryRank(other)
            const hidden = isVanished(other) ? " §8(vanished)" : ""
            return { text: `${rank ? rank.display + "§r " : ""}§a${displayName(other)}§r${hidden}\n${whereIs(player, other)}` }
        },
        onPick: other => eyePlayerActions(player, other, () => eyePlayers(player, back)),
        back
    })
}

/**
 * What you can do with one person.
 *
 * **Going to somebody is not something done TO them, so it needs no rank check.
 * Moving them is.** That is the split: the first entry is always there, the
 * other three appear only for somebody you outrank — shown greyed with the
 * reason rather than hidden, because a missing button reads as a broken menu
 * while a greyed one reads as a rule.
 *
 * `bring` was on this pack's dropped list — removed on purpose in an earlier
 * life, alongside homes and fly — and is back because it was asked for. The
 * audit log already had a phrase for it.
 */
function eyePlayerActions(player, target, back) {
    const name = displayName(target)
    const allowed = canActOn(player, target)
    const denied = () => err(player, `${name}§c outranks you.`)

    const act = (text, hint, run) => ({
        text: allowed ? `${text}\n§8${hint}` : `§8${text}\n§8outranks you`,
        run: allowed ? run : denied
    })

    return menu(player, {
        title: hubTitle("warps", name),
        body: subtitle(whereIs(player, target).replace(/^§8/, "")),
        buttons: [
            {
                text: `§aGo to\n§8Jump to ${name}`,
                run: () => jumpTo(player, target)
            },
            act("§eBring here", `Move ${name} to you`, () => bringHere(player, target)),
            act("§bTeleport", "Send them to coordinates",
                () => jumpToCoordinates(player, target, () => eyePlayerActions(player, target, back))),
            act("§dSwap places", `Trade positions with ${name}`, () => swapWith(player, target))
        ],
        back
    })
}

/** Re-read somebody from the world; the menu was drawn from a snapshot. */
function stillHere(player, target) {
    const live = world.getAllPlayers().find(p => p.id === target.id)
    if (!live) info(player, `§7${displayName(target)} left before you got there.`)
    return live
}

function bringHere(player, target) {
    const live = stillHere(player, target)
    if (!live) return
    if (!canActOn(player, live)) return err(player, `${displayName(live)}§c outranks you.`)
    try {
        live.teleport(player.location, { dimension: player.dimension })
        record(player, "mod.bring", live, "ender eye")
        info(player, `§7Brought §f${displayName(live)}§7 to you.`)
        info(live, `§7${displayName(player)}§7 brought you to them.`)
    } catch (e) {
        err(player, `Couldn't bring them: ${e}`)
    }
}

/**
 * Trade positions.
 *
 * Both ends are read BEFORE either moves. Teleporting one and then asking where
 * the other is would send the second to where the first no longer stands.
 */
function swapWith(player, target) {
    const live = stillHere(player, target)
    if (!live) return
    if (!canActOn(player, live)) return err(player, `${displayName(live)}§c outranks you.`)
    const mine = { ...player.location }
    const theirs = { ...live.location }
    const myDim = player.dimension
    const theirDim = live.dimension
    try {
        player.teleport(theirs, { dimension: theirDim })
        live.teleport(mine, { dimension: myDim })
        record(player, "mod.bring", live, "ender eye · swap")
        info(player, `§7Swapped places with §f${displayName(live)}§7.`)
        info(live, `§7${displayName(player)}§7 swapped places with you.`)
    } catch (e) {
        err(player, `Couldn't swap: ${e}`)
    }
}

/**
 * The three worlds, and how tall each one is.
 *
 * The heights are here because picking a dimension makes Y dangerous in a way
 * it never was before. Every other teleport in this pack stays where you
 * already are, so the height you type is always a height that exists. Choose
 * the Nether with `~` still in the Y box while standing at 200 in the Overworld
 * and you arrive inside the bedrock roof, which is not somewhere you walk out
 * of. So the range is checked and named before anything moves.
 *
 * Read from the engine where it will say — `heightRange` is the authority and
 * the Overworld's floor has moved once already — and falling back to these,
 * which is what every version since 1.18 uses.
 */
const WORLDS = [
    { id: "minecraft:overworld", label: "Overworld", min: -64, max: 320 },
    { id: "minecraft:nether", label: "Nether", min: 0, max: 128 },
    { id: "minecraft:the_end", label: "The End", min: 0, max: 256 }
]

/** Their names, in the order the dropdown shows them. */
export function worldLabels() { return WORLDS.map(w => w.label) }

/** Which entry a dimension id is, or 0 — the Overworld — when it is unknown. */
export function worldIndex(dimensionId) {
    const at = WORLDS.findIndex(w => w.id === String(dimensionId ?? ""))
    return at === -1 ? 0 : at
}

/** How tall that world is, asking the engine first. */
export function worldHeight(index) {
    const world_ = WORLDS[index] ?? WORLDS[0]
    const live = safe(() => {
        const range = world.getDimension(world_.id)?.heightRange
        return Number.isFinite(range?.min) && Number.isFinite(range?.max)
            ? { min: range.min, max: range.max }
            : undefined
    })
    return { ...world_, ...(live ?? {}) }
}

/**
 * Is this a height you can stand at in that world?
 *
 * The top of the range is where blocks stop, so it is not a place to be — hence
 * `<`, not `<=`. Returns the complaint, or undefined when it is fine.
 */
export function heightProblem(y, index) {
    const w = worldHeight(index)
    if (y >= w.min && y < w.max) return undefined
    return `§f${w.label}§c only goes from §f${w.min}§c to §f${w.max - 1}§c — §f${Math.round(y)}§c is outside it.`
}

/**
 * One coordinate field, read with vanilla's own grammar.
 *
 * `~` is where you already are, `~10` is ten further along, and a bare number
 * is absolute — the same rule the game uses everywhere else, so anybody who has
 * typed a /tp before does not have to learn a second one. Anything else comes
 * back undefined and is REFUSED by name, rather than quietly becoming 0: a
 * typo'd Y that reads as zero drops you into bedrock.
 */
function coordinate(text, origin) {
    const raw = String(text ?? "").trim()
    if (!raw) return undefined
    if (raw === "~") return origin
    if (raw.startsWith("~")) {
        const offset = Number(raw.slice(1))
        return Number.isFinite(offset) ? origin + offset : undefined
    }
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
}

// The world border. Past it a teleport does nothing at all, so it is better to
// say so than to press the button and appear not to have moved.
const FAR = 30000000
/**
 * Type a place, and send somebody to it.
 *
 * `subject` is who MOVES — yourself from the Location door, or the player you
 * picked from Players ▸ Teleport. The form is identical either way, which is
 * the point: one coordinate box, one set of refusals, one place to get the
 * height rule right.
 *
 * It opens on the SUBJECT's position, not yours. Sending somebody ten blocks up
 * means ten above where THEY stand, and a box pre-filled with your coordinates
 * would quietly mean somewhere else entirely.
 *
 * The world first, then where in it, because that is the order the question
 * gets asked in.
 */
async function jumpToCoordinates(player, subject = player, back) {
    const moving = subject ?? player
    const self = moving.id === player.id
    const here = moving.location
    const from = worldIndex(moving.dimension?.id)
    const round = n => String(Math.round(n))
    const who = displayName(moving)

    const answer = await modal(player,
        hubTitle("warps", self ? "Jump to a location" : `Send ${who}`), [
        { id: "world", type: "dropdown", label: "§7World", options: worldLabels(), default: from },
        { id: "x", type: "text", label: "§7X", placeholder: "~", default: round(here.x) },
        { id: "y", type: "text", label: "§7Y  §8(height)", placeholder: "~", default: round(here.y) },
        { id: "z", type: "text", label: "§7Z", placeholder: "~", default: round(here.z) }
    ])
    if (!answer) return back ? back() : undefined

    const x = coordinate(answer.x, here.x)
    const y = coordinate(answer.y, here.y)
    const z = coordinate(answer.z, here.z)
    const bad = [["X", x], ["Y", y], ["Z", z]].filter(pair => pair[1] === undefined).map(pair => pair[0])
    if (bad.length) {
        return err(player, `${bad.join(" and ")} ${bad.length > 1 ? "are not numbers" : "is not a number"}. Type a number, or §f~§c for where ${self ? "you are" : "they are"} now.`)
    }
    if (Math.abs(x) > FAR || Math.abs(z) > FAR) {
        return err(player, "That is outside the world — X and Z stop at 30 million.")
    }

    // Picking a world is what makes the height dangerous. `~` in the Y box means
    // where they are NOW, and 200 in the Overworld is inside the Nether's
    // bedrock roof — somewhere you do not walk out of. Named and refused, never
    // clamped: silently moving somebody 73 blocks from where they asked is worse
    // than telling them the number was wrong.
    const to = Number(answer.world) || 0
    const wrongHeight = heightProblem(y, to)
    if (wrongHeight) return err(player, wrongHeight)

    const world_ = worldHeight(to)
    const dimension = safe(() => world.getDimension(world_.id))
    if (!dimension) return err(player, `Couldn't reach the §f${world_.label}§c.`)

    // Re-checked here, not only when the menu was drawn: the form was open for
    // as long as they took to type, and a rank can change in that time.
    if (!self && !canActOn(player, moving)) return err(player, `${who}§c outranks you.`)
    const live = self ? player : stillHere(player, moving)
    if (!live) return

    try {
        live.teleport({ x, y, z }, {
            dimension,
            rotation: safe(() => live.getRotation(), undefined),
            keepVelocity: false
        })
        const where = `${Math.round(x)} ${Math.round(y)} ${Math.round(z)}`
        const place = to === from ? where : `${where} in the ${world_.label}`
        record(player, self ? "mod.tpTo" : "mod.bring", live, `ender eye · ${world_.label} ${where}`)
        info(player, self ? `§7Jumped to §f${place}§7.` : `§7Sent §f${who}§7 to §f${place}§7.`)
        if (!self) info(live, `§7${displayName(player)}§7 sent you to §f${place}§7.`)
    } catch (e) {
        err(player, `Couldn't ${self ? "jump" : "send them"} there: ${e}`)
    }
}

/**
 * Take one of these out of their hand.
 *
 * By slot rather than by `container.removeItem`, because what must be consumed
 * is the ONE they just used — a staff member holding two should be left holding
 * one, and clearing by type would take both.
 */
function consumeHeld(player) {
    const container = safe(() => player.getComponent("minecraft:inventory")?.container)
    if (!container) return false
    const slot = player.selectedSlotIndex ?? 0
    const held = safe(() => container.getItem(slot))
    if (!held) return false
    if (held.amount > 1) {
        held.amount -= 1
        return safe(() => { container.setItem(slot, held); return true }, false)
    }
    return safe(() => { container.setItem(slot, undefined); return true }, false)
}

/**
 * Fire the rod: it breaks, then the sky answers.
 *
 * The gate is re-read here and not trusted from when the rod was handed over.
 * An owner who turns the troll section off, or disarms it at the console, has
 * disarmed every rod already in an inventory — which is what a switch has to
 * mean, or it is decoration.
 */
function fireOrbital(player) {
    const shut = nukeBlockedBy(player)
    if (shut) return err(player, `That won't fire — ${shut}§c.`)

    if (!consumeHeld(player)) return err(player, "Couldn't reach the rod in your hand.")
    safe(() => player.dimension.playSound("random.break", player.location))

    if (!orbitalStrike(player)) return err(player, "Couldn't call that in.")
    record(player, "admin.orbital", player, "orbital strike")
    info(player, "§7It's on its way. §8You may want to not be there.")
}

function jumpTo(player, target) {
    // Re-read them: the menu was drawn from a snapshot and they may have left
    // while it was open, which would otherwise throw on a stale handle.
    const live = world.getAllPlayers().find(p => p.id === target.id)
    if (!live) return info(player, `§7${displayName(target)} left before you got there.`)
    try {
        player.teleport(live.location, { dimension: live.dimension })
        record(player, "mod.tpTo", live, "ender eye")
        info(player, `§7Jumped to §f${displayName(live)}§7.`)
    } catch (e) {
        err(player, `Couldn't jump there: ${e}`)
    }
}

/**
 * Put them on top of whatever they are looking at.
 *
 * One entry in the eye's menu rather than the whole item. It is the form that
 * needs no target at all, which is why it earns a place beside the names: the
 * roof you want is often not where anybody is standing.
 *
 * Lands on the block's UPPER face rather than where the ray struck, which is
 * what makes it safe: the space above a solid block is the one place you can
 * always be certain is not inside one. Looking at a wall puts you on the wall
 * rather than embedded in it — slightly surprising once, never suffocating.
 *
 * Liquids and passable blocks are skipped, so looking across water lands you on
 * the far bank instead of dropping you in it, and a ray through tall grass does
 * not stop at the grass.
 *
 * Rotation is kept. Teleporting somebody and spinning them round is
 * disorienting, and the whole point is that they are already facing the thing
 * they wanted to reach.
 */
function blinkToLook(player) {
    const range = Number(setting("items.eyeRange"))
    const maxDistance = Number.isFinite(range) && range > 0 ? range : 160

    const hit = safe(() => player.getBlockFromViewDirection({
        maxDistance,
        includeLiquidBlocks: false,
        includePassableBlocks: false
    }))
    if (!hit?.block) {
        return info(player, `§7Nothing solid within §f${maxDistance}§7 blocks that way.`)
    }

    const at = hit.block.location
    const destination = { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 }
    try {
        player.teleport(destination, {
            dimension: player.dimension,
            rotation: safe(() => player.getRotation(), undefined),
            keepVelocity: false
        })
        record(player, "mod.tpTo", player, `ender eye · ${Math.round(at.x)} ${Math.round(at.y)} ${Math.round(at.z)}`)
    } catch (e) {
        err(player, `Couldn't jump there: ${e}`)
    }
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

export { ITEMS, signItem, itemKey, knockback, coordinate, SIGIL }
