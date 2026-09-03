import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, pagedMenu, modal, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has, isStaff } from "../core/ranks.js"
import { flag, setting, setSetting } from "../core/settings.js"
import {
    allWarps, getWarp, saveWarp, deleteWarp, normaliseWarpId,
    warpsFor, canUseWarp, accessLabel, rankOptions,
    getSpawn, setSpawn, teleportTo
} from "../core/warps.js"
import { queueTeleport } from "../core/teleport.js"
import { record } from "../core/logs.js"

// Warps — /warp, /warps, /spawn for everyone; everything else on one screen per
// destination.
//
// Spawn is listed as a destination like any other, because it behaves like one.
// Tapping any of them is where all of it lives: go there, move it, or Edit for
// the settings that need typing or choosing.
//
// A warp you cannot use is invisible: absent from lists, and naming it directly
// says "no such warp". Saying "no permission" would confirm it exists, which
// hands out the staff network to anyone who guesses a name.

// ------------------------------------------------------------------ commands

command({
    name: "warp",
    description: "Teleport to a warp — /warp <name>",
    perm: "warp.use",
    mandatory: [{ name: "name", type: CustomCommandParamType.String }],
    run: (player, [name]) => {
        if (!flag("feature.warps")) return err(player, "Warps are turned off on this server.")
        const warp = getWarp(normaliseWarpId(name))
        if (!warp || !canUseWarp(player, warp)) {
            return err(player, `No warp called "§f${name}§c".`)
        }
        queueTeleport(player, warp.display, () => {
            if (teleportTo(player, warp)) ok(player, `Warped to §f${warp.display}§a.`)
            else err(player, "That warp points at a dimension that isn't loaded.")
        })
    }
})

command({
    name: "warps",
    description: "List the warps you can use",
    perm: "warp.use",
    run: (player) => {
        if (!flag("feature.warps")) return err(player, "Warps are turned off on this server.")
        return warpListScreen(player)
    }
})

command({
    name: "spawn",
    description: "Teleport to spawn",
    perm: "spawn.use",
    run: (player) => {
        if (!flag("feature.spawn")) return err(player, "Spawn is turned off on this server.")
        const point = getSpawn()
        if (!point) return err(player, "Spawn hasn't been set. Staff can set it in /admin ▸ Warps.")
        queueTeleport(player, "spawn", () => {
            if (teleportTo(player, point)) ok(player, "Welcome to spawn.")
            else err(player, "Spawn points at a dimension that isn't loaded.")
        })
    }
})

/** The player-facing warp picker. */
export async function warpListScreen(player, back) {
    const usable = warpsFor(player)
    if (!usable.length) {
        info(player, "There are no warps you can use yet.")
        return back ? back() : undefined
    }
    return pagedMenu(player, {
        title: hubTitle("warps", "Warps"),
        body: subtitle(`${usable.length} warp${usable.length === 1 ? "" : "s"} available.`),
        items: usable,
        render: warp => ({ text: warp.display }),
        onPick: warp => queueTeleport(player, warp.display, () => {
            if (teleportTo(player, warp)) ok(player, `Warped to §f${warp.display}§a.`)
            else err(player, "That warp points at a dimension that isn't loaded.")
        }),
        back
    })
}

// ----------------------------------------------------------------- the panel

export async function warpsScreen(player, back) {
    const manage = has(player, "warp.manage")
    const rows = [
        ...(flag("feature.spawn") ? [{ spawn: true, id: "spawn" }] : []),
        ...(manage ? allWarps() : warpsFor(player))
    ]

    return pagedMenu(player, {
        title: hubTitle("warps", "Warps"),
        body: subtitle(manage
            ? "Every destination. Tap one to go, move or edit it."
            : "Tap a warp to travel."),
        items: rows,
        render: row => row.spawn
            ? { text: spawnRow() }
            : { text: `${row.display}§r\n§8${accessLabel(row)}` },
        onPick: row => row.spawn
            ? spawnScreen(player, () => warpsScreen(player, back))
            : warpScreen(player, row.id, () => warpsScreen(player, back)),
        extra: manage
            ? [{ text: hubEntry("presets", "+ Create warp here", "Uses your current position"), run: () => createScreen(player, () => warpsScreen(player, back)) }]
            : [],
        back
    })
}

function spawnRow() {
    if (!getSpawn()) return "§eSpawn§r\n§8not set yet"
    const guard = flag("spawn.protect") ? `protected ${setting("spawn.radius")} blocks` : "unprotected"
    return `§eSpawn§r\n§8set · ${guard}`
}

/** Spawn behaves like a warp, so it gets the same kind of screen. */
async function spawnScreen(player, back) {
    const point = getSpawn()
    const manage = has(player, "spawn.set")
    const again = () => spawnScreen(player, back)

    return menu(player, {
        title: hubTitle("warps", "Spawn"),
        body: [
            point
                ? subtitle(`${Math.round(point.x)}, ${Math.round(point.y)}, ${Math.round(point.z)} in ${String(point.dimension).replace("minecraft:", "").replace(/_/g, " ")}`)
                : "§cNo spawn set yet.",
            "",
            `§fProtection: §r${flag("spawn.protect") ? `§aon §8· ${setting("spawn.radius")} blocks` : "§8off"}`,
            flag("spawn.protect") ? "§8No building and no PvP in range, staff excepted." : ""
        ].join("\n"),
        buttons: [
            point
                ? {
                    text: "§bGo there",
                    run: () => {
                        queueTeleport(player, "spawn", () => {
                            teleportTo(player, point)
                            ok(player, "Welcome to spawn.")
                        })
                        return again()
                    }
                }
                : null,
            manage ? { text: "§bMove spawn here", run: () => setSpawnScreen(player, again) } : null,
            manage ? { text: "§bEdit §8· protection and radius", run: () => spawnEditScreen(player, again) } : null
        ].filter(Boolean),
        back
    })
}

async function spawnEditScreen(player, back) {
    const values = await modal(player, hubTitle("warps", "Edit spawn"), [
        {
            id: "protect",
            type: "toggle",
            label: "Spawn protection\n§8No terrain damage and no PvP in range, staff excepted",
            default: flag("spawn.protect")
        },
        {
            id: "radius",
            type: "text",
            label: "Protection radius in blocks\n§8Whole number, measured out from the spawn point",
            default: String(setting("spawn.radius"))
        }
    ])
    if (!values) return back()

    const radius = Number(String(values.radius).trim())
    if (!Number.isFinite(radius) || radius < 0) {
        err(player, `"§f${values.radius}§c" isn't a number of blocks.`)
        return back()
    }

    setSetting("spawn.protect", values.protect ? "true" : "false")
    setSetting("spawn.radius", String(Math.round(radius)))
    record(player, "warp.spawnEdit", undefined,
        `protection ${values.protect ? "on" : "off"} · ${Math.round(radius)} blocks`)

    ok(player, values.protect
        ? `Spawn protected for §f${Math.round(radius)}§a blocks — no building, no PvP.`
        : "Spawn protection off.")
    if (values.protect && !getSpawn()) {
        info(player, "§7Protection does nothing until spawn is set.")
    }
    return back()
}

async function setSpawnScreen(player, back) {
    if (getSpawn()) {
        const yes = await confirm(player, hubTitle("warps", "Move spawn"),
            "Move spawn to where you are standing?\n\n§7The old spawn point is replaced.", "§aMove spawn")
        if (!yes) return back()
    }
    setSpawn(player)
    record(player, "warp.spawnSet", undefined, "moved to the setter's position")
    ok(player, "Spawn set to your position.")
    return back()
}

async function createScreen(player, back) {
    const values = await modal(player, hubTitle("warps", "Create warp"), [
        { id: "id", type: "text", label: "Warp id §8· lowercase, no spaces. This is what people type.", placeholder: "market" },
        { id: "display", type: "text", label: "Display §8· shown in the list, §§ codes allowed", placeholder: "§aMarket" }
    ])
    if (!values) return back()

    const id = normaliseWarpId(values.id)
    if (!id) { err(player, "That warp id isn't usable."); return back() }
    if (getWarp(id)) { err(player, `A warp called §f${id}§c already exists.`); return back() }

    const warp = saveWarp(id, { display: values.display || id }, player)
    record(player, "warp.create", undefined, warp.id)
    ok(player, `Created §f${warp.display}§a where you're standing. Everyone can use it until you gate it.`)
    return warpScreen(player, id, back)
}

async function warpScreen(player, warpId, back) {
    const warp = getWarp(warpId)
    if (!warp) { err(player, "That warp is gone."); return back() }
    const again = () => warpScreen(player, warpId, back)
    const manage = has(player, "warp.manage")

    return menu(player, {
        title: hubTitle("warps", warp.id),
        body: [
            `${warp.display}§r`,
            subtitle(`${Math.round(warp.x)}, ${Math.round(warp.y)}, ${Math.round(warp.z)} in ${warp.dimension.replace("minecraft:", "").replace(/_/g, " ")}`),
            "",
            `§fWho can use it: §r${accessLabel(warp)}`
        ].join("\n"),
        buttons: [
            {
                text: "§bGo there",
                run: () => {
                    queueTeleport(player, warp.display, () => {
                        teleportTo(player, warp)
                        ok(player, `Warped to §f${warp.display}§a.`)
                    })
                    return again()
                }
            },
            manage ? { text: "§bMove warp here §8· re-anchor to where you stand", run: () => moveScreen(player, warpId, again) } : null,
            manage ? { text: "§bEdit §8· name, access, delete", run: () => editScreen(player, warpId, again, back) } : null
        ].filter(Boolean),
        back
    })
}

/** Everything about a warp that needs typing or choosing, on one screen. */
async function editScreen(player, warpId, back, parentBack) {
    const warp = getWarp(warpId)
    if (!warp) { err(player, "That warp is gone."); return parentBack() }
    const again = () => editScreen(player, warpId, back, parentBack)

    return menu(player, {
        title: hubTitle("warps", `Edit · ${warp.id}`),
        body: subtitle("Renaming changes the label, never the id people type."),
        buttons: [
            { text: `§bDisplay name\n§8${warp.display}`, run: () => renameScreen(player, warpId, again) },
            { text: `§bAccess\n§8${accessLabel(warp)}`, run: () => accessScreen(player, warpId, again) },
            { text: "§cDelete warp", run: () => deleteScreen(player, warpId, parentBack) }
        ],
        back
    })
}

async function moveScreen(player, warpId, back) {
    const warp = getWarp(warpId)
    const yes = await confirm(player, hubTitle("warps", "Move warp"),
        `Move §f${warp.display}§r to where you are standing?\n\n§7Old spot: ${Math.round(warp.x)}, ${Math.round(warp.y)}, ${Math.round(warp.z)}`,
        "§aMove it")
    if (!yes) return back()
    saveWarp(warpId, { x: undefined, y: undefined, z: undefined, dimension: undefined }, player)
    record(player, "warp.move", undefined, warpId)
    ok(player, "Warp moved to your position.")
    return back()
}

async function renameScreen(player, warpId, back) {
    const warp = getWarp(warpId)
    const values = await modal(player, hubTitle("warps", `Rename · ${warpId}`), [
        { id: "display", type: "text", label: "Display §8· the id people type does not change", default: warp.display }
    ])
    if (!values) return back()
    saveWarp(warpId, { display: values.display || warp.id })
    ok(player, "Renamed.")
    return back()
}

async function accessScreen(player, warpId, back) {
    const warp = getWarp(warpId)
    return menu(player, {
        title: hubTitle("warps", `Access · ${warpId}`),
        body: [
            subtitle("A warp someone cannot use is invisible to them —"),
            "§8it stays out of their list, and naming it says \"no such warp\".",
            "",
            `§fCurrently: §r${accessLabel(warp)}`
        ].join("\n"),
        buttons: [
            {
                text: "§aEveryone",
                run: () => {
                    saveWarp(warpId, { access: "all", rank: undefined })
                    record(player, "warp.access", undefined, `${warpId}: everyone`)
                    ok(player, "Open to everyone.")
                    return back()
                }
            },
            {
                text: "§6Staff only",
                run: () => {
                    saveWarp(warpId, { access: "staff", rank: undefined })
                    record(player, "warp.access", undefined, `${warpId}: staff`)
                    ok(player, "Staff only.")
                    return back()
                }
            },
            { text: "§bA rank and above", run: () => rankAccessScreen(player, warpId, back) }
        ],
        back
    })
}

async function rankAccessScreen(player, warpId, back) {
    return pagedMenu(player, {
        title: hubTitle("warps", "Rank required"),
        body: subtitle("Anyone at this ladder row or above can use the warp."),
        items: rankOptions(),
        render: rank => ({ text: `${rank.display}§r §8and above` }),
        onPick: rank => {
            saveWarp(warpId, { access: "rank", rank: rank.id })
            record(player, "warp.access", undefined, `${warpId}: ${rank.id} and above`)
            ok(player, `Now ${rank.display}§a and above.`)
            return back()
        },
        back
    })
}

async function deleteScreen(player, warpId, back) {
    const warp = getWarp(warpId)
    const yes = await confirm(player, hubTitle("warps", "Delete warp"),
        `Delete §f${warp.display}§r?\n\n§7This cannot be undone.`, "§cDelete")
    if (!yes) return back()
    deleteWarp(warpId)
    record(player, "warp.delete", undefined, warpId)
    ok(player, "Warp deleted.")
    return back()
}

// --------------------------------------------------------- spawn protection

/** Is this position inside the protected area? */
function insideSpawn(location, dimensionId) {
    if (!flag("spawn.protect")) return false
    const point = getSpawn()
    if (!point || dimensionId !== point.dimension) return false

    const radius = Number(setting("spawn.radius"))
    if (!Number.isFinite(radius) || radius <= 0) return false

    // Squared distance, so there is no square root on every block event. The
    // dimension has to match too — a spawn in the overworld should not protect
    // the same coordinates in the nether.
    const dx = location.x - point.x
    const dz = location.z - point.z
    return dx * dx + dz * dz <= radius * radius
}

function exempt(player) {
    return !player || isStaff(player) || has(player, "warp.manage")
}

/**
 * Spawn protection: no terrain damage and no PvP inside the radius, staff
 * excepted.
 *
 * PvP is handled two ways because Bedrock's damage event may or may not be
 * cancellable on a given runtime: cancel it outright where a before-event
 * exists, otherwise heal the damage straight back after the fact. The second is
 * uglier but it still means an attack inside spawn accomplishes nothing.
 */
export function installSpawnProtection() {
    const blockGuard = (eventData, player, location) => {
        if (exempt(player)) return
        if (!insideSpawn(location, player?.dimension?.id)) return
        eventData.cancel = true
        system.run(() => info(player, "§cYou can't build this close to spawn."))
    }

    const breakEvent = world.beforeEvents?.playerBreakBlock
    const placeEvent = world.beforeEvents?.playerPlaceBlock
    if (breakEvent?.subscribe) breakEvent.subscribe(e => blockGuard(e, e.player, e.block.location))
    if (placeEvent?.subscribe) placeEvent.subscribe(e => blockGuard(e, e.player, e.block.location))
    if (!breakEvent?.subscribe && !placeEvent?.subscribe) {
        console.log("[Admin+] spawn block protection unavailable on this runtime")
    }

    // Preferred: refuse the damage before it lands.
    const beforeHurt = world.beforeEvents?.entityHurt
    if (beforeHurt?.subscribe) {
        beforeHurt.subscribe(eventData => {
            const attacker = eventData.damageSource?.damagingEntity
            const victim = eventData.hurtEntity
            if (!isPvp(attacker, victim) || exempt(attacker)) return
            if (!insideSpawn(victim.location, victim.dimension?.id)) return
            eventData.cancel = true
            system.run(() => info(attacker, "§cNo fighting this close to spawn."))
        })
        return
    }

    // Fallback: give the health straight back, so the hit achieves nothing.
    world.afterEvents.entityHurt.subscribe(eventData => {
        const attacker = eventData.damageSource?.damagingEntity
        const victim = eventData.hurtEntity
        if (!isPvp(attacker, victim) || exempt(attacker)) return
        if (!insideSpawn(victim.location, victim.dimension?.id)) return

        const health = victim.getComponent("minecraft:health")
        if (!health) return
        system.run(() => {
            try {
                health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + eventData.damage))
                info(attacker, "§cNo fighting this close to spawn.")
            } catch { /* victim left */ }
        })
    })
}

function isPvp(attacker, victim) {
    return attacker?.typeId === "minecraft:player" && victim?.typeId === "minecraft:player"
}
