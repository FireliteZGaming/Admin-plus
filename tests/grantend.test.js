import { __test, world, ItemStack } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { acceptTerms } from "../Admin+ BP/scripts/features/terms.js"
import { onPlayerJoin, applyPreset, heldRankIds, setRanks, grantRank, revokeRank } from "../Admin+ BP/scripts/core/ranks.js"
import { keepOf, dueFor, timedGrants, setExpiry } from "../Admin+ BP/scripts/core/grants.js"
import { beginGrant, runGrantChecks, sendToSpawn, __forgetLiveCopies } from "../Admin+ BP/scripts/features/grant.js"
import { enter as enterStaffMode, exit as exitStaffMode } from "../Admin+ BP/scripts/core/staffmode.js"
import { setSpawn, clearSpawn } from "../Admin+ BP/scripts/core/warps.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// 2.12.16, the user: "/grant should now have a new optional ability that you
// can choose to toggle. (they always will return to there original gamemode
// btw when the grant ends) but you can choose to have them return to there
// original inv right before they got the rank, it keeps even if they leave and
// reconnect so it will restore if it ends when they were disconnected. you can
// also to put them at spawn when it ends (if spawn isn't set it'll just put
// them at worldspawn)". And bare /grant asks who first.

const full = name => `${NS}:${name}`
let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const plain = s => String(s ?? "").replace(/§./g, "")
const titleOf = form => plain((form?.parts ?? []).find(p => p[0] === "title")?.[1])
const buttonsOf = form => (form?.parts ?? []).filter(p => p[0] === "button").map(p => plain(p[1]))
const HOUR = 60 * 60 * 1000
const item = (id, n = 1) => new ItemStack(id, n)

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const slots = new Array(36).fill(undefined)
    const worn = {}
    const p = {
        id: `ge${nextId++}`, name, nameTag: name, inbox: [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 },
        dimension: { id: "minecraft:overworld", getTopmostBlock: () => ({ location: { y: 70 } }), runCommand: () => ({ successCount: 1 }) },
        gm: "survival", teleports: [], slots, worn,
        getGameMode() { return p.gm },
        setGameMode(mode) { p.gm = mode },
        teleport(at) { p.teleports.push({ x: at.x, y: at.y, z: at.z }); p.location = { ...at } },
        addEffect() {}, removeEffect() {}, getEffect() { return undefined },
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t), hasTag: t => tags.has(t),
        sendMessage: m => p.inbox.push(plain(m)),
        getComponent(id) {
            if (id === "minecraft:inventory") return { container: { size: 36, getItem: i => slots[i], setItem: (i, s) => { slots[i] = s } } }
            if (id === "minecraft:equippable") return { getEquipment: s => worn[s], setEquipment: (s, v) => { worn[s] = v } }
            return undefined
        }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const leave = p => { const i = __test.players.indexOf(p); if (i >= 0) __test.players.splice(i, 1) }
const rejoin = p => { if (!__test.players.includes(p)) __test.players.push(p) }
const lastLine = p => p.inbox[p.inbox.length - 1] ?? ""

__test.runStartup()
applyPreset("server")
const owner = fakePlayer("Owner")
setRanks(owner.id, ["owner"], "Owner")
// 3.1.6: an owner accepts Admin+'s terms before using its commands.
acceptTerms(owner)
owner.location = { x: 100.2, y: 70, z: -40.7 }
setSpawn(owner)                       // Admin+ spawn at 100.5, 70, -40.5

console.log("\n— bare /grant asks who, then opens the Grant screen —")
const nova = fakePlayer("Nova")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.invoke(full("grant"), owner)
    await settle()
    const list = __ui.shown[0]
    check("a player list opened first", titleOf(list).includes("Grant · pick a player"), true)
    const names = buttonsOf(list)
    check("Nova is on it", names.some(n => n.includes("Nova")), true)
    check("and it can reach players who are offline", names.some(n => n.startsWith("Everyone seen")), true)

    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push({ canceled: false, selection: names.findIndex(n => n.includes("Nova")) })
    __test.invoke(full("grant"), owner)
    await settle()
    const form = __ui.shown[1]
    check("picking Nova opens the Grant screen for Nova", titleOf(form).includes("Grant · Nova"), true)
    const toggles = (form?.parts ?? []).filter(p => p[0] === "toggle").map(p => plain(p[1]).split("\n")[0])
    check("with the two switches for when it ends", toggles, ["Give back their inventory", "Send them to spawn"])
    check("both start off", (form?.parts ?? []).filter(p => p[0] === "toggle").map(p => !!p[2]?.defaultValue), [false, false])
}

console.log("\n— online: what they had comes back when it expires —")
{
    nova.slots[0] = item("minecraft:stone", 5)
    nova.slots[1] = item("minecraft:iron_sword")
    grantRank(nova.id, "mod", "Nova")
    const end = { inventory: true, spawn: true }
    setExpiry(nova.id, "mod", HOUR, owner, end)
    beginGrant(nova.id, "mod", end)
    const noted = keepOf(nova.id, "mod")
    check("the gamemode was noted", noted?.gm, "survival")
    check("and the inventory, item by item", (noted?.inv?.slots ?? []).filter(Boolean).map(s => `${s.id} x${s.n}`),
        ["minecraft:stone x5", "minecraft:iron_sword x1"])
    check("the end options sit on the grant", timedGrants(nova.id)[0]?.end, end)

    // What happens during the grant: creative, and a different inventory.
    nova.gm = "creative"
    nova.slots[0] = item("minecraft:diamond", 64)
    nova.slots[1] = undefined
    nova.slots[5] = item("minecraft:netherite_ingot", 3)

    runGrantChecks(Date.now() + 2 * HOUR)
    check("the rank is gone", heldRankIds(nova.id).includes("mod"), false)
    check("the gamemode is back", nova.gm, "survival")
    check("the stone is back", [nova.slots[0]?.typeId, nova.slots[0]?.amount], ["minecraft:stone", 5])
    check("the sword is back", nova.slots[1]?.typeId, "minecraft:iron_sword")
    check("what they got during the grant is gone", nova.slots[5], undefined)
    check("they were sent to Admin+ spawn", nova.teleports[nova.teleports.length - 1], { x: 100.5, y: 70, z: -40.5 })
    const said = lastLine(nova)
    check("one line says all of it", [said.includes("Mod rank has expired"), said.includes("gamemode is back to survival"),
        said.includes("inventory is back"), said.includes("sent to spawn")], [true, true, true, true])
    check("nothing is left waiting", dueFor(nova.id).length, 0)
    check("and the note is gone", keepOf(nova.id, "mod"), undefined)
    // Mod is a staff rank: losing it would put a creative player in survival
    // first (features/gamemode.js). The grant's own restore wins instead.
    check("the staff-lost rule stepped aside", nova.inbox.some(l => l.includes("no longer staff")), false)
}

console.log("\n— offline when it ends: it happens when they come back, from the saved copy after a reload —")
const sam = fakePlayer("Sam")
{
    sam.slots[0] = item("minecraft:apple", 3)
    grantRank(sam.id, "mod", "Sam")
    setExpiry(sam.id, "mod", HOUR, owner, { inventory: true })
    beginGrant(sam.id, "mod", { inventory: true })
    sam.gm = "creative"
    leave(sam)
    __forgetLiveCopies()          // the world reloaded: only the saved copy is left
    runGrantChecks(Date.now() + 2 * HOUR)
    check("the rank ends while they're away", heldRankIds(sam.id).includes("mod"), false)
    check("and what's owed waits for them", dueFor(sam.id).length, 1)
    check("nothing touched them yet", sam.gm, "creative")

    sam.slots[0] = item("minecraft:dirt")
    rejoin(sam)
    runGrantChecks()
    check("the gamemode is back when they join", sam.gm, "survival")
    check("the inventory is rebuilt from the saved copy", [sam.slots[0]?.typeId, sam.slots[0]?.amount], ["minecraft:apple", 3])
    check("no spawn trip, because that switch was off", sam.teleports.length, 0)
    check("they're told, after the fact", lastLine(sam).includes("Mod rank has expired"), true)
    check("and nothing is left waiting", dueFor(sam.id).length, 0)
}

console.log("\n— offline when it's given: noted the first time they're seen while it runs —")
const rio = fakePlayer("Rio")
{
    leave(rio)
    grantRank(rio.id, "mod", "Rio")
    setExpiry(rio.id, "mod", HOUR, owner, { inventory: true })
    beginGrant(rio.id, "mod", { inventory: true })
    check("not here, so the note waits", keepOf(rio.id, "mod")?.pending, true)

    rio.gm = "adventure"
    rio.slots[3] = item("minecraft:bread", 7)
    rejoin(rio)
    runGrantChecks()
    const noted = keepOf(rio.id, "mod")
    check("taken when they joined", [noted?.pending ?? false, noted?.gm], [false, "adventure"])
    check("with their inventory as it was then", (noted?.inv?.slots ?? []).filter(Boolean).map(s => s.id), ["minecraft:bread"])

    rio.gm = "creative"
    rio.slots[3] = undefined
    runGrantChecks(Date.now() + 2 * HOUR)
    check("ending puts that back", [rio.gm, rio.slots[3]?.typeId], ["adventure", "minecraft:bread"])
}

console.log("\n— never seen while it ran: nothing to give back —")
const ash = fakePlayer("Ash")
{
    leave(ash)
    ash.gm = "creative"
    grantRank(ash.id, "mod", "Ash")
    setExpiry(ash.id, "mod", HOUR, owner, { inventory: true, spawn: true })
    beginGrant(ash.id, "mod", { inventory: true, spawn: true })
    runGrantChecks(Date.now() + 2 * HOUR)
    check("it ends", heldRankIds(ash.id).includes("mod"), false)
    check("with nothing owed, since it never changed anything", dueFor(ash.id).length, 0)
    rejoin(ash)
    runGrantChecks()
    check("so joining changes nothing", [ash.gm, ash.teleports.length], ["creative", 0])
}

console.log("\n— the gamemode comes back even with both switches off —")
const kim = fakePlayer("Kim")
{
    kim.slots[0] = item("minecraft:cake")
    grantRank(kim.id, "mod", "Kim")
    setExpiry(kim.id, "mod", HOUR, owner, { inventory: false, spawn: false })
    beginGrant(kim.id, "mod", { inventory: false, spawn: false })
    check("no end options are stored when both are off", timedGrants(kim.id)[0]?.end, undefined)
    check("no inventory is noted", keepOf(kim.id, "mod")?.inv, null)
    kim.gm = "creative"
    kim.slots[0] = item("minecraft:emerald", 9)
    runGrantChecks(Date.now() + 2 * HOUR)
    check("the gamemode is back", kim.gm, "survival")
    check("the inventory is left alone", kim.slots[0]?.typeId, "minecraft:emerald")
    check("and they stay where they are", kim.teleports.length, 0)
}

console.log("\n— taken away early: the grant is over, so the same things happen —")
const lee = fakePlayer("Lee")
{
    grantRank(lee.id, "mod", "Lee")
    setExpiry(lee.id, "mod", HOUR, owner, { spawn: true })
    beginGrant(lee.id, "mod", { spawn: true })
    lee.gm = "creative"
    revokeRank(lee.id, "mod", "Lee")
    runGrantChecks()
    check("the gamemode is back", lee.gm, "survival")
    check("and they went to spawn", lee.teleports.length, 1)
    check("the line says it ended, not that it expired", lastLine(lee).includes("Mod rank has ended"), true)
}

console.log("\n— renewing it keeps what they had before the FIRST grant —")
const max = fakePlayer("Max")
{
    max.slots[0] = item("minecraft:oak_log", 4)
    grantRank(max.id, "mod", "Max")
    setExpiry(max.id, "mod", HOUR, owner, { inventory: true })
    beginGrant(max.id, "mod", { inventory: true })
    max.slots[0] = item("minecraft:gold_ingot", 2)
    setExpiry(max.id, "mod", 2 * HOUR, owner, { inventory: true })
    beginGrant(max.id, "mod", { inventory: true })
    check("the first note stands", keepOf(max.id, "mod")?.inv?.slots?.[0]?.id, "minecraft:oak_log")
    setExpiry(max.id, "mod", 0, owner)
    check("made permanent, it never ends, so the note goes", keepOf(max.id, "mod"), undefined)
}

console.log("\n— staff mode: what's owed waits until their real things are back —")
const ivy = fakePlayer("Ivy")
{
    ivy.slots[0] = item("minecraft:torch", 16)
    grantRank(ivy.id, "mod", "Ivy")
    setExpiry(ivy.id, "mod", HOUR, owner, { inventory: true })
    beginGrant(ivy.id, "mod", { inventory: true })
    ivy.slots[0] = item("minecraft:tnt", 1)
    check("staff mode stows it", enterStaffMode(ivy, []).ok, true)
    runGrantChecks(Date.now() + 2 * HOUR)
    check("the grant ended", heldRankIds(ivy.id).includes("mod"), false)
    check("but nothing was written over the staff tools", dueFor(ivy.id).length, 1)
    exitStaffMode(ivy)
    runGrantChecks()
    check("once out of staff mode, the inventory from before the grant is back", ivy.slots[0]?.typeId, "minecraft:torch")
}

console.log("\n— no Admin+ spawn: the world's spawn —")
{
    clearSpawn()
    const zoe = fakePlayer("Zoe")
    world.getDefaultSpawnLocation = () => ({ x: 8, y: 66, z: -3 })
    check("a fixed height goes straight there", [sendToSpawn(zoe), zoe.teleports[0]], [true, { x: 8.5, y: 66, z: -2.5 }])
    world.getDefaultSpawnLocation = () => ({ x: 10, y: 32767, z: -20 })
    __test.timers.length = 0
    sendToSpawn(zoe)
    check("no fixed height: high up first", zoe.teleports[1], { x: 10.5, y: 200, z: -19.5 })
    __test.runTimers()
    check("then down onto the top block", zoe.teleports[2], { x: 10.5, y: 71, z: -19.5 })
    delete world.getDefaultSpawnLocation
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
