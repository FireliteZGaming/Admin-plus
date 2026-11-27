import { stripCodes } from "./identity.js"

// Death messages with display names (3.1.9, the user: "death messages should
// do nicknames too ... nicknames for some reason didn't apply to death
// messages").
//
// The game names a player by gamertag in its own death messages, and no
// script can change the name it uses. So Admin+ says them itself, with the
// GAME'S OWN WORDS: each message is the game's own translation key
// ("death.attack.mob" is "%1$s was slain by %2$s" in English), so every
// player reads it in their own language, and the display name stands where
// the gamertag was. features/deaths.js turns the game's own messages off while
// Admin+ says them. This file only decides the words and the names, and
// touches no game object, so Node can test it.
//
// Every key below is in the game's own en_US.lang (checked 2026-11-27 against
// 1.26.45's data/resource_packs/vanilla/texts), so none can show up as a raw
// key. A cause with no key of its own says "died", as the game does.

/** A cause with nobody to blame, and the game's words for it. */
export const ALONE = Object.freeze({
    anvil: "death.attack.anvil",
    blockExplosion: "death.attack.explosion",
    entityExplosion: "death.attack.explosion",
    campfire: "death.attack.inFire",
    soulCampfire: "death.attack.inFire",
    contact: "death.attack.cactus",
    drowning: "death.attack.drown",
    fall: "death.attack.fall",
    fallingBlock: "death.attack.fallingBlock",
    fire: "death.attack.inFire",
    fireTick: "death.attack.onFire",
    fireworks: "death.attack.fireworks",
    flyIntoWall: "death.attack.flyIntoWall",
    freezing: "death.attack.freeze",
    lava: "death.attack.lava",
    lightning: "death.attack.lightningBolt",
    magic: "death.attack.magic",
    magma: "death.attack.magma",
    sonicBoom: "death.attack.sonicBoom",
    stalactite: "death.attack.stalactite",
    stalagmite: "death.attack.stalagmite",
    starve: "death.attack.starve",
    suffocation: "death.attack.inWall",
    void: "death.attack.outOfWorld",
    wither: "death.attack.wither"
})

/** A cause with somebody or something to blame (%2$s), and the game's words. */
export const BY = Object.freeze({
    entityAttack: "death.attack.mob",
    entityExplosion: "death.attack.explosion.player",
    magic: "death.attack.indirectMagic",
    thorns: "death.attack.thorns",
    maceSmash: "death.attack.maceSmash.player",
    ramAttack: "death.attack.mob",
    charging: "death.attack.mob"
})

/** Slain by a player rather than a mob: the game says it the same way, by its own key. */
export const BY_PLAYER = "death.attack.player"

/** What hit them, for a death by projectile. Anything else thrown is "pummeled by". */
export const SHOT = Object.freeze({
    "minecraft:arrow": "death.attack.arrow",
    "minecraft:thrown_trident": "death.attack.trident",
    "minecraft:fireball": "death.attack.fireball",
    "minecraft:small_fireball": "death.attack.fireball",
    "minecraft:llama_spit": "death.attack.spit",
    "minecraft:shulker_bullet": "death.attack.bullet",
    "minecraft:wither_skull": "death.attack.mob",
    "minecraft:wither_skull_dangerous": "death.attack.mob"
})
export const THROWN = "death.attack.thrown"
export const GENERIC = "death.attack.generic"

/**
 * The game's key for a death. `cause` is the damage source's cause (its
 * EntityDamageCause value); `blamed` is true when there's a killer to name;
 * `killerIsPlayer` picks "slain by" a player; `projectile` is the type of
 * what hit them, for a death by projectile.
 */
export function deathKey(cause, { blamed = false, killerIsPlayer = false, projectile = "" } = {}) {
    if (blamed && cause === "projectile") return SHOT[projectile] ?? THROWN
    if (blamed && cause === "entityAttack" && killerIsPlayer) return BY_PLAYER
    if (blamed && BY[cause]) return BY[cause]
    return ALONE[cause] ?? GENERIC
}

/** A name as a death message shows it: its letters, without colour codes. */
export const plainName = name => stripCodes(String(name ?? ""))

/**
 * Who to blame, as a part of the message: a player by their display name, a
 * mob by the name tag it was given, or else by its kind in the reader's own
 * language ("entity.zombie.name"). `nameOf` gives a player's display name.
 * Undefined when there's nobody.
 */
export function killerOf(entity, nameOf = e => e?.name) {
    if (!entity?.typeId) return undefined
    if (entity.typeId === "minecraft:player") return { text: plainName(nameOf(entity)) }
    const tag = plainName(entity.nameTag)
    if (tag.trim()) return { text: tag }
    const id = String(entity.typeId)
    return { translate: `entity.${id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id}.name` }
}

/**
 * The whole message, ready for world.sendMessage: the game's words, the
 * victim's display name as %1$s, and who to blame as %2$s when the words
 * have a place for one.
 */
export function deathMessage(victim, cause, { killer, killerIsPlayer = false, projectile = "" } = {}) {
    const key = deathKey(cause, { blamed: !!killer, killerIsPlayer, projectile })
    const blames = key !== GENERIC && !Object.values(ALONE).includes(key)
    const names = [{ text: plainName(victim) }, ...(blames && killer ? [killer] : [])]
    return { rawtext: [{ translate: key, with: { rawtext: names } }] }
}
