import { world, system, CustomCommandParamType } from "@minecraft/server"
import { command } from "../core/registry.js"
import { ok, err, info, broadcast, staffNotice } from "../core/util.js"
import { record } from "../core/logs.js"
import { has } from "../core/ranks.js"
import { isFrozen } from "../core/moderation.js"
import { flag } from "../core/settings.js"
import { Table } from "../core/storage.js"
import { menu, modal, subtitle, INCOMPLETE } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { serializeStack, buildStack } from "../core/staffmode.js"
import {
    judge, tally, describeTally, kindOf, kindName, removableTypes, warnSeconds, keptReasons,
    noteSeen, noteDeath, shieldIfDeathDrop, isShielded, forgetMissing, safeStack, stackSignature, planMerges,
    hotspots, dimensionName, planMobLimit, MOB_LIMIT_TYPES, mobCap, speedFrom, shouldAutoClear,
    ageOf, minAgeSeconds, shieldTag, shieldUntil, tagShieldUntil, nextSlowLevel, GROUPS, CLEAR_LEVELS, clearPlan
} from "../core/cleanup.js"
import { adminplusDisabled } from "../core/terms.js"

// /clearchat, /lagclear and /lagcheck.
//
// /lagclear only ever removes whitelisted clutter (core/cleanup.js says why),
// and since 2.12.17 it does it carefully enough to run by itself:
//
//   1. a countdown on everyone's action bar, so anyone can grab their things
//   2. GATHER: identical drops lying close together are moved onto one spot and
//      the game merges them, comparing every detail itself. Nothing is made or
//      deleted, so nothing can be lost; a pile of 300 becomes a handful
//   3. what is still clutter, and old enough, and nobody's, is removed a batch
//      per tick, so a big clear can't cause the lag spike it is meant to cure
//   4. every removed item is written down, so "Bring back the last clear" can
//      put it back where it was
//   5. the mob limit thins out farm animals and monsters per chunk, the
//      farthest from players first
//
// Behind it, all the time: a tick timer (real ticks per second), item ages from
// the spawn event, and death drops shielded for a few minutes. With
// "Clear by itself" on, it gathers quietly when items pile up and clears, with
// a countdown, when clutter and extra mobs pass the limit or the server is
// slow and there's something to blame; never more than once in five minutes.
//
// 3.0.3, the user: "simplify things on lag clear, so it actually clears lag".
// They chose: clear mobs too (the limit is on, 20 of a kind per chunk), clear
// by itself sooner (500 things, or 100 on a slow server, mobs counted), and a
// simpler /lagclear. The same day a list of toggles and then a menu of level
// buttons were tried; the user settled it: "it should go back to normal, but
// in a level scale, you can do a high lag clear, or a minor lag clear or like
// in between", then "Have it be a dropdown instead then you press submit.
// Toggles are too weird". So /lagclear is one dropdown: Minor, Medium, High
// (core/cleanup.js clearPlan), and Bring back the last clear. Merging always
// happens now when dropped items are taken; it was a switch.

const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]

/** How much to do per tick: enough to finish fast, little enough not to stall. */
const REMOVE_PER_TICK = 150
const GATHER_PER_TICK = 60
/** At most this many cleared stacks are kept to bring back. */
const UNDO_LIMIT = 3000
/** Ticks the game gets to merge what was gathered: it looks about every 40. */
const SETTLE_TICKS = 45

/** Who a clear is written down as when nobody started it. */
const AUTOMATIC = { id: "adminplus", name: "Admin+ (automatic)" }

const undo = new Table("lagclearUndo", {})
/** The real cleared stacks, this session only, by key. While they exist,
 *  bring back is exact (shulker contents and all), like staff mode's live
 *  copy; the saved JSON is the fallback after a reload. */
const liveUndo = new Map()
const ticks = []
const state = { running: false, gathering: false, lastAuto: 0, slowChecks: 0, slowLevel: 0, verify: null }
/** The last clear's numbers for /lagcheck: what it did, what it cost, whether it helped. */
let lastClear = null

// -------------------------------------------------------------- clear chat

command({
    name: "clearchat",
    description: "Clear the chat for everyone",
    perm: "admin.clearchat",
    run: (player) => {
        // Bedrock has no "clear chat" — the only way is to scroll it off with
        // blank lines, which is what every server does.
        const blank = "\n".repeat(100)
        for (const target of world.getAllPlayers()) {
            target.sendMessage(blank)
        }
        broadcast(`§7Chat cleared by §f${player.name}§7.`)
        record(player, "admin.clearchat", undefined, "chat cleared")
    }
})

// ---------------------------------------------------------------- reading

/** The server's speed over the last ten seconds. */
export function speed() { return speedFrom(ticks) }

function dimensions() {
    const out = []
    for (const id of DIMENSIONS) {
        try { out.push(world.getDimension(id)) } catch { /* not there */ }
    }
    return out
}

/** Every entity of these types: by default, what the lag clear settings would even consider removing. */
function clutter(types = removableTypes()) {
    const found = []
    for (const dimension of dimensions()) {
        for (const type of types) {
            try { found.push(...dimension.getEntities({ type })) } catch { /* type unknown here */ }
        }
    }
    return found
}

/** Every entity but players, for the report. */
function everything() {
    const found = []
    for (const dimension of dimensions()) {
        try { found.push(...dimension.getEntities().filter(e => e.typeId !== "minecraft:player")) } catch { /* not loaded */ }
    }
    return found
}

function where(entity) {
    try { return { dimension: entity.dimension.id, ...entity.location } } catch { return undefined }
}

function isMob(entity) {
    try { return !!entity.getComponent?.("minecraft:health") } catch { return false }
}

// ------------------------------------------------------------- batching

/** Run `fn` over `items`, `perTick` at a time, then `done`. */
/** Not sliding, not in water, not on a hopper: farm output stays where the farm put it. */
function atRest(entity) {
    try {
        const v = entity.getVelocity?.()
        if (v && Math.abs(v.x) + Math.abs(v.z) > 0.01) return false
        const at = entity.location
        const here = entity.dimension.getBlock?.(at)
        if (here && (String(here.typeId).includes("water") || here.isWaterlogged)) return false
        const below = entity.dimension.getBlock?.({ x: at.x, y: at.y - 1, z: at.z })
        if (below?.typeId === "minecraft:hopper") return false
    } catch { return false }
    return true
}

/** Nothing solid between an item and where it would be moved. */
function clearPath(entity, to) {
    try {
        const dimension = entity.dimension
        if (typeof dimension?.getBlockFromRay !== "function") return true
        const from = { x: entity.location.x, y: entity.location.y + 0.25, z: entity.location.z }
        const d = { x: to.x - from.x, y: to.y + 0.25 - from.y, z: to.z - from.z }
        const length = Math.hypot(d.x, d.y, d.z)
        if (length < 0.5) return true
        return !dimension.getBlockFromRay(from, { x: d.x / length, y: d.y / length, z: d.z / length },
            { maxDistance: length, includePassableBlocks: false, includeLiquidBlocks: false })
    } catch { return false }
}

/** A death shield in memory or on the item's own tag (the tag outlives a reload). */
function shieldedNow(entity) {
    try { return isShielded(entity.id) || tagShieldUntil(entity.getTags?.() ?? []) > Date.now() } catch { return true }
}

function inBatches(items, perTick, fn, done, meter) {
    let i = 0
    const step = () => {
        const started = Date.now()
        const end = Math.min(items.length, i + perTick)
        for (; i < end; i++) {
            try { fn(items[i]) } catch { /* one bad entity costs one entity */ }
        }
        if (meter) meter.ms += Date.now() - started
        if (i < items.length) system.runTimeout(step, 1)
        else done?.()
    }
    step()
}

function bar(text) {
    for (const p of world.getAllPlayers()) {
        try { p.onScreenDisplay.setActionBar(text) } catch { /* left */ }
    }
}

// --------------------------------------------------------------- gather

/**
 * Move identical drops that lie close together onto one spot, and let the game
 * merge them. The game compares every detail of an item before merging (a
 * tipped arrow's effect, a map's id, a firework's flight), so this can't lose
 * or change anything; it only moves items a few blocks, onto a spot where one
 * of them already lay. Death drops stay put: merged into another stack they
 * would lose their shield.
 */
export function gather(done) {
    if (state.gathering) { done?.(0); return }
    state.gathering = true
    const items = []
    const byId = new Map()
    for (const dimension of dimensions()) {
        let found = []
        try { found = dimension.getEntities({ type: "minecraft:item" }) } catch { continue }
        for (const entity of found) {
            // Never a death drop, a fresh drop (merged into an old pile it
            // would take on the pile's age), or farm output on its way (3.0.0).
            if (shieldedNow(entity) || ageOf(entity.id) < minAgeSeconds() * 1000 || !atRest(entity)) continue
            const stack = safeStack(entity)
            const sig = stackSignature(stack)
            const at = where(entity)
            if (!sig || !at) continue
            byId.set(entity.id, entity)
            items.push({ id: entity.id, ...at, typeId: stack.typeId, amount: Number(stack.amount) || 1, max: Number(stack.maxAmount) || 64, sig })
        }
    }
    const plans = planMerges(items)
    let moved = 0
    inBatches(plans, GATHER_PER_TICK, plan => {
        // The member nearest the middle is the spot: a place an item already lies.
        const members = plan.remove.map(id => byId.get(id)).filter(Boolean)
        let anchor = members[0], best = Infinity
        for (const m of members) {
            const at = where(m)
            const d = at ? Math.hypot(at.x - plan.at.x, at.z - plan.at.z) : Infinity
            if (d < best) { best = d; anchor = m }
        }
        const spot = where(anchor)
        if (!spot) return
        for (const m of members) {
            if (m === anchor) continue
            if (!clearPath(m, spot)) continue   // never through a wall or a floor
            try { m.teleport({ x: spot.x, y: spot.y, z: spot.z }); moved++ } catch { /* gone */ }
        }
    }, () => {
        state.gathering = false
        done?.(moved)
    })
}

// ---------------------------------------------------------------- clear

/**
 * Add a clear's stacks to what can come back: the newest UNDO_LIMIT across
 * clears (3.0.0), so a loss reported after the next clear can still be undone.
 */
function storeUndo(entries, by) {
    const kept = [...(undo.get("last")?.items ?? []), ...entries].slice(-UNDO_LIMIT)
    const keys = new Set(kept.map(e => e.k))
    for (const key of [...liveUndo.keys()]) if (!keys.has(key)) liveUndo.delete(key)
    try { undo.set("last", { at: Date.now(), by: by?.name ?? "", items: kept }) } catch (e) {
        console.warn(`[Admin+] lag clear: couldn't save what was cleared: ${e}`)
    }
    return kept.length
}

export function undoCount() { return undo.get("last")?.items?.length ?? 0 }

/**
 * Remove these entities a batch per tick, writing down every item so it can be
 * brought back. Re-judged at the moment of removal: something may have been
 * picked up or named since.
 */
function removeAll(entities, by, done, meter, types = removableTypes()) {
    const saved = []
    const removed = []
    const clearAt = Date.now().toString(36)
    const tenth = n => Math.round(n * 10) / 10
    inBatches(entities, REMOVE_PER_TICK, entity => {
        if (entity.isValid === false) return
        if (!judge(entity, Date.now(), types).remove) return
        if (entity.typeId === "minecraft:item") {
            const stack = safeStack(entity)
            const at = where(entity)
            if (stack && at) {
                const k = `${clearAt}.${saved.length}`
                saved.push({ k, s: serializeStack(stack), d: at.dimension, x: tenth(at.x), y: tenth(at.y), z: tenth(at.z) })
                try { liveUndo.set(k, stack.clone()) } catch { /* the saved copy still has it */ }
            }
        }
        const kind = kindOf(entity)
        entity.remove()
        removed.push(kind)
    }, () => done({ removed, back: saved.length ? storeUndo(saved, by) : undoCount() }), meter)
}

/**
 * The mobs over the limit (cleanup.mobCap), farthest from players first:
 * `{ plan: [ids], byId }`. Only a crowded chunk's mobs are looked at closely,
 * because keepsMob reads several components per mob.
 */
function crowdedMobs(cap = mobCap()) {
    const none = { plan: [], byId: new Map() }
    if (!cap) return none
    const found = []
    const counts = new Map()
    for (const dimension of dimensions()) {
        for (const type of MOB_LIMIT_TYPES) {
            let mobs = []
            try { mobs = dimension.getEntities({ type }) } catch { continue }
            for (const mob of mobs) {
                const at = where(mob)
                if (!at) continue
                const key = `${at.dimension}|${Math.floor(at.x / 16)}|${Math.floor(at.z / 16)}|${mob.typeId}`
                counts.set(key, (counts.get(key) ?? 0) + 1)
                found.push({ mob, at, key })
            }
        }
    }
    const byId = new Map()
    const crowded = []
    for (const { mob, at, key } of found) {
        if (counts.get(key) <= cap) continue
        byId.set(mob.id, mob)
        crowded.push({ id: mob.id, ...at, typeId: mob.typeId, keep: keepsMob(mob) })
    }
    if (!crowded.length) return none
    const players = []
    for (const p of world.getAllPlayers()) {
        try { players.push({ dimension: p.dimension.id, x: p.location.x, z: p.location.z }) } catch { /* left */ }
    }
    return { plan: planMobLimit(crowded, cap, players), byId }
}

/** The mob limit, a batch per tick. Calls done(how many went). */
function thinMobs(done, meter, cap = mobCap()) {
    const { plan, byId } = crowdedMobs(cap)
    if (!plan.length) return done(0)
    let gone = 0
    inBatches(plan, REMOVE_PER_TICK, id => {
        const mob = byId.get(id)
        if (!mob || mob.isValid === false) return
        mob.remove()
        gone++
    }, () => done(gone), meter)
}

/** Named, tamed, leashed, ridden, riding or tagged: somebody's, never removed. */
function keepsMob(mob) {
    try {
        if (mob.nameTag) return true
        if ((mob.getTags?.() ?? []).some(t => /^(keep|persist|admin:keep|nolagclear)$/i.test(t))) return true
        if (mob.getComponent?.("minecraft:is_tamed")) return true
        if (mob.getComponent?.("minecraft:leashable")?.isLeashed) return true
        if (mob.getComponent?.("minecraft:riding")) return true
        if ((mob.getComponent?.("minecraft:rideable")?.getRiders?.() ?? []).length) return true
    } catch { return true }
    // Holding or wearing something, often a player's that it picked up (3.0.0).
    try {
        const gear = mob.getComponent?.("minecraft:equippable")
        if (gear && ["Mainhand", "Offhand", "Head", "Chest", "Legs", "Feet"].some(slot => {
            try { return !!gear.getEquipment(slot) } catch { return false }
        })) return true
    } catch { /* nothing to read */ }
    return false
}

/** "dropped items, XP orbs and crowded mobs" */
function listWords(words) {
    return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words.join("")
}

/**
 * The whole clear: countdown, gather, remove, mob limit, report.
 * `level` is how hard it goes (CLEAR_LEVELS); a clear by itself is medium,
 * which is the lag clear settings.
 * @param {{by?: object, seconds?: number, why?: string, level?: string}} options
 */
export function runClear({ by, seconds = warnSeconds(), why, level = "medium" } = {}) {
    if (state.running) {
        if (by?.sendMessage) info(by, "§7A lag clear is already running.")
        return false
    }
    const { groups: picked, cap } = clearPlan(level)
    const types = picked.flatMap(id => GROUPS[id].types)
    if (!types.length && !cap) {
        if (by?.sendMessage) err(by, `A ${level} lag clear would take nothing with the lag clear settings as they are.`)
        return false
    }
    state.running = true
    const label = listWords([...picked.map(id => GROUPS[id].words), ...(cap ? ["crowded mobs"] : [])])

    // Admin+ turned off during the countdown (its terms declined): stop.
    const stopped = () => {
        if (!adminplusDisabled()) return false
        state.running = false
        if (by?.sendMessage) info(by, "§7Admin+ was turned off, so the lag clear stopped.")
        return true
    }
    const clear = () => {
        if (stopped()) return
        const meter = { ms: 0 }
        const started = Date.now()
        const tpsBefore = speed().tps
        const candidates = clutter(types)
        const kept = keptReasons(candidates, Date.now(), types)
        const going = candidates.filter(e => judge(e, Date.now(), types).remove)
        meter.ms += Date.now() - started
        removeAll(going, by, result => thinMobs(mobsGone => {
            state.running = false
            report(by, { removed: result.removed, back: result.back, kept, mobs: mobsGone, why, ms: meter.ms, tpsBefore, level })
        }, meter, cap), meter, types)
    }

    // Merging moves drops, so it only happens when dropped items are taken.
    const afterCountdown = () => {
        if (stopped()) return
        if (picked.includes("items")) gather(() => system.runTimeout(clear, SETTLE_TICKS))
        else clear()
    }

    if (seconds <= 0) { afterCountdown(); return true }
    broadcast(`§eClearing ${label} in §f${seconds}s§e. Pick up anything you want to keep.`)
    for (let left = seconds; left > 0; left--) {
        system.runTimeout(() => bar(`§eClearing ${label} in §f${left}§e...`), (seconds - left) * 20)
    }
    system.runTimeout(afterCountdown, seconds * 20)
    return true
}

function report(by, { removed, back, kept, mobs, why, ms = 0, tpsBefore, level = "medium" }) {
    const counts = tally(removed, { amounts: true })
    const total = removed.length + mobs
    const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0)
    if (!total) {
        broadcast(`§7Lag clear: nothing needed clearing.${keptTotal ? ` §8(${keptTotal} kept)` : ""}`)
    } else {
        const what = [removed.length ? describeTally(counts) : "", mobs ? `${mobs} extra ${mobs === 1 ? "mob" : "mobs"} from crowded spots` : ""].filter(Boolean).join(", ")
        broadcast(`§7Lag clear removed §f${what}§7.${back ? " §8Staff can bring the items back." : ""}`)
    }
    if (keptTotal) {
        const reasons = Object.entries(kept).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(", ")
        staffNotice(`§7Lag clear kept §f${keptTotal}§7: ${reasons}.${back ? ` §8${back} cleared stacks can be brought back: /lagclear.` : ""}`)
    }
    const actor = by?.id ? by : AUTOMATIC
    record(actor, "admin.lagclear", undefined,
        `${level} clear · ${total} removed ·${describeTally(counts)}${mobs ? ` · ${mobs} mobs` : ""}${why ? ` · automatic (${why === "slow" ? "server slow" : "clutter"})` : ""} · ${ms} ms`)
    // Did it help? The speed a minute later goes on /lagcheck beside the cost.
    const entry = { at: Date.now(), total, ms, tpsBefore, tpsAfter: undefined }
    lastClear = entry
    system.runTimeout(() => { entry.tpsAfter = speed().tps }, 60 * 20)
}

function lastClearLine() {
    if (!lastClear) return null
    const mins = Math.max(1, Math.round((Date.now() - lastClear.at) / 60000))
    const after = lastClear.tpsAfter === undefined ? "" : `, §f${lastClear.tpsAfter}§7 a minute after`
    return `§7Last clear, ${mins} min ago: §f${lastClear.total}§7 removed with §f${lastClear.ms}§7 ms of script work; speed §f${lastClear.tpsBefore}§7 before${after}.`
}

// -------------------------------------------------------------- bring back

/** Put the last clear's items back where they were. Places nobody is near can't be reached yet; those wait. */
export function bringBack(player) {
    const last = undo.get("last")
    const items = last?.items ?? []
    if (!items.length) { info(player, "§7There is nothing to bring back."); return 0 }
    let back = 0
    const left = []
    // A batch per tick, like removal; the real stack when this session still
    // has it (exact), the saved copy otherwise.
    inBatches(items, REMOVE_PER_TICK, entry => {
        let stack
        try { stack = liveUndo.get(entry.k) ?? buildStack(entry.s) } catch { stack = undefined }
        if (!stack) return
        try {
            world.getDimension(entry.d).spawnItem(stack, { x: entry.x, y: entry.y, z: entry.z })
            liveUndo.delete(entry.k)
            back++
        } catch {
            left.push(entry)
        }
    }, () => {
        undo.set("last", { ...last, items: left })
        if (left.length) ok(player, `Brought back §f${back}§a stacks. §7${left.length} are in places nobody is near; bring them back again once someone is there.`)
        else ok(player, `Brought back all §f${back}§a stacks, where they were.`)
        record(player, "admin.lagclear", undefined, `brought back ${back} stacks`)
    })
    return items.length
}

// ---------------------------------------------------------------- screens

function speedWords(tps) {
    if (tps >= 19) return "§ahealthy"
    if (tps >= 15) return "§ea little slow"
    return "§cstruggling"
}

const LEVEL_NAMES = { minor: "Minor", medium: "Medium", high: "High" }

/** "drops, XP, arrows and mobs down to 20 of a kind per chunk" */
function levelWords(level, groups, cap) {
    const parts = level === "high" ? ["all clutter, falling blocks too"] : groups.map(id => GROUPS[id].short)
    if (cap) parts.push(`mobs down to ${cap} of a kind per chunk`)
    return parts.length ? listWords(parts) : "nothing, with the lag clear settings as they are"
}

/**
 * /lagclear (3.0.3): one dropdown, then Submit. The user: "a high lag clear,
 * or a minor lag clear or like in between", then "Have it be a dropdown
 * instead then you press submit ... it's best if you make this judgement
 * call". The choices are the three levels and, when there's something to
 * bring back, Bring back the last clear. It starts on Medium, the clear that
 * runs by itself, and the text above says what each level takes and how many
 * that is now.
 */
async function lagForm(player, back) {
    const sp = speed()
    const now = Date.now()
    const counts = {}
    for (const id of Object.keys(GROUPS)) counts[id] = clutter(GROUPS[id].types).filter(e => judge(e, now, GROUPS[id].types).remove).length
    const crowdedAt = new Map()
    const extraMobs = cap => {
        if (!cap) return 0
        if (!crowdedAt.has(cap)) crowdedAt.set(cap, crowdedMobs(cap).plan.length)
        return crowdedAt.get(cap)
    }
    const lines = CLEAR_LEVELS.map(level => {
        const { groups, cap } = clearPlan(level)
        const total = groups.reduce((sum, id) => sum + counts[id], 0) + extraMobs(cap)
        return `§f${LEVEL_NAMES[level]}§7: ${levelWords(level, groups, cap)} §8(${total} now)§7.${level === "medium" ? " It's the clear that runs by itself." : ""}`
    })
    const stacks = undoCount()
    const choices = [
        ...CLEAR_LEVELS.map(level => ({ id: level, label: `${LEVEL_NAMES[level]} lag clear` })),
        ...(stacks ? [{ id: "back", label: `Bring back the last clear (${stacks} stacks)` }] : [])
    ]
    const values = await modal(player, hubTitle("settings", "Lag clear"), [
        {
            type: "label", label: [
                `§7Server speed: §f${sp.tps}§7 ticks a second (${speedWords(sp.tps)}§7).`,
                ...lines,
                "§8Never cleared, at any level: named, enchanted or valuable items, fresh drops, death drops for a few minutes, and named, tamed or leashed mobs and villagers. Where the load is: /lagcheck."
            ].join("\n")
        },
        { id: "what", type: "dropdown", label: "What to do", options: choices.map(c => c.label), default: CLEAR_LEVELS.indexOf("medium") }
    ], { strict: true })
    if (!values) return back?.()
    if (values === INCOMPLETE) {
        err(player, "Your choice didn't come back from the game, so nothing was cleared. Try again.")
        return back?.()
    }
    const choice = choices[values.what]
    if (!choice) return back?.()
    if (choice.id === "back") return bringBack(player)
    return runClear({ by: player, level: choice.id })
}

/** The report /lagcheck opens: speed, what is loaded, and the busiest chunks. */
export async function lagReport(player, back) {
    const sp = speed()
    const all = everything()
    const clearable = all.filter(e => judge(e).remove).length
    const players = world.getAllPlayers()
    const spots = hotspots(all.map(e => ({ ...where(e), typeId: e.typeId, isMob: isMob(e) })).filter(e => e.dimension), 5)
    const nearest = spot => {
        let name, best = Infinity
        for (const p of players) {
            try {
                if (p.dimension.id !== spot.dimension) continue
                const d = Math.hypot(p.location.x - spot.center.x, p.location.z - spot.center.z)
                if (d < best) { best = d; name = p.name }
            } catch { /* left */ }
        }
        return name && best <= 128 ? name : undefined
    }
    return menu(player, {
        title: hubTitle("settings", "Busiest places"),
        body: subtitle([
            `Server speed: §f${sp.tps}§7 ticks a second (${speedWords(sp.tps)}§7). 20 is full speed.`,
            `§7A tick every ${sp.mspt} ms on average (50 at full speed); the longest gap was ${sp.worst} ms.`,
            sp.tps >= 19 ? "§7The server is keeping up, so lag players feel is on their device or connection."
                : sp.tps < 15 && clearable < 300 ? "§7Slow with little to clear, so the cause is probably redstone clocks, hoppers, ticking areas (/tickingarea list all-dimensions) or, on a dedicated server, tick-distance and view-distance."
                : null,
            lastClearLine(),
            "",
            `§f${all.length}§7 things loaded, §f${clearable}§7 clearable now.`,
            `Most common: §f${describeTally(tally(all), 6)}`,
            "",
            spots.length ? "Heaviest first. Mobs count several times an item, villagers most of all." : "Nothing is loaded."
        ].filter(line => line !== null).join("\n")),
        buttons: [
            ...spots.map(spot => {
                const near = nearest(spot)
                return {
                    text: `§f${dimensionName(spot.dimension)} ${spot.center.x}, ${spot.center.z}§r\n§8${spot.top.map(t => `${kindName(t.type)} ×${t.count}`).join(", ")}${spot.top.some(t => /^villager/.test(t.type) && t.count >= 10) ? " §c· 10+ villagers" : ""}${near ? ` · near ${near}` : ""}`,
                    run: () => goTo(player, spot)
                }
            }),
            { text: "§cClear now§r\n§8Minor, medium or high", run: () => lagForm(player, () => lagReport(player, back)) }
        ],
        back
    })
}

function goTo(player, spot) {
    const where = `${dimensionName(spot.dimension)} ${spot.center.x}, ${spot.center.z}`
    if (!has(player, "admin.tp")) return info(player, `§7That's at §f${where}§7.`)
    if (isFrozen(player)) return err(player, "You're frozen, so you can't teleport.")
    try {
        const dimension = world.getDimension(spot.dimension)
        const top = dimension.getTopmostBlock({ x: spot.center.x, z: spot.center.z })
        const y = top ? top.location.y + 1 : (player.location?.y ?? 100)
        player.teleport({ x: spot.center.x + 0.5, y, z: spot.center.z + 0.5 }, { dimension })
        ok(player, `Took you to §f${where}§a.`)
    } catch {
        err(player, `Couldn't take you there. It's at §f${where}§c.`)
    }
}

// --------------------------------------------------------------- commands

command({
    name: "lagclear",
    description: "Clear dropped items, clutter and crowded mobs",
    perm: "admin.lagclear",
    optional: [{ name: "seconds", type: CustomCommandParamType.Integer }],
    run: (player, [seconds]) => {
        // A number is the shortcut: clear now, with that countdown.
        if (Number.isFinite(seconds)) return runClear({ by: player, seconds: Math.max(0, Math.round(seconds)) })
        return lagForm(player)
    }
})

/** What is out there, and where, without touching anything. */
command({
    name: "lagcheck",
    description: "See how the server is doing and where the load is",
    perm: "admin.lagclear",
    run: (player) => lagReport(player)
})

// ---------------------------------------------------------------- running

/**
 * One check every 20 seconds: count clutter, note whether the server is slow,
 * gather quietly when items pile up, and clear if it's needed.
 */
export function autoCheck(now = Date.now()) {
    // Off (the terms were declined): nothing clears by itself.
    if (adminplusDisabled()) return undefined
    const sp = speed()
    state.slowChecks = sp.tps < 15 ? state.slowChecks + 1 : 0
    // Two checks (40 s) after a clear for a slow server: did it help?
    if (state.verify && ++state.verify.checks >= 2) {
        state.slowLevel = nextSlowLevel(state.slowLevel, sp.tps)
        if (sp.tps < 15) staffNotice("§7Clearing didn't speed the server up, so the lag is probably not dropped items. §f/lagcheck§7 shows where things pile up; also check redstone clocks, hoppers and ticking areas.")
        state.verify = null
    } else if (!state.verify && sp.tps >= 19) state.slowLevel = 0
    if (!flag("cleanup.auto") || state.running) return { go: false }
    const found = clutter()
    if (found.filter(e => e.typeId === "minecraft:item").length >= 150) gather()
    const decision = shouldAutoClear({
        // Extra mobs count (3.0.3): a farm can lag a server with no drops at all.
        clutter: found.filter(e => judge(e, now).remove).length + crowdedMobs().plan.length,
        tps: sp.tps, slowChecks: state.slowChecks, slowLevel: state.slowLevel, lastAuto: state.lastAuto, running: state.running, now
    })
    if (decision.go) {
        state.lastAuto = now
        if (decision.why === "slow") state.verify = { checks: 0 }
        runClear({ seconds: Math.max(10, warnSeconds()), why: decision.why })
    }
    return decision
}

export function installCleanup() {
    // Real tick times, for ticks per second. One number a tick costs nothing.
    system.runInterval(() => {
        ticks.push(Date.now())
        if (ticks.length > 201) ticks.shift()
    }, 1)

    // Ages and death drops, from the moment things appear.
    try {
        world.afterEvents.entitySpawn.subscribe(({ entity }) => {
            try {
                if (entity?.typeId !== "minecraft:item" && !removableTypes().includes(entity?.typeId)) return
                const now = Date.now()
                noteSeen(entity.id, now)
                if ((entity.typeId === "minecraft:item" || entity.typeId === "minecraft:xp_orb")
                    && shieldIfDeathDrop(entity.id, entity.dimension.id, entity.location, now)) {
                    entity.addTag(shieldTag(shieldUntil(entity.id)))
                }
            } catch { /* gone already */ }
        })
    } catch { /* older runtime: everything counts as old */ }
    try {
        world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
            try {
                if (deadEntity?.typeId !== "minecraft:player") return
                const caught = new Set(noteDeath(deadEntity.dimension.id, deadEntity.location))
                if (!caught.size) return
                // Drops the game reported before the death get the tag too.
                for (const e of deadEntity.dimension.getEntities({ location: deadEntity.location, maxDistance: 10 })) {
                    if (caught.has(e.id)) try { e.addTag(shieldTag(shieldUntil(e.id))) } catch { /* gone */ }
                }
            } catch { /* gone */ }
        }, { entityTypes: ["minecraft:player"] })
    } catch { /* older runtime: no death shield */ }

    system.runInterval(() => autoCheck(), 20 * 20)
    // Forget what no longer exists, so the age map never outgrows the world.
    system.runInterval(() => { try { forgetMissing(clutter().map(e => e.id)) } catch { /* next time */ } }, 20 * 60)
    console.log("[Admin+] lag clear ready")
    return true
}

/** Testing seams. */
export function __tickTimes() { return ticks }
export function __cleanupState() { return state }
