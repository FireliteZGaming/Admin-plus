import { readFileSync, existsSync } from "fs"
import { __test, world } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { NS } from "../Admin+ BP/scripts/config.js"
import { onPlayerJoin, setRanks, applyPreset as applyRankPreset, refreshNameTag, whereToGrant } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { isHidden, hiddenFor } from "../Admin+ BP/scripts/core/hiding.js"
import { vanish, unvanish, isVanished } from "../Admin+ BP/scripts/core/vanish.js"
import { DISGUISES, DISGUISE_PREFIX } from "../Admin+ BP/scripts/core/disguises.js"
import {
    disguise, undisguise, disguiseOf, followAll, sweep, onJoin, onLeave, endAllDisguises,
    availableDisguises, aMob, DISGUISE_TAG
} from "../Admin+ BP/scripts/features/disguise.js"
import { phraseOf } from "../Admin+ BP/scripts/features/logbook.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"

// /disguise (2.12.8, Beta). The user, 2026-11-14: "add a /disguise that lets
// you disguise as anything. Sorta like a morph mod, it uses the same technique
// as vanish, but without leaving the game. Of course using /vanish to
// disappear and appear should not affect your current effects or
// invisibility ... skip flying mobs."

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const full = name => `${NS}:${name}`
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const plain = s => String(s ?? "").replace(/§./g, "")
const BETA_ITEM = { id: "adminplus:channel_beta" }
function setBeta(on) {
    const at = __test.itemTypes.indexOf(BETA_ITEM)
    if (on && at < 0) __test.itemTypes.push(BETA_ITEM)
    if (!on && at >= 0) __test.itemTypes.splice(at, 1)
}
__test.runStartup()
applyRankPreset("server")

let nextId = 1
function fakePlayer(name, ranks) {
    const tags = new Set()
    const effects = new Map()
    const p = {
        id: `dg${nextId++}`, name, nameTag: name, commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, rotation: { x: 10, y: 90 },
        dimension: __test.dimension, heard: [], effects,
        getTags: () => [...tags], hasTag: t => tags.has(t),
        addTag: t => tags.has(t) ? false : (tags.add(t), true), removeTag: t => tags.delete(t),
        sendMessage: m => p.heard.push(plain(m)),
        getRotation: () => ({ ...p.rotation }),
        getEffect: type => effects.has(type) ? { ...effects.get(type) } : undefined,
        addEffect: (type, duration, options = {}) => { effects.set(type, { duration, amplifier: options.amplifier ?? 0 }) },
        removeEffect: type => effects.delete(type)
    }
    __test.players.push(p)
    onPlayerJoin(p)
    setRanks(p.id, ranks, p.name)
    return p
}
const bodiesOf = p => __test.spawned.filter(e => e.getTags().includes(`${DISGUISE_TAG}:${p.id}`))

const owner = fakePlayer("Firelite", ["owner"])
const manager = fakePlayer("Kai", ["manager"])
const steve = fakePlayer("Steve", ["member"])

console.log("\n— vanish lends effects and gives them back —")
{
    // A potion of invisibility with 30 seconds left, before vanishing.
    owner.effects.set("invisibility", { duration: 600, amplifier: 0 })
    owner.effects.set("night_vision", { duration: 1200, amplifier: 0 })
    setSetting("vanish.nightVision", "true")
    vanish(owner)
    check("vanish hides them", owner.effects.get("invisibility")?.duration, 20000000)
    check("and lends night vision", owner.effects.get("night_vision")?.duration, 20000000)
    unvanish(owner)
    check("coming back gives the potion's invisibility back", owner.effects.get("invisibility"), { duration: 600, amplifier: 0 })
    check("and their own night vision", owner.effects.get("night_vision"), { duration: 1200, amplifier: 0 })
    owner.effects.clear()
    vanish(owner)
    unvanish(owner)
    check("with nothing of their own, nothing is left on them", [...owner.effects.keys()], [])
    check("and they are no longer hidden", isHidden(owner), false)
    resetSetting("vanish.nightVision")
}

console.log("\n— Beta only, and behind its own switch —")
{
    setBeta(false)
    owner.heard.length = 0
    __test.invoke(full("disguise"), owner, "creeper")
    await settle()
    check("Default says it's in Beta", owner.heard.some(m => m.includes("Disguises are in Beta")), true)
    check("and makes nothing", bodiesOf(owner).length, 0)
    setBeta(true)
    check("it's a Pranks switch on the rank", whereToGrant("admin.disguise"), "Ranks ▸ the rank ▸ Permissions ▸ Administrative ▸ Pranks ▸ disguise")
    const before = __test.spawned.length
    __test.invoke(full("disguise"), steve, "creeper")
    await settle()
    check("a member without the switch makes nothing", __test.spawned.length, before)
}

console.log("\n— the mobs —")
{
    const flying = ["allay", "bat", "bee", "blaze", "ender_dragon", "ghast", "happy_ghast", "parrot", "phantom", "vex", "wither"]
    check("no flying mob is on the list", DISGUISES.filter(d => flying.includes(d.id) || flying.includes(d.look)).map(d => d.id), [])
    check("every walking and swimming mob is", DISGUISES.length, 76)
    check("names read like the game's", ["creeper", "villager", "zombified_piglin", "evoker", "tropical_fish"].map(id => DISGUISES.find(d => d.id === id)?.name), ["Creeper", "Villager", "Zombified Piglin", "Evoker", "Tropical Fish"])
    check("a or an", [aMob("Creeper"), aMob("Enderman"), aMob("Iron Golem")], ["a Creeper", "an Enderman", "an Iron Golem"])

    const bp = id => JSON.parse(readFileSync(new URL(`../Admin+ BP/entities/disguise/${id}.json`, import.meta.url), "utf8"))
    const rp = id => readFileSync(new URL(`../Admin+ RP/entity/disguise/${id}.entity.json`, import.meta.url), "utf8")
    check("every mob has a body and a look", DISGUISES.filter(d => !existsSync(new URL(`../Admin+ BP/entities/disguise/${d.id}.json`, import.meta.url)) || !existsSync(new URL(`../Admin+ RP/entity/disguise/${d.id}.entity.json`, import.meta.url))).map(d => d.id), [])
    check("with matching names", DISGUISES.filter(d => bp(d.id)["minecraft:entity"].description.identifier !== `${DISGUISE_PREFIX}${d.id}` || JSON.parse(rp(d.id))["minecraft:client_entity"].description.identifier !== `${DISGUISE_PREFIX}${d.id}`).map(d => d.id), [])
    const components = DISGUISES.map(d => bp(d.id)["minecraft:entity"].components)
    check("no body has any AI", components.filter(c => Object.keys(c).some(k => k.startsWith("minecraft:behavior.") || k.startsWith("minecraft:navigation"))).length, 0)
    check("none can be hurt", components.every(c => c["minecraft:damage_sensor"]?.triggers?.deals_damage === false), true)
    check("none can be pushed", components.every(c => c["minecraft:pushable"]?.is_pushable === false), true)
    check("each is in Admin+'s own family, which no mob hunts", components.every(c => String(c["minecraft:type_family"]?.family) === "adminplus_disguise,inanimate"), true)
    check("each has a hitbox too small to stop a hit on the player inside", components.every(c => c["minecraft:collision_box"]?.width <= 0.01), true)
    check("no look reads a property only the game's own mobs have", DISGUISES.filter(d => /property\(\s*['"]minecraft:/.test(rp(d.id))).map(d => d.id), [])
    check("no look copies a model or texture into Admin+", existsSync(new URL("../Admin+ RP/models/entity/disguise", import.meta.url)), false)
    // Every variable a look's own formulas read is set in that look: reading
    // one that was never set is an error in the game.
    const unset = DISGUISES.filter(d => {
        const scripts = JSON.parse(rp(d.id))["minecraft:client_entity"].description.scripts ?? {}
        const text = JSON.stringify(scripts)
        const read = new Set([...text.matchAll(/\b(?:variable|v)\.([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()))
        const set = new Set([...text.matchAll(/\b(?:variable|v)\.([a-z_][a-z0-9_]*)\s*=(?!=)/gi)].map(m => m[1].toLowerCase()))
        return [...read].some(name => !set.has(name))
    }).map(d => d.id)
    check("every variable a look reads, it sets", unset, [])
    const lang = readFileSync(new URL("../Admin+ RP/texts/en_US.lang", import.meta.url), "utf8")
    check("each has a name in the language file", DISGUISES.every(d => lang.includes(`entity.${DISGUISE_PREFIX}${d.id}.name=${d.name}`)), true)

    __test.missingTypes.add("minecraft:sulfur_cube")
    check("a mob the running game lacks isn't offered", availableDisguises().some(d => d.id === "sulfur_cube"), false)
    owner.heard.length = 0
    __test.invoke(full("disguise"), owner, "sulfur_cube")
    await settle()
    check("and says so", owner.heard.some(m => m.includes("This version of the game has no Sulfur Cube.")), true)
    __test.missingTypes.delete("minecraft:sulfur_cube")
}

console.log("\n— becoming a creeper —")
{
    owner.heard.length = 0
    __test.invoke(full("disguise"), owner, "creeper")
    await settle()
    const body = bodiesOf(owner)[0]
    check("a creeper body appears", body?.typeId, "adminplus:disguise_creeper")
    check("where they stand", body?.location, owner.location)
    check("facing their way", body?.rotation, owner.rotation)
    check("they are hidden for the disguise", hiddenFor(owner), ["disguise"])
    check("invisible", owner.effects.get("invisibility")?.duration, 20000000)
    check("with no name above them", owner.nameTag, "")
    check("and no 'left the game' line", owner.heard.some(m => m.includes("left the game")), false)
    check("they're told how to stop", owner.heard.some(m => m.includes("You're a Creeper now.") && m.includes("/disguise off")), true)
    check("it's in the log", [recent(1)[0]?.action, recent(1)[0]?.detail], ["troll.disguise", "Creeper"])
    check("in words", phraseOf(recent(1)[0]), "disguised as a Creeper")
    refreshNameTag(owner)
    check("a name refresh leaves the name off", owner.nameTag, "")
}

console.log("\n— the body walks with them —")
{
    const body = bodiesOf(owner)[0]
    owner.location = { x: 0.3, y: 64, z: 0.1 }
    owner.rotation = { x: -20, y: 180 }
    followAll()
    check("pushed, so its legs walk, not teleported", body.impulses.length > 0, true)
    check("and it arrives", body.location, owner.location)
    check("turned with them", body.rotation, { x: -20, y: 180 })
    owner.location = { x: 80, y: 70, z: -40 }
    const pushes = body.impulses.length
    followAll()
    check("far away, it is snapped to them", [body.location, body.impulses.length], [owner.location, pushes])
    const nether = world.getDimension("minecraft:nether")
    owner.dimension = nether
    followAll()
    check("into the Nether with them", body.dimension.id, "minecraft:nether")
    owner.dimension = __test.dimension
    followAll()
    body.remove()
    followAll()
    check("a body that disappears is made again", bodiesOf(owner).length, 1)
}

console.log("\n— vanish and disguise together —")
{
    vanish(owner)
    followAll()
    check("vanishing takes the body away too", bodiesOf(owner).length, 0)
    check("hidden for both", hiddenFor(owner).sort(), ["disguise", "vanish"])
    const back = unvanish(owner)
    check("coming out of vanish leaves them hidden in the disguise", [back.visible, isHidden(owner), owner.effects.has("invisibility")], [false, true, true])
    followAll()
    check("and the body comes back", bodiesOf(owner).length, 1)
}

console.log("\n— switching mobs, and turning back —")
{
    __test.invoke(full("disguise"), owner, "zombie")
    await settle()
    check("one body, now a zombie", bodiesOf(owner).map(e => e.typeId), ["adminplus:disguise_zombie"])
    owner.heard.length = 0
    __test.invoke(full("disguise"), owner, "off")
    await settle()
    check("off takes the body away", bodiesOf(owner).length, 0)
    check("and shows them again", [isHidden(owner), owner.effects.has("invisibility"), owner.hasTag("ap:vanished")], [false, false, false])
    check("with their name back", owner.nameTag !== "", true)
    check("they're told", owner.heard.some(m => m.includes("You're yourself again.")), true)
    check("logged as stopping", phraseOf(recent(1)[0]), "stopped being a Zombie")
}

console.log("\n— disguising someone else —")
{
    owner.heard.length = 0
    __test.invoke(full("disguise"), owner, "pig", [steve])
    await settle()
    check("a member becomes a pig", disguiseOf(steve)?.id, "pig")
    check("and is told", steve.heard.some(m => m.includes("Staff disguised you as a Pig.")), true)
    check("logged with both names", phraseOf(recent(1)[0]), "disguised Steve as a Pig")
    manager.heard.length = 0
    __test.invoke(full("disguise"), manager, "cow", [owner])
    await settle()
    check("nobody disguises someone who outranks them", [disguiseOf(owner), manager.heard.some(m => m.includes("outrank you"))], [undefined, true])
}

console.log("\n— leaving, coming back, and strays —")
{
    onLeave(steve.id)
    check("leaving takes the body away", bodiesOf(steve).length, 0)
    steve.heard.length = 0
    onJoin(steve)
    check("coming back, the disguise has ended", [disguiseOf(steve), isHidden(steve)], [undefined, false])
    check("and they're told", steve.heard.some(m => m.includes("Your Pig disguise ended when you left.")), true)

    const stray = __test.dimension.spawnEntity("adminplus:disguise_wolf", { x: 5, y: 64, z: 5 })
    stray.addTag(`${DISGUISE_TAG}:nobody`)
    sweep()
    check("a body whose disguise is over is cleared away", __test.spawned.includes(stray), false)

    disguise(steve, "spider", owner)
    followAll()
    check("ready", bodiesOf(steve).length, 1)
    const ended = endAllDisguises()
    check("factory reset turns everyone back", [ended, disguiseOf(steve), isHidden(steve), bodiesOf(steve).length], [1, undefined, false, 0])
}

console.log("\n— the mob list, asked for —")
{
    __ui.shown.length = 0
    __ui.answers.push({ canceled: true })
    __test.invoke(full("disguise"), owner)
    await settle()
    const form = __ui.shown.at(-1)
    const labels = form?.parts.filter(p => p[0] === "label").map(p => plain(p[1]))
    const buttons = form?.parts.filter(p => p[0] === "button").map(p => plain(p[1]))
    check("on land, then in the water", labels, ["On land", "In the water"])
    check("every mob is a button", buttons?.length, availableDisguises().length)
    check("by name", buttons?.includes("Iron Golem"), true)
}

setBeta(false)
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
