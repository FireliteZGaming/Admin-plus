import { world, system, CustomCommandParamType, EntityTypes, DimensionTypes } from "@minecraft/server"
import { command, defineEnum } from "../core/registry.js"
import { ok, err, info } from "../core/util.js"
import { canTrollOn, refreshNameTag } from "../core/ranks.js"
import { displayName } from "../core/identity.js"
import { trollBlockedBy, DISGUISE } from "../core/trollgate.js"
import { record } from "../core/logs.js"
import { Table } from "../core/storage.js"
import { hide, unhide } from "../core/hiding.js"
import { isVanished } from "../core/vanish.js"
import { menu, subtitle } from "../core/ui.js"
import { hubTitle } from "../core/theme.js"
import { DISGUISES, DISGUISE_PREFIX } from "../core/disguises.js"

// /disguise <mob> [player] — become a mob, or `off` to stop (2.12.8, Beta).
//
// The user, 2026-11-14: "add a /disguise that lets you disguise as anything.
// Sorta like a morph mod, it uses the same technique as vanish, but without
// leaving the game ... So you can perfectly disguise as a creeper or any mob
// for that matter. Phantoms would be interesting since it requires a flying
// thing so skip flying mobs."
//
// Two halves:
//   1. The player is hidden the way vanish hides them (core/hiding.js): the
//      invisibility effect, armour and held items shrunk away, no nametag.
//      There is no "left the game" line, and nobody's effects are lost.
//   2. A body walks where they walk: adminplus:disguise_<mob>, Admin+'s own
//      entity that looks exactly like the mob (tools/gendisguise.py says how)
//      but has no AI, can't be hurt and pushes nobody. A real mob can't be
//      used: a script can't switch its AI off, so a creeper would explode at
//      people and none of them exist on Peaceful.
//
// The body is pushed to the player every tick rather than teleported: the
// game animates a mob's legs from how far it actually travels, and a teleport
// travels nowhere. It is snapped to them when it falls behind, and remade if
// it disappears. While they are vanished the body goes away too, and comes
// back when they reappear.
//
// A disguise ends with `/disguise off`, a factory reset, or leaving the game.
// It stays through death and dimension changes.

const REASON = "disguise"
const OFF = "off"
/** On each body: `ap:disguise:<playerId>`, so a body can always find its owner. */
const TAG = "ap:disguise"
const FAMILY = "adminplus_disguise"

/** playerId -> { mob, name, by, at } */
const disguised = new Table("disguises", {})
/** playerId -> the body, for this session. */
const bodies = new Map()
/** playerId -> ticks the body has been too far behind. */
const behind = new Map()

const mobEnum = defineEnum("disguise", [OFF, ...DISGUISES.map(d => d.id)])
const byId = new Map(DISGUISES.map(d => [d.id, d]))

/** "a Creeper", "an Enderman". */
export function aMob(name) { return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}` }

function typeExists(id) {
    try { return typeof EntityTypes?.get !== "function" || !!EntityTypes.get(id) } catch { return true }
}

/**
 * The mobs this world can show: the body must be in the pack, and the mob in
 * the running game. A mob newer than the game has nothing to look like.
 */
export function availableDisguises() {
    return DISGUISES.filter(d => typeExists(d.entity) && typeExists(`minecraft:${d.look}`))
}

export function disguiseOf(playerOrId) {
    const id = typeof playerOrId === "string" ? playerOrId : playerOrId?.id
    const entry = disguised.get(id)
    return entry ? byId.get(entry.mob) : undefined
}

export function disguisedCount() { return disguised.ids().length }

const isValid = entity => {
    try { return typeof entity?.isValid === "function" ? entity.isValid() : !!entity?.isValid } catch { return false }
}

function allDimensions() {
    let ids = []
    try { ids = DimensionTypes.getAll().map(t => t.typeId) } catch { /* older runtime */ }
    if (!ids.length) ids = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]
    return ids.map(id => { try { return world.getDimension(id) } catch { return undefined } }).filter(Boolean)
}

/** Every body in the loaded world, with the player it belongs to. */
function allBodies() {
    const found = []
    for (const dimension of allDimensions()) {
        let list = []
        try { list = dimension.getEntities({ families: [FAMILY] }) } catch { /* unloaded */ }
        // The families filter needs the entity registry; the type prefix is the backstop.
        if (!list.length) {
            try { list = dimension.getEntities().filter(e => String(e.typeId).startsWith(DISGUISE_PREFIX)) } catch { list = [] }
        }
        for (const entity of list) {
            if (!String(entity.typeId).startsWith(DISGUISE_PREFIX)) continue
            let owner
            try { owner = entity.getTags().find(t => t.startsWith(`${TAG}:`))?.slice(TAG.length + 1) } catch { /* gone */ }
            found.push({ entity, owner })
        }
    }
    return found
}

/** Remove a player's body, wherever it is. */
function removeBody(playerId) {
    const cached = bodies.get(playerId)
    bodies.delete(playerId)
    behind.delete(playerId)
    if (cached && isValid(cached)) { try { cached.remove() } catch { /* gone */ } }
    for (const { entity, owner } of allBodies()) {
        if (owner === playerId) { try { entity.remove() } catch { /* gone */ } }
    }
}

const reported = new Set()
function report(message) {
    if (reported.has(message)) return
    reported.add(message)
    console.warn(`[Admin+] disguise: ${message}`)
}

function makeBody(player) {
    const entry = disguised.get(player.id)
    const mob = entry && byId.get(entry.mob)
    if (!mob) return undefined
    try {
        const body = player.dimension.spawnEntity(mob.entity, player.location)
        body.addTag(`${TAG}:${player.id}`)
        try { body.setRotation(player.getRotation()) } catch { /* turns on the next tick */ }
        bodies.set(player.id, body)
        return body
    } catch (e) {
        // An unloaded chunk is normal and passes; anything else is worth one line.
        report(`could not make a ${entry.mob} for ${player.name}: ${e}`)
        return undefined
    }
}

/** How far behind (squared blocks) the body may be before the ticks start counting. */
const BEHIND = 0.25
/** Ticks behind before it is snapped to the player. */
const SNAP_AFTER = 5
/** Further than this (squared) and it is snapped at once: a teleport, a fall. */
const FAR = 16

/** Bring a player's body to them: pushed, so its legs walk; snapped when it can't keep up. */
function follow(player, body) {
    try {
        const to = player.location
        const rotation = player.getRotation()
        if (body.dimension?.id !== player.dimension?.id) {
            body.teleport(to, { dimension: player.dimension, rotation })
            behind.delete(player.id)
            return
        }
        const at = body.location
        const dx = to.x - at.x, dy = to.y - at.y, dz = to.z - at.z
        const gap = dx * dx + dy * dy + dz * dz
        const ticks = gap > BEHIND ? (behind.get(player.id) ?? 0) + 1 : 0
        if (gap > FAR || ticks > SNAP_AFTER) {
            body.teleport(to, { rotation })
            behind.delete(player.id)
            return
        }
        behind.set(player.id, ticks)
        body.clearVelocity()
        body.applyImpulse({ x: dx, y: dy, z: dz })
        body.setRotation(rotation)
    } catch {
        // The body went between the check and the move: the next tick makes one.
    }
}

/** One tick: every disguised player's body, where it should be. */
export function followAll() {
    if (!disguisedCount()) return
    for (const player of world.getAllPlayers()) {
        if (!disguised.get(player.id)) continue
        if (isVanished(player)) {
            if (bodies.has(player.id)) removeBody(player.id)
            continue
        }
        let body = bodies.get(player.id)
        if (!body || !isValid(body)) body = makeBody(player)
        if (body) follow(player, body)
    }
}

/** Same entity? Compared by id: the game may hand back a new object for the same one. */
const same = (a, b) => !!a && !!b && (a === b || (a.id !== undefined && a.id === b.id))

/** Bodies with nobody behind them: a disguise that ended while their chunk was away. */
export function sweep() {
    const online = new Set(world.getAllPlayers().map(p => p.id))
    const seen = new Set()
    for (const { entity, owner } of allBodies()) {
        const wanted = owner && online.has(owner) && disguised.get(owner) && !isVanished(owner)
        const theirs = wanted && (!bodies.has(owner) || same(bodies.get(owner), entity))
        if (!theirs || seen.has(owner)) { try { entity.remove() } catch { /* gone */ } continue }
        seen.add(owner)
        bodies.set(owner, entity)
    }
}

/**
 * Disguise a player as a mob. Switching mobs swaps the body. `by` is who did
 * it, for the record.
 */
export function disguise(player, mobId, by = player) {
    const mob = byId.get(mobId)
    if (!mob) return { ok: false, reason: "There's no mob by that name." }
    const switched = !!disguised.get(player.id)
    if (switched) removeBody(player.id)
    disguised.set(player.id, { mob: mob.id, name: player.name, by: by?.id ?? null, at: Date.now() })
    hide(player, REASON)
    if (!isVanished(player)) makeBody(player)
    return { ok: true, mob, switched }
}

/** Take a disguise off. `visible` is false while they are still vanished. */
export function undisguise(player) {
    const entry = disguised.get(player.id)
    if (!entry) return { ok: false, reason: "That player isn't disguised." }
    // A mob that has since left the list still comes off.
    const mob = byId.get(entry.mob) ?? { id: entry.mob, name: entry.mob }
    disguised.delete(player.id)
    removeBody(player.id)
    const visible = unhide(player, REASON)
    if (visible) refreshNameTag(player)
    return { ok: true, mob, visible }
}

/** Factory reset: everybody back to themselves, every body gone. */
export function endAllDisguises() {
    let ended = 0
    for (const player of world.getAllPlayers()) {
        if (disguised.get(player.id) && undisguise(player).ok) ended++
    }
    for (const { entity } of allBodies()) { try { entity.remove() } catch { /* gone */ } }
    bodies.clear()
    behind.clear()
    return ended
}

/**
 * Joining with a disguise still on the books: they left, or the world closed,
 * while disguised. It ends, so nobody joins as a mob without knowing.
 */
export function onJoin(player) {
    if (!disguised.get(player.id)) return
    const { ok: ended, mob } = undisguise(player)
    if (ended) info(player, `§7Your ${mob.name} disguise ended when you left.`)
}

/** Leaving: the body goes now. The disguise ends when they come back (onJoin). */
export function onLeave(playerId) {
    removeBody(playerId)
}

// ------------------------------------------------------------------ command

/** The mob list, as buttons: on land, then in the water. */
async function pickDisguise(player) {
    const mobs = availableDisguises()
    const water = new Set(["cod", "dolphin", "elder_guardian", "glow_squid", "guardian", "nautilus", "pufferfish", "salmon", "squid", "tadpole", "tropical_fish", "zombie_nautilus"])
    const button = mob => ({ text: `§f${mob.name}`, run: () => mob.id })
    const current = disguiseOf(player)
    return menu(player, {
        title: hubTitle("actions", "Disguise"),
        body: subtitle(current
            ? `You're ${aMob(current.name)}. Pick another mob, or take it off.`
            : "Pick a mob to become. Flying mobs aren't here: they'd\nneed you to fly."),
        buttons: [
            ...(current ? [{ text: "§cTake the disguise off", run: () => OFF }] : []),
            { label: "§lOn land" },
            ...mobs.filter(m => !water.has(m.id)).map(button),
            { label: "§lIn the water" },
            ...mobs.filter(m => water.has(m.id)).map(button)
        ]
    })
}

command({
    name: "disguise",
    description: "Disguise yourself or another player as a mob",
    perm: DISGUISE,
    mandatory: [{ name: mobEnum, type: CustomCommandParamType.Enum, label: "Which mob?", ask: pickDisguise }],
    optional: [{ name: "player", type: CustomCommandParamType.PlayerSelector }],
    run: (player, [mobId, selected]) => {
        const shut = trollBlockedBy(player, DISGUISE)
        if (shut) return err(player, shut)

        const targets = selected?.length ? selected : [player]
        const id = String(mobId ?? "").toLowerCase()
        const mob = byId.get(id)
        if (id !== OFF && (!mob || !availableDisguises().includes(mob))) {
            return err(player, mob ? `This version of the game has no ${mob.name}.` : "There's no mob by that name.")
        }

        const blocked = []
        for (const target of targets) {
            if (target.id !== player.id && !canTrollOn(player, target)) { blocked.push(displayName(target)); continue }
            const self = target.id === player.id

            if (id === OFF) {
                const result = undisguise(target)
                if (!result.ok) { err(player, self ? "You aren't disguised." : `${displayName(target)} isn't disguised.`); continue }
                record(player, "troll.undisguise", target, result.mob.name)
                const still = result.visible ? "" : " §7You're still vanished."
                if (self) ok(player, `You're yourself again.${still}`)
                else {
                    ok(player, `${displayName(target)} is themselves again.`)
                    info(target, "§7Staff took your disguise off.")
                }
                continue
            }

            disguise(target, mob.id, player)
            record(player, "troll.disguise", target, mob.name)
            const vanished = isVanished(target) ? " §7You're vanished, so it shows once you come back." : ""
            if (self) ok(player, `You're ${aMob(mob.name)} now. §7/disguise off turns you back.${vanished}`)
            else {
                ok(player, `${displayName(target)} is ${aMob(mob.name)} now.`)
                info(target, `§7Staff disguised you as ${aMob(mob.name)}.`)
            }
        }
        if (blocked.length) err(player, `Skipped because they outrank you: §f${blocked.join(", ")}`)
    }
})

export function installDisguise() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (initialSpawn) onJoin(player)
    })
    world.afterEvents.playerLeave.subscribe(({ playerId }) => onLeave(playerId))
    system.runInterval(() => followAll(), 1)
    // A body met as its chunk loads, whose disguise is over.
    try {
        world.afterEvents?.entityLoad?.subscribe?.(({ entity }) => {
            if (!String(entity?.typeId).startsWith(DISGUISE_PREFIX)) return
            let owner
            try { owner = entity.getTags().find(t => t.startsWith(`${TAG}:`))?.slice(TAG.length + 1) } catch { /* gone */ }
            if (!owner || !disguised.get(owner) || !same(bodies.get(owner), entity)) { try { entity.remove() } catch { /* gone */ } }
        })
    } catch { /* older runtime: the sweep catches them */ }
    // The slow sweep, and one shortly after load for bodies left from last time.
    system.runTimeout(() => sweep(), 40)
    system.runInterval(() => sweep(), 200)
}

export { TAG as DISGUISE_TAG }
