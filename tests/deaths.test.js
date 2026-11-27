import { existsSync, readFileSync } from "node:fs"
import { __test, world } from "@minecraft/server"
import { onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { setWorldTerms } from "../Admin+ BP/scripts/core/terms.js"
import { hide, unhide } from "../Admin+ BP/scripts/core/hiding.js"
import { deathKey, deathMessage, killerOf, ALONE, BY, BY_PLAYER, SHOT, THROWN, GENERIC } from "../Admin+ BP/scripts/core/deaths.js"
import { onPlayerDeath, reconcileDeathRule, sayingDeaths } from "../Admin+ BP/scripts/features/deaths.js"

// 3.1.9, the user, 2026-11-27: "death messages should do nicknames too ...
// nicknames for some reason didn't apply to death messages". Admin+ says the
// game's own death messages, by the game's own keys so every player reads
// them in their own language, with display names where the gamertags were,
// and keeps the game's own off while it does. Every check calls the real code.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const sent = []
world.sendMessage = m => sent.push(m)
world.gameRules = { showDeathMessages: true }

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `de${nextId++}`, name, nameTag: name, typeId: "minecraft:player", commandPermissionLevel: 0,
        getTags: () => [...tags], addTag: t => { tags.add(t); return true }, removeTag: t => tags.delete(t),
        getEffect: () => undefined, addEffect: () => true, removeEffect: () => true,
        sendMessage: () => {}, dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const zombie = { typeId: "minecraft:zombie", nameTag: "" }
/** The message's key and the names in it, for reading. */
const parts = m => [m?.rawtext?.[0]?.translate, ...(m?.rawtext?.[0]?.with?.rawtext ?? []).map(n => n.text ?? `<${n.translate}>`)]

applyPreset("server")
const nova = fakePlayer("NovaGamertag")
setNickname(nova, "§c§lFirelite")
const sam = fakePlayer("SamGamertag")
setNickname(sam, "§bSam")

console.log("\n— the game's own words, chosen by what killed them —")
check("a fall", deathKey("fall"), "death.attack.fall")
check("drowning", deathKey("drowning"), "death.attack.drown")
check("lava", deathKey("lava"), "death.attack.lava")
check("the void", deathKey("void"), "death.attack.outOfWorld")
check("a mob", deathKey("entityAttack", { blamed: true }), "death.attack.mob")
check("a player", deathKey("entityAttack", { blamed: true, killerIsPlayer: true }), BY_PLAYER)
check("an arrow", deathKey("projectile", { blamed: true, projectile: "minecraft:arrow" }), "death.attack.arrow")
check("a trident", deathKey("projectile", { blamed: true, projectile: "minecraft:thrown_trident" }), "death.attack.trident")
check("anything else thrown, such as a snowball", deathKey("projectile", { blamed: true, projectile: "minecraft:snowball" }), THROWN)
check("a creeper", deathKey("entityExplosion", { blamed: true }), "death.attack.explosion.player")
check("an explosion with nobody to blame", deathKey("entityExplosion"), "death.attack.explosion")
check("an attack with nobody to name says they died, as the game does", deathKey("entityAttack"), GENERIC)
check("a cause it doesn't know says they died", deathKey("somethingNew"), GENERIC)

console.log("\n— every key is one the game has —")
{
    const lang = "C:/XboxGames/Minecraft for Windows/Content/data/resource_packs/vanilla/texts/en_US.lang"
    const keys = [...new Set([...Object.values(ALONE), ...Object.values(BY), BY_PLAYER, ...Object.values(SHOT), THROWN, GENERIC])]
    if (existsSync(lang)) {
        const have = new Set(readFileSync(lang, "utf8").split(/\r?\n/).map(line => line.split("=")[0]))
        check(`all ${keys.length} keys are in the game's en_US.lang, so none shows as a raw key`, keys.filter(k => !have.has(k)), [])
    } else {
        console.log(`  skip the game's en_US.lang isn't on this computer (${keys.length} keys not checked)`)
    }
}

console.log("\n— the names: display names, and mobs in the reader's language —")
check("a player is named by display name, without its colour", killerOf(sam, p => p === sam ? "§bSam" : ""), { text: "Sam" })
check("a mob by its kind, in each reader's own language", killerOf(zombie), { translate: "entity.zombie.name" })
check("a mob with a name tag by that name", killerOf({ typeId: "minecraft:wolf", nameTag: "§6Rex" }), { text: "Rex" })
check("another pack's mob by its full id", killerOf({ typeId: "ns:dragon", nameTag: "" }), { translate: "entity.ns:dragon.name" })
check("nobody, nothing", killerOf(undefined), undefined)
check("slain by a zombie", parts(deathMessage("§c§lFirelite", "entityAttack", { killer: killerOf(zombie) })),
    ["death.attack.mob", "Firelite", "<entity.zombie.name>"])
check("a fall names only them, even with someone nearby", parts(deathMessage("Firelite", "fall", { killer: killerOf(zombie) })),
    ["death.attack.fall", "Firelite"])

console.log("\n— a death, said by Admin+ —")
check("on by default", sayingDeaths(), true)
{
    sent.length = 0
    const said = onPlayerDeath({ deadEntity: nova, damageSource: { cause: "entityAttack", damagingEntity: sam } })
    check("slain by a player: both by display name", parts(said), [BY_PLAYER, "Firelite", "Sam"])
    check("the gamertags appear nowhere", JSON.stringify(said).includes("Gamertag"), false)
    check("said to everyone", sent.length, 1)
    sent.length = 0
    check("shot by a skeleton", parts(onPlayerDeath({ deadEntity: nova, damageSource: {
        cause: "projectile", damagingEntity: { typeId: "minecraft:skeleton", nameTag: "" }, damagingProjectile: { typeId: "minecraft:arrow" } } })),
        ["death.attack.arrow", "Firelite", "<entity.skeleton.name>"])
    check("an arrow with nobody behind it is named itself", parts(onPlayerDeath({ deadEntity: nova, damageSource: {
        cause: "projectile", damagingProjectile: { typeId: "minecraft:arrow", nameTag: "" } } })),
        ["death.attack.arrow", "Firelite", "<entity.arrow.name>"])
    check("a mob's death isn't said", onPlayerDeath({ deadEntity: zombie, damageSource: { cause: "fall" } }), undefined)
}
{
    hide(nova, "vanish")
    sent.length = 0
    check("a hidden player dies unannounced", [onPlayerDeath({ deadEntity: nova, damageSource: { cause: "fall" } }), sent.length], [undefined, 0])
    unhide(nova, "vanish")
}
{
    setSetting("presence.deaths", "false")
    sent.length = 0
    check("switched off, Admin+ says nothing", [onPlayerDeath({ deadEntity: nova, damageSource: { cause: "fall" } }), sent.length], [undefined, 0])
    resetSetting("presence.deaths")
    setWorldTerms("declined", "test")
    check("with the terms declined, nothing either", onPlayerDeath({ deadEntity: nova, damageSource: { cause: "fall" } }), undefined)
    setWorldTerms("accepted", "test")
}

console.log("\n— the game's own death messages are off exactly while Admin+ says them —")
{
    world.gameRules.showDeathMessages = true
    reconcileDeathRule()
    check("on: the game's own are off", world.gameRules.showDeathMessages, false)
    setSetting("presence.deaths", "false")
    reconcileDeathRule()
    check("off: the game says them again", world.gameRules.showDeathMessages, true)
    world.gameRules.showDeathMessages = false
    reconcileDeathRule()
    check("a server that turned them off itself, with the switch off, keeps its choice", world.gameRules.showDeathMessages, false)
    resetSetting("presence.deaths")
    world.gameRules.showDeathMessages = true
    reconcileDeathRule()
    check("on again: off again", world.gameRules.showDeathMessages, false)
    setWorldTerms("declined", "test")
    reconcileDeathRule()
    check("terms declined: the game says them, as if Admin+ weren't here", world.gameRules.showDeathMessages, true)
    setWorldTerms("accepted", "test")
    reconcileDeathRule()
    check("accepted again: Admin+ says them", world.gameRules.showDeathMessages, false)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
