import { world, system } from "@minecraft/server"
import { Table } from "./storage.js"

// Hiding a player (2.12.8): one layer that vanish and disguise both stand on.
//
// Each feature hides a player for its own REASON, and the player shows again
// only when no reason is left: coming out of vanish while disguised keeps you
// hidden inside the disguise. The user, 2026-11-14: "using /vanish to
// disappear and appear should not affect your current effects or
// invisibility".
//
// So effects are borrowed, never taken. The invisibility a player already had
// before the first reason (a potion, say) is remembered and given back with
// the time it had left once the last reason ends, and night vision the same
// way. Before 2.12.8, coming out of vanish removed both outright.
//
// What does the hiding is vanish's technique (the history is in
// core/vanish.js): the invisibility effect, which alone leaves armour and held
// items showing; a resource-pack animation that shrinks every bone to nothing,
// armour and items included, re-stamped every tick because it lapses on its
// own; and an empty nametag.

/** Marks a player Admin+ hid. Vanish's own name, kept: worlds already carry it. */
const TAG = "ap:vanished"
const ANIMATION = "animation.adminplus.vanish"
/** How long the animation survives once told to stop. A fade-OUT, not a fade-in. */
const BLEND_OUT = 0.5
/** The longest an effect can be given for. */
const FOREVER = 20000000

/** playerId -> { name, reasons: { [reason]: { nightVision } }, kept: { [effect]: { duration, amplifier, at } } } */
const records = new Table("hidden", {})

function idOf(playerOrId) {
    return typeof playerOrId === "string" ? playerOrId : playerOrId?.id
}

/** Is this player hidden, for this reason or for any? */
export function isHidden(playerOrId, reason) {
    const record = records.get(idOf(playerOrId))
    if (!record) return false
    return reason ? !!record.reasons?.[reason] : Object.keys(record.reasons ?? {}).length > 0
}

/** Why a player is hidden: "vanish", "disguise", or both. */
export function hiddenFor(playerOrId) {
    return Object.keys(records.get(idOf(playerOrId))?.reasons ?? {})
}

export function hiddenCount() { return records.ids().length }

const wantsNightVision = record => Object.values(record.reasons ?? {}).some(r => r?.nightVision)

/** The effect as it is now, to give back later, or undefined. */
function snapshot(player, type) {
    try {
        const effect = player.getEffect(type)
        if (!effect) return undefined
        return { duration: effect.duration, amplifier: effect.amplifier ?? 0, at: Date.now() }
    } catch { return undefined }
}

/** Give a remembered effect back with the time it had left. */
function giveBack(player, type, kept) {
    try { player.removeEffect(type) } catch { /* left */ }
    if (!kept) return
    const spent = Math.floor((Date.now() - (kept.at ?? Date.now())) / 50)
    // A duration below 0 is an effect with no end; it never runs down.
    const left = kept.duration < 0 ? FOREVER : kept.duration - spent
    if (left <= 0) return
    try { player.addEffect(type, Math.min(left, FOREVER), { amplifier: kept.amplifier ?? 0 }) } catch { /* left */ }
}

function stamp(player) {
    try {
        // From the DIMENSION, not the player: player.runCommand inherits the
        // player's own permission level, so staff without operator could not
        // hide themselves.
        player.dimension.runCommand(`playanimation "${player.name}" ${ANIMATION} none ${BLEND_OUT} "true"`)
    } catch {
        // The animation is in the resource pack. Without it the player is still
        // invisible, with armour showing: degraded, not broken.
    }
}

function applyEffects(player, record) {
    try {
        player.addTag(TAG)
        player.addEffect("invisibility", FOREVER, { amplifier: 0, showParticles: false })
        if (wantsNightVision(record)) player.addEffect("night_vision", FOREVER, { amplifier: 0, showParticles: false })
        player.nameTag = ""
    } catch (e) {
        console.warn(`[Admin+] hiding failed for ${player.name}: ${e}`)
    }
    stamp(player)
}

/**
 * Hide a player for a reason. `nightVision` lends night vision too (vanish's
 * setting). `keep: false` remembers no effects: for a player Admin+ hid before
 * this layer existed, whose invisibility is Admin+'s own already.
 */
export function hide(player, reason, { nightVision = false, keep = true } = {}) {
    const record = records.get(player.id) ?? { name: player.name, reasons: {}, kept: {} }
    const first = !Object.keys(record.reasons).length
    const nightBefore = wantsNightVision(record)
    if (keep && first) record.kept.invisibility = snapshot(player, "invisibility")
    if (keep && nightVision && !nightBefore) record.kept.night_vision = snapshot(player, "night_vision")
    record.name = player.name
    record.reasons[reason] = { nightVision: !!nightVision, at: Date.now() }
    records.set(player.id, record)
    applyEffects(player, record)
}

/**
 * End one reason. Effects lent for it go back to what the player had, and the
 * player shows again once no reason is left. Returns true when they are now
 * visible; the caller puts their nametag back.
 */
export function unhide(player, reason) {
    const record = records.get(player.id)
    if (!record?.reasons?.[reason]) return !isHidden(player)
    const nightBefore = wantsNightVision(record)
    delete record.reasons[reason]
    if (nightBefore && !wantsNightVision(record)) {
        giveBack(player, "night_vision", record.kept.night_vision)
        delete record.kept.night_vision
    }
    if (Object.keys(record.reasons).length) {
        records.set(player.id, record)
        return false
    }
    records.delete(player.id)
    try { player.removeTag(TAG) } catch { /* left */ }
    giveBack(player, "invisibility", record.kept.invisibility)
    // The animation lapses by itself once nothing re-stamps it.
    return true
}

/** Show a player Admin+ hid when no record says why (a factory reset, a lost record). */
function release(player) {
    try {
        player.removeTag(TAG)
        player.removeEffect("invisibility")
    } catch { /* left */ }
}

export function installHiding() {
    world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
        if (isHidden(player)) {
            const record = records.get(player.id)
            // Dying clears every effect, theirs included, so there is nothing
            // of theirs left to give back.
            if (!initialSpawn) { record.kept = {}; records.set(player.id, record) }
            system.run(() => applyEffects(player, record))
            return
        }
        if (!initialSpawn) return
        let tagged = false
        try { tagged = player.hasTag(TAG) } catch { /* left */ }
        if (tagged) system.run(() => release(player))
    })

    system.runInterval(() => {
        // Nobody hidden is the normal state of a server, and this runs twenty
        // times a second for ever, so the common case is one lookup.
        if (!hiddenCount()) return
        for (const player of world.getAllPlayers()) {
            if (!isHidden(player)) continue
            // Every tick, with half a second of blend-out: the two numbers only
            // work as a pair (core/vanish.js explains the flicker it cost).
            stamp(player)
            if (player.nameTag !== "") player.nameTag = ""
        }
    }, 1)
}

export { TAG as HIDDEN_TAG, ANIMATION as HIDING_ANIMATION }
