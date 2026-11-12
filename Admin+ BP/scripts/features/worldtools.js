import { world, system, ItemStack, ItemLockMode } from "@minecraft/server"
import { command } from "../core/registry.js"
import { menu, confirm, subtitle } from "../core/ui.js"
import { hubTitle, hubEntry } from "../core/theme.js"
import { ok, err, info } from "../core/util.js"
import { has } from "../core/ranks.js"
import { flag, setting } from "../core/settings.js"
import { record } from "../core/logs.js"
import { claimsScreen } from "./claims.js"
import { spawnSettingsScreen } from "./warps.js"
import {
    reconcileSpawn, spawnRecord, enableOmniSpawn, deleteOmniSpawn, saveSpawnArea,
    setOmniPoint, keepSimplePoint, dontSetPoint, setAsidePoint,
    makeRegion, regionComplete, regionContains, describeRegion, outlinePoints
} from "../core/omnitool.js"

// World tools (2.9.0): /wts, the Omnitool, and land claims in one place.
// Designed by the user on 2026-11-12; the whole design is in Obsidian
// (Firelite ▸ Projects ▸ Minecraft ▸ Bedrock ▸ Mods ▸ Admin+ ▸ World Tools).
//
// The Omnitool is a stick for admins that SELECTS areas the way WorldEdit
// does. It never edits blocks: "WorldEdit is its own existing mod translated
// to bedrock, and a great one". For now its only job is spawn.
//
//   left click a block    pos1 (it never breaks the block)
//   right click a block   pos2
//   shift + right click   save or cancel while editing; otherwise the menu
//
// It is three items that look like a stick, a blaze rod and a breeze rod, all
// with the enchant shine, pointing at the game's own textures. The pack swaps
// them round while they sit in the inventory. Everything the tool remembers
// lives on the PLAYER, in `sessions` below, so a swap loses nothing.

export const OMNI_TYPES = ["adminplus:omnitool_stick", "adminplus:omnitool_blaze", "adminplus:omnitool_breeze"]
const LORE = ["§7Left click: pos1 · Right click: pos2", "§7Shift + right click: save, cancel or the menu"]
const PARTICLE = "adminplus:outline"
const FLASH_TICKS = 200          // "it flashes for about 10 seconds"
const DRAW_EVERY = 10            // ticks between outline draws
const HOUSEKEEP_EVERY = 30       // ticks between swaps, idle checks and catch-ups

/** Who is editing, per player id: { mode: "editing" | "point", ... }. */
const sessions = new Map()
/** Spawn borders being flashed: { region, until, viewer }. */
const flashes = []
/** The tick of each player's last block click, to drop the double events one click can fire. */
const lastRight = new Map()
const lastLeft = new Map()

export const isOmnitool = stack => !!stack && OMNI_TYPES.includes(stack.typeId)
const mayUse = player => flag("feature.worldtools") && has(player, "admin.omnitool")
const fmt = p => p ? `${p.x}, ${p.y}, ${p.z}` : "not set"
const placeOf = point =>
    `${Math.round(point.x)}, ${Math.round(point.y)}, ${Math.round(point.z)} in ${String(point.dimension).replace("minecraft:", "").replace(/_/g, " ")}`

function inventory(player) {
    try { return player.getComponent("minecraft:inventory")?.container } catch { return undefined }
}

function heldItem(player) {
    try { return inventory(player)?.getItem(player.selectedSlotIndex) } catch { return undefined }
}

/** A short line above the hotbar, or a chat line where the game can't. */
function tell(player, text) {
    try { player.onScreenDisplay.setActionBar(text) } catch { info(player, text) }
}

// ------------------------------------------------------------------ /wts

/**
 * The World tools picker. The Omnitool is for staff with its permission. Land
 * claims are for everyone, but only while they're turned on, so with claims
 * off a player without the Omnitool can't open /wts at all.
 */
export async function worldToolsScreen(player, back) {
    if (!flag("feature.worldtools")) return err(player, "World tools are turned off on this server.")
    const omni = has(player, "admin.omnitool")
    const claims = flag("feature.claims")
    if (!omni && !claims) return err(player, "World tools need the Omnitool permission, and land claims are turned off.")
    const again = () => worldToolsScreen(player, back)
    return menu(player, {
        title: hubTitle("warps", "World tools"),
        body: subtitle("Tools for the world itself."),
        buttons: [
            omni ? { text: hubEntry("warps", "Omnitool", "A stick that selects areas, like WorldEdit"), run: () => giveOmnitool(player) } : null,
            claims ? { text: hubEntry("warps", "Land claims", "Protect what you build"), run: () => claimsScreen(player, again) } : null
        ].filter(Boolean),
        back
    })
}

for (const name of ["wts", "worldtools"]) {
    command({
        name,
        description: name === "wts" ? "World tools: the Omnitool and land claims" : "World tools (the same as /wts)",
        run: (player) => worldToolsScreen(player)
    })
}

export function giveOmnitool(player) {
    if (!mayUse(player)) return err(player, "Your rank can't use the Omnitool.")
    const container = inventory(player)
    if (!container) return err(player, "Couldn't reach your inventory.")
    for (let i = 0; i < container.size; i++) {
        if (isOmnitool(container.getItem(i))) return info(player, "§7You already have the Omnitool.")
    }
    const stack = new ItemStack(OMNI_TYPES[0], 1)
    stack.setLore(LORE)
    let leftover
    try { leftover = container.addItem(stack) } catch (e) { return err(player, `Couldn't make the Omnitool: ${e}`) }
    if (leftover) return err(player, "Your inventory is full.")
    record(player, "admin.items", player, "omnitool")
    ok(player, "The Omnitool is in your inventory. Click a block with it to start.")
}

// ------------------------------------------------------------------ clicks

/**
 * One click with the Omnitool. `kind` is "left" or "right" on a block, "air"
 * for a right click on nothing, or "sneak" for shift + right click.
 */
export function onOmnitoolClick(player, kind, block) {
    if (!mayUse(player)) return info(player, "§7Your rank can't use the Omnitool.")
    const s = sessions.get(player.id)
    if (s) s.last = Date.now()

    if (s?.mode === "editing") {
        if (kind === "sneak") return confirmEdit(player, s)
        if (!block || (kind !== "left" && kind !== "right")) return
        const at = { x: block.location.x, y: block.location.y, z: block.location.z }
        if (s.dimension !== player.dimension.id) {
            s.pos1 = s.pos2 = null
            s.dimension = player.dimension.id
            info(player, "§7You're in another dimension now, so the selection started over.")
        }
        if (kind === "left") s.pos1 = at
        else s.pos2 = at
        const r = makeRegion(s.shape, s.dimension, s.pos1, s.pos2)
        const what = s.shape === "sphere" ? (kind === "left" ? "Centre" : "Edge") : (kind === "left" ? "pos1" : "pos2")
        return tell(player, `§a${what} set at ${fmt(at)}§7${regionComplete(r) ? ` · ${describeRegion(r)}` : ""}`)
    }

    if (s?.mode === "point") {
        if (kind === "sneak") {
            sessions.delete(player.id)
            applyLocks(player)
            return info(player, "§7The spawn point wasn't changed.")
        }
        if (!block || (kind !== "left" && kind !== "right")) return
        // Players land standing on the block that was clicked.
        const point = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5, dimension: player.dimension.id, set: Date.now() }
        sessions.delete(player.id)
        applyLocks(player)
        if (!setOmniPoint(point)) return err(player, "Omnitool spawn is off, so the point wasn't saved.")
        record(player, "omni.spawnPoint", undefined, placeOf(point))
        return ok(player, `Spawn point set. /spawn now sends players to ${placeOf(point)}.`)
    }

    return pickerScreen(player, block)
}

/**
 * "How do you want to use it?" Tools in a fixed order, except that one whose
 * area was clicked inside goes on top. Spawn is the only tool for now.
 */
async function pickerScreen(player, block) {
    reconcileSpawn()
    const rec = spawnRecord()
    const insideSpawn = !!(block && rec.on && rec.region && regionContains(rec.region, block.location, player.dimension.id))
    const tools = [
        {
            inside: insideSpawn,
            text: hubEntry("warps", "Spawn", rec.on && rec.region ? "Edit the spawn area" : "Set up spawn as an area"),
            run: () => spawnTool(player)
        }
    ]
    tools.sort((a, b) => Number(b.inside) - Number(a.inside))
    return menu(player, {
        title: hubTitle("warps", "Omnitool"),
        body: subtitle("How do you want to use it?"),
        buttons: tools
    })
}

async function spawnTool(player) {
    if (!has(player, "spawn.set")) return err(player, "Setting spawn needs the set spawn permission (Ranks ▸ a rank ▸ Permissions ▸ Administrative ▸ Ranks and places).")
    reconcileSpawn()
    const rec = spawnRecord()
    if (!rec.on) {
        // Asked once, before Spawn is first used, in the user's own words.
        const yes = await confirm(player, hubTitle("warps", "Spawn through the Omnitool"),
            "Do you want to enable Spawn through the Omnitool?\n\n" +
            "§7Please note that once you do, you won't be able to use simple spawn (a point and a radius) " +
            "until you turn this off in Server ▸ Settings ▸ Omnitool ▸ General.", "§aEnable")
        if (!yes) return
        enableOmniSpawn()
        record(player, "omni.spawnOn", undefined, "simple spawn set aside")
        return shapeScreen(player, "create")
    }
    if (!rec.region) return shapeScreen(player, "create")
    return spawnMenu(player)
}

/** Before selecting: which shape. Sphere comes first; it's what spawn starts as. */
async function shapeScreen(player, purpose) {
    return menu(player, {
        title: hubTitle("warps", purpose === "create" ? "Create spawn" : "Recalibrate spawn"),
        body: subtitle("Pick a shape, then click blocks with the Omnitool.") + "\n" +
            "§8Sphere: left click the centre, right click how far it reaches.\n" +
            "§8Cuboid: left click one corner, right click the opposite corner.\n" +
            "§8Shift + right click when you're done, to save or cancel.",
        buttons: [
            { text: hubEntry("warps", "Sphere", "A centre and a radius"), run: () => startEditing(player, "sphere", purpose) },
            { text: hubEntry("warps", "Cuboid", "A box between two corners"), run: () => startEditing(player, "cuboid", purpose) }
        ]
    })
}

function startEditing(player, shape, purpose) {
    sessions.set(player.id, {
        mode: "editing", shape, purpose, pos1: null, pos2: null,
        dimension: player.dimension.id, last: Date.now(), lastPos: { ...player.location }
    })
    applyLocks(player)
    info(player, shape === "sphere"
        ? "§7Left click the centre block, then right click a block as far out as spawn should reach. Shift + right click to save or cancel."
        : "§7Left click one corner block, then right click the opposite corner. Shift + right click to save or cancel.")
}

/** Shift + right click while editing: the details, with Confirm or Cancel. */
async function confirmEdit(player, s) {
    const r = makeRegion(s.shape, s.dimension, s.pos1, s.pos2)
    const complete = regionComplete(r)
    const first = s.shape === "sphere" ? "Centre" : "pos1"
    const second = s.shape === "sphere" ? "Edge" : "pos2"
    return menu(player, {
        title: hubTitle("warps", s.purpose === "create" ? "Save spawn" : "Save the new area"),
        body: [
            `§fShape: §7${s.shape}`,
            `§f${first}: §7${fmt(s.pos1)}`,
            `§f${second}: §7${fmt(s.pos2)}`,
            `§fSize: §7${describeRegion(r)}`,
            complete ? "" : "\n§cSet both points before saving."
        ].filter(Boolean).join("\n"),
        buttons: [
            complete ? { text: "§aConfirm\n§8Save this as the spawn area", run: () => saveEdit(player, s, r) } : null,
            { text: "§7Keep editing", run: () => {} },
            { text: "§cCancel\n§8Throw this selection away", run: () => cancelEdit(player) }
        ].filter(Boolean)
    })
}

function cancelEdit(player) {
    sessions.delete(player.id)
    applyLocks(player)
    info(player, "§7Cancelled. Spawn wasn't changed.")
}

function saveEdit(player, s, r) {
    sessions.delete(player.id)
    applyLocks(player)
    if (!saveSpawnArea(r)) return err(player, "Omnitool spawn was turned off meanwhile, so nothing was saved.")
    record(player, "omni.spawnArea", undefined, `${r.shape}, ${describeRegion(r)}`)
    ok(player, `Spawn area saved: ${r.shape}, ${describeRegion(r)}.`)
    // The first time, ask where /spawn should send players.
    if (!spawnRecord().pointChosen) return pointScreen(player)
}

/** Where should /spawn send players? "Keep current" sits between the other two, as asked. */
async function pointScreen(player) {
    const kept = setAsidePoint()
    return menu(player, {
        title: hubTitle("warps", "Spawn point"),
        body: subtitle("Where should /spawn send players?"),
        buttons: [
            { text: hubEntry("warps", "Set spawn point", "Then click the block players should land on"), run: () => startPicking(player) },
            kept
                ? {
                    text: hubEntry("warps", "Keep current", `Where /spawn sent players before: ${placeOf(kept)}`),
                    run: () => {
                        keepSimplePoint()
                        record(player, "omni.spawnPoint", undefined, "kept the old point")
                        ok(player, "/spawn keeps sending players where it did before.")
                    }
                }
                : null,
            {
                text: hubEntry("settings", "Don't set spawn", "Turns /spawn off"),
                run: () => {
                    dontSetPoint()
                    record(player, "omni.spawnPoint", undefined, "none; /spawn turned off")
                    ok(player, "No spawn point, and /spawn is turned off.")
                }
            }
        ].filter(Boolean)
    })
}

function startPicking(player) {
    sessions.set(player.id, { mode: "point", last: Date.now(), lastPos: { ...player.location } })
    applyLocks(player)
    info(player, "§7Click the block players should land on. Shift + right click to cancel.")
}

/** Spawn already exists: what to do with it. Delete is at the bottom, as asked. */
async function spawnMenu(player) {
    const rec = spawnRecord()
    const again = () => spawnMenu(player)
    return menu(player, {
        title: hubTitle("warps", "Spawn"),
        body: [
            subtitle("What do you want to do with spawn?"),
            "",
            `§fArea: §7${rec.region.shape}, ${describeRegion(rec.region)}`,
            `§fSpawn point: §7${rec.point ? placeOf(rec.point) : "none"}`,
            `§fProtection: ${flag("spawn.protect") ? "§aon" : "§8off"}`
        ].join("\n"),
        buttons: [
            { text: hubEntry("warps", "Flash the border", "Shows the outline for about 10 seconds"), run: () => flashBorder(player, rec.region) },
            { text: hubEntry("warps", "Recalibrate", "Select the area again"), run: () => shapeScreen(player, "recalibrate") },
            { text: hubEntry("warps", "Set spawn point", "Then click the block players should land on"), run: () => startPicking(player) },
            { text: hubEntry("settings", "Settings", "Protection and /spawn"), run: () => spawnSettingsScreen(player, again) },
            { text: "§cDelete\n§8Back to simple spawn, exactly as it was", run: () => deleteScreen(player) }
        ]
    })
}

async function deleteScreen(player) {
    const yes = await confirm(player, hubTitle("warps", "Delete spawn"),
        "Delete the Omnitool spawn?\n\n§7Spawn goes back to exactly what you had before you set it up: simple spawn, with its point and its settings.",
        "§cDelete")
    if (!yes) return spawnMenu(player)
    deleteOmniSpawn()
    record(player, "omni.spawnDelete", undefined, "simple spawn put back")
    ok(player, "Deleted. Simple spawn is back as it was.")
}

function flashBorder(player, region) {
    flashes.push({ region, until: system.currentTick + FLASH_TICKS, viewer: player.id })
    info(player, "§7Showing the spawn border for about 10 seconds.")
}

// ------------------------------------------------------------------ outline

/** Draw one outline: for everyone in that dimension, or only for `viewer`. */
function draw(viewer, region, everyone) {
    let dimension
    try { dimension = world.getDimension(region.dimension) } catch { return }
    if (!everyone && viewer?.dimension?.id !== region.dimension) return
    for (const p of outlinePoints(region)) {
        try {
            if (everyone || !viewer) dimension.spawnParticle(PARTICLE, p)
            else viewer.spawnParticle(PARTICLE, p)
        } catch { /* outside loaded chunks */ }
    }
}

function drawAll() {
    const everyone = flag("omni.outlineEveryone")
    const players = world.getAllPlayers()
    for (const player of players) {
        const s = sessions.get(player.id)
        if (s?.mode === "editing" && s.pos1) draw(player, makeRegion(s.shape, s.dimension, s.pos1, s.pos2), everyone)
    }
    const now = system.currentTick
    for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]
        if (now > f.until) { flashes.splice(i, 1); continue }
        const viewer = players.find(p => p.id === f.viewer)
        if (viewer || everyone) draw(viewer, f.region, everyone)
    }
}

// ------------------------------------------------------------------ the stick itself

/**
 * While its owner is editing, every Omnitool they carry is locked to its slot,
 * so it can't be dropped mid-edit. Otherwise nothing is locked. A lock left
 * behind by a logout comes off here too.
 */
export function applyLocks(player) {
    const container = inventory(player)
    if (!container) return
    const want = sessions.has(player.id) ? ItemLockMode.slot : ItemLockMode.none
    for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i)
        if (!isOmnitool(item) || item.lockMode === want) continue
        item.lockMode = want
        container.setItem(i, item)
    }
}

/**
 * The look changes between the stick, the blaze rod and the breeze rod. Not the
 * one in hand: swapping a held item can replay the hand's pick-up animation.
 */
export function swapLooks(player) {
    const container = inventory(player)
    if (!container) return
    for (let i = 0; i < container.size; i++) {
        if (i === player.selectedSlotIndex) continue
        const item = container.getItem(i)
        if (!isOmnitool(item)) continue
        const next = new ItemStack(OMNI_TYPES[(OMNI_TYPES.indexOf(item.typeId) + 1) % OMNI_TYPES.length], 1)
        next.setLore(item.getLore())
        next.lockMode = item.lockMode
        container.setItem(i, next)
    }
}

/** An idle selection clears: no movement and no clicks for omni.idleMinutes. */
export function clearIdle(player, now = Date.now()) {
    const s = sessions.get(player.id)
    if (!s) return false
    const p = player.location, q = s.lastPos ?? p
    if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.z - q.z) > 0.5) {
        s.last = now
        s.lastPos = { ...p }
    }
    const minutes = Math.max(1, Number(setting("omni.idleMinutes")) || 10)
    if (now - s.last <= minutes * 60000) return false
    sessions.delete(player.id)
    applyLocks(player)
    info(player, "§7Your Omnitool selection cleared, because you were away.")
    return true
}

function housekeep() {
    reconcileSpawn()
    for (const player of world.getAllPlayers()) {
        try {
            clearIdle(player)
            applyLocks(player)
            swapLooks(player)
        } catch { /* left mid-loop */ }
    }
}

/** What a player is in the middle of, for tests and for /wts. */
export function sessionOf(player) { return sessions.get(player.id) }

// ------------------------------------------------------------------ wiring

export function installWorldTools() {
    // Left click on a block: hitting it. Fires on the first punch.
    world.afterEvents?.entityHitBlock?.subscribe(event => {
        const player = event.damagingEntity
        if (player?.typeId !== "minecraft:player" || !isOmnitool(heldItem(player))) return
        leftClick(player, event.hitBlock)
    })
    // It never breaks a block, in creative or on a long hold.
    world.beforeEvents?.playerBreakBlock?.subscribe(event => {
        if (!isOmnitool(event.itemStack)) return
        event.cancel = true
        const player = event.player, block = event.block
        system.run(() => leftClick(player, block))
    })
    // Right click on a block. The block itself isn't used (no chest opens).
    world.beforeEvents?.playerInteractWithBlock?.subscribe(event => {
        if (!isOmnitool(event.itemStack)) return
        event.cancel = true
        if (event.isFirstEvent === false) return
        const player = event.player, block = event.block
        system.run(() => {
            lastRight.set(player.id, system.currentTick)
            onOmnitoolClick(player, player.isSneaking ? "sneak" : "right", block)
        })
    })
    // Right click on nothing, if the game reports one for this item.
    world.beforeEvents?.itemUse?.subscribe(event => {
        if (!isOmnitool(event.itemStack)) return
        const player = event.source
        system.run(() => {
            // A right click on a block can report a use as well; that click is handled.
            if (system.currentTick - (lastRight.get(player.id) ?? -99) <= 2) return
            onOmnitoolClick(player, player.isSneaking ? "sneak" : "air", undefined)
        })
    })
    world.afterEvents?.playerLeave?.subscribe(event => {
        sessions.delete(event.playerId)
        lastLeft.delete(event.playerId)
        lastRight.delete(event.playerId)
    })
    system.runInterval(drawAll, DRAW_EVERY)
    system.runInterval(housekeep, HOUSEKEEP_EVERY)
}

/** One left click can arrive as a hit and as a break; the second is dropped. */
function leftClick(player, block) {
    const now = system.currentTick
    const before = lastLeft.get(player.id)
    if (before && now - before.at <= 4 && before.key === `${block.location.x},${block.location.y},${block.location.z}`) return
    lastLeft.set(player.id, { at: now, key: `${block.location.x},${block.location.y},${block.location.z}` })
    onOmnitoolClick(player, "left", block)
}
