import { __test, world, ItemStack } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin, applyPreset, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import {
    judge, stackSignature, planMerges, hotspots, planMobLimit, speedFrom, shouldAutoClear, AUTO_GAP_MS, removableTypes, describeTally,
    noteSeen, noteDeath, shieldIfDeathDrop, isShielded, costOf, HIDDEN_DATA_ITEMS, __resetCleanup
} from "../Admin+ BP/scripts/core/cleanup.js"
import { runClear, bringBack, undoCount, autoCheck, speed, __tickTimes, __cleanupState } from "../Admin+ BP/scripts/features/cleanup.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// 2.12.17, the user: "upgrade lag-clear to make insanely better, I mean it
// can't be simple anymore, it has to be super complex and advanced behind the
// scenes while simple to use".

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
const drain = () => { for (let i = 0; i < 10 && __test.timers.length; i++) __test.runTimers() }

// ------------------------------------------------------------- a fake world
let eid = 1
function stackOf(typeId, amount, extras = {}) {
    const stack = new ItemStack(typeId, amount)
    stack.maxAmount = extras.max ?? 64
    if (extras.name) stack.nameTag = extras.name
    if (extras.ench) stack._enchants.push({ type: { id: "sharpness" }, level: 1 })
    return stack
}
function fakeDimension(id) {
    const list = []
    const d = {
        id, list,
        getEntities(opts) { return opts?.type ? list.filter(e => e.typeId === opts.type) : [...list] },
        spawnItem(stack, loc) { return addItem(d, stack, loc) },
        getTopmostBlock: () => ({ location: { y: 63 } })
    }
    return d
}
function addItem(dim, stack, at, extras = {}) {
    const e = {
        id: `it${eid++}`, typeId: "minecraft:item", location: { ...at }, dimension: dim, isValid: true,
        nameTag: extras.entityName, getTags: () => extras.tags ?? [],
        getComponent: id => id === "minecraft:item" ? { itemStack: stack } : undefined,
        teleport(loc) { e.location = { ...loc } },
        remove() { e.isValid = false; const i = dim.list.indexOf(e); if (i >= 0) dim.list.splice(i, 1) }
    }
    dim.list.push(e)
    return e
}
function addMob(dim, typeId, at, extras = {}) {
    const e = {
        id: `mob${eid++}`, typeId, location: { ...at }, dimension: dim, isValid: true, nameTag: extras.name,
        getTags: () => [], getComponent: id => id === "minecraft:health" ? {} : undefined,
        remove() { e.isValid = false; const i = dim.list.indexOf(e); if (i >= 0) dim.list.splice(i, 1) }
    }
    dim.list.push(e)
    return e
}
const items = dim => dim.list.filter(e => e.typeId === "minecraft:item")

__test.runStartup()
applyPreset("server")
const staff = {
    id: "lc-staff", name: "Staff", nameTag: "Staff", inbox: [], commandPermissionLevel: 0,
    location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" }, teleports: [],
    getTags: () => [], addTag: () => true, removeTag: () => true, hasTag: () => false,
    sendMessage: m => staff.inbox.push(plain(m)), teleport(at) { staff.teleports.push(at) },
    onScreenDisplay: { setActionBar: t => { staff.bar = plain(t) } }
}
__test.players.push(staff)
onPlayerJoin(staff)
setRanks(staff.id, ["owner"], "Staff")

const overworld = fakeDimension("minecraft:overworld")
const realGetDimension = world.getDimension
world.getDimension = id => { if (id === "minecraft:overworld") return overworld; throw new Error("not here") }

console.log("\n— what can merge —")
check("a plain stackable item can", stackSignature(stackOf("minecraft:cobblestone", 10)), "minecraft:cobblestone")
check("a named one can't", stackSignature(stackOf("minecraft:cobblestone", 10, { name: "Mine" })), null)
check("an enchanted one can't", stackSignature(stackOf("minecraft:book", 1, { ench: true, max: 64 })), null)
check("one that doesn't stack can't", stackSignature(stackOf("minecraft:iron_sword", 1, { max: 1 })), null)

console.log("\n— planning merges: same item, same spot, fewer entities —")
{
    const pile = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, dimension: "o", x: 1 + i * 0.3, y: 64, z: 1, typeId: "minecraft:dirt", amount: 20, max: 64, sig: "minecraft:dirt" }))
    const plans = planMerges(pile)
    check("one plan for the pile", plans.length, 1)
    check("100 dirt in 5 entities become 2 stacks", plans[0]?.stacks, [64, 36])
    check("every original is in it", plans[0]?.remove.length, 5)
    const apart = [{ ...pile[0], id: "a" }, { ...pile[1], id: "b", x: 40 }]
    check("far apart, nothing merges", planMerges(apart).length, 0)
    const mixed = [{ ...pile[0], id: "c" }, { ...pile[1], id: "d", sig: "minecraft:sand", typeId: "minecraft:sand" }]
    check("different items, nothing merges", planMerges(mixed).length, 0)
    const full64 = [{ ...pile[0], id: "e", amount: 64 }, { ...pile[1], id: "f", amount: 64 }]
    check("two full stacks gain nothing, so no plan", planMerges(full64).length, 0)
}

console.log("\n— where the load is —")
{
    const spots = hotspots([
        ...Array.from({ length: 30 }, () => ({ dimension: "minecraft:overworld", x: 5, z: 5, typeId: "minecraft:item" })),
        ...Array.from({ length: 10 }, () => ({ dimension: "minecraft:overworld", x: 100, z: 100, typeId: "minecraft:villager_v2", isMob: true }))
    ], 5)
    check("ten villagers outweigh thirty items", spots[0]?.top?.[0]?.type, "villager_v2")
    check("the load is a weighted sum", [spots[0]?.load, spots[1]?.load], [80, 30])
    check("an unknown mob costs more than an unknown thing", costOf("x:thing", true) > costOf("x:thing", false), true)
}

console.log("\n— the mob limit never touches someone's mob —")
{
    const chickens = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, dimension: "o", x: 3, z: 3, typeId: "minecraft:chicken", keep: i === 0 }))
    const gone = planMobLimit(chickens, 3)
    check("six chickens, a limit of three: three go", gone.length, 3)
    check("the named one isn't among them", gone.includes("c0"), false)
    const villagers = Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, dimension: "o", x: 3, z: 3, typeId: "minecraft:villager_v2" }))
    check("villagers are never on the list", planMobLimit(villagers, 1).length, 0)
    check("no limit set, nothing goes", planMobLimit(chickens, 0).length, 0)
}

console.log("\n— server speed from tick times —")
check("50 ms ticks are full speed", speedFrom(Array.from({ length: 21 }, (_, i) => i * 50)).tps, 20)
check("100 ms ticks are half", speedFrom(Array.from({ length: 21 }, (_, i) => i * 100)).tps, 10)
check("the slowest tick is reported", speedFrom([0, 50, 400, 450]).worst, 350)

console.log("\n— what is never on the list: things that are somebody's —")
{
    const types = removableTypes()
    check("a thrown trident is somebody's trident", types.includes("minecraft:thrown_trident"), false)
    check("an ender pearl may be waiting in a stasis chamber", types.includes("minecraft:ender_pearl"), false)
    check("a fishing hook belongs to someone fishing", types.includes("minecraft:fishing_hook"), false)
    check("spent arrows still go", types.includes("minecraft:arrow"), true)
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((type, i) => ({ type, count: 10 - i }))
    check("a long count says how many kinds it left out", describeTally(many, 6).endsWith("and 2 more kinds"), true)
}

console.log("\n— when to clear by itself —")
{
    const now = 10 * AUTO_GAP_MS
    check("lots of clutter: yes", shouldAutoClear({ clutter: 5000, tps: 20, slowChecks: 0, lastAuto: 0, running: false, now }).why, "clutter")
    check("a slow server with clutter to blame: yes", shouldAutoClear({ clutter: 400, tps: 12, slowChecks: 3, lastAuto: 0, running: false, now }).why, "slow")
    check("slow, but nothing to clear: no", shouldAutoClear({ clutter: 20, tps: 12, slowChecks: 9, lastAuto: 0, running: false, now }).go, false)
    check("never twice in five minutes", shouldAutoClear({ clutter: 5000, tps: 20, slowChecks: 0, lastAuto: now - 1000, running: false, now }).go, false)
    check("never over one that's running", shouldAutoClear({ clutter: 5000, tps: 20, slowChecks: 0, lastAuto: 0, running: true, now }).go, false)
}

console.log("\n— what a clear never takes —")
{
    __resetCleanup()
    const now = Date.now()
    const fresh = addItem(overworld, stackOf("minecraft:dirt", 1), { x: 0, y: 64, z: 0 })
    noteSeen(fresh.id, now - 5000)
    check("something dropped five seconds ago stays", judge(fresh, now).reason, "just dropped")
    check("and goes once it's been there long enough", judge(fresh, now + 60000).remove, true)
    noteDeath("minecraft:overworld", { x: 10, y: 64, z: 10 }, now)
    const drop = addItem(overworld, stackOf("minecraft:iron_ingot", 5), { x: 12, y: 64, z: 11 })
    check("an item that lands by a death a moment later is shielded", shieldIfDeathDrop(drop.id, "minecraft:overworld", drop.location, now + 400), true)
    check("for the minutes set", [isShielded(drop.id, now + 4 * 60000), isShielded(drop.id, now + 6 * 60000)], [true, false])
    check("so a clear leaves it", judge(drop, now + 60000).reason, "from a death")
    const far = addItem(overworld, stackOf("minecraft:iron_ingot", 5), { x: 60, y: 64, z: 60 })
    check("one far from any death isn't", shieldIfDeathDrop(far.id, "minecraft:overworld", far.location, now + 400), false)
    const early = addItem(overworld, stackOf("minecraft:bread", 3), { x: -40, y: 70, z: -40 })
    check("a drop the game reports before the death", shieldIfDeathDrop(early.id, "minecraft:overworld", early.location, now + 1000), false)
    check("is caught once the death is heard", noteDeath("minecraft:overworld", { x: -41, y: 70, z: -40 }, now + 1100), 1)
    check("and kept like the rest", judge(early, now + 60000).reason, "from a death")
    const ench = addItem(overworld, stackOf("minecraft:diamond_sword", 1, { ench: true, max: 1 }), { x: 1, y: 64, z: 1 })
    check("enchanted gear stays", judge(ench).reason, "enchanted")
    const map = addItem(overworld, stackOf("minecraft:filled_map", 1), { x: 1, y: 64, z: 1 })
    check("a map stays, since it couldn't be brought back exactly", judge(map).reason, "can't be brought back exactly")
    check("and that list covers tipped arrows and fireworks", [HIDDEN_DATA_ITEMS.has("minecraft:arrow"), HIDDEN_DATA_ITEMS.has("minecraft:firework_rocket")], [true, true])
    for (const e of [...overworld.list]) e.remove()
    __resetCleanup()
}

console.log("\n— a whole clear: gather, keep what's someone's, remove the rest, bring it back —")
{
    for (let i = 0; i < 40; i++) addItem(overworld, stackOf("minecraft:cobblestone", 8), { x: 2 + (i % 4) * 0.5, y: 64, z: 2 })
    const named = addItem(overworld, stackOf("minecraft:dirt", 1, { name: "Keep me" }), { x: 30, y: 64, z: 30 })
    const valuable = addItem(overworld, stackOf("minecraft:elytra", 1, { max: 1 }), { x: 31, y: 64, z: 30 })
    const justNow = addItem(overworld, stackOf("minecraft:sand", 4), { x: 32, y: 64, z: 30 })
    noteSeen(justNow.id, Date.now())
    staff.inbox.length = 0
    const said = []
    const realSend = world.sendMessage
    world.sendMessage = m => said.push(plain(m))
    __test.timers.length = 0
    check("it starts", runClear({ by: staff, seconds: 0 }), true)
    check("a second can't start over it", runClear({ by: staff, seconds: 0 }), false)
    drain()
    const left = items(overworld).map(e => e.id).sort()
    check("only the protected three are left", left, [named.id, valuable.id, justNow.id].sort())
    check("the clear is over", __cleanupState().running, false)
    check("all 40 cleared stacks can be brought back", undoCount(), 40)
    world.sendMessage = realSend
    check("everyone is told what went, by the item and how many", said.find(m => m.includes("Lag clear removed")), "[Admin+] Lag clear removed cobblestone ×320. Staff can bring the items back.")
    check("staff were told what was kept and why", staff.inbox.some(m => m.includes("named") && m.includes("valuable")), true)

    const back = bringBack(staff)
    check("bringing back puts all 40 back", back, 40)
    check("as the same stacks", items(overworld).filter(e => e.getComponent("minecraft:item").itemStack.typeId === "minecraft:cobblestone").length, 40)
    check("with nothing left waiting", undoCount(), 0)
    for (const e of [...overworld.list]) e.remove()
}

console.log("\n— a countdown first, on everyone's action bar —")
{
    for (let i = 0; i < 5; i++) addItem(overworld, stackOf("minecraft:gravel", 2), { x: 50 + i * 20, y: 64, z: 0 })
    __test.timers.length = 0
    runClear({ by: staff, seconds: 3 })
    check("nothing is gone during the countdown", items(overworld).length, 5)
    __test.runTimers()
    check("the action bar counted down", String(staff.bar).includes("Clearing"), true)
    drain()
    check("then it cleared", items(overworld).length, 0)
}

console.log("\n— the mob limit, when it's set —")
{
    setSetting("cleanup.mobCap", "2")
    const keepName = addMob(overworld, "minecraft:chicken", { x: 70, y: 64, z: 70 }, { name: "Nugget" })
    for (let i = 0; i < 4; i++) addMob(overworld, "minecraft:chicken", { x: 70, y: 64, z: 70 })
    for (let i = 0; i < 3; i++) addMob(overworld, "minecraft:villager_v2", { x: 70, y: 64, z: 70 })
    addItem(overworld, stackOf("minecraft:feather", 1), { x: 70, y: 64, z: 70 })
    __test.timers.length = 0
    runClear({ by: staff, seconds: 0 })
    drain()
    const chickens = overworld.list.filter(e => e.typeId === "minecraft:chicken")
    check("five chickens and a limit of two: two left", chickens.length, 2)
    check("the named one is one of them", chickens.includes(keepName), true)
    check("villagers untouched", overworld.list.filter(e => e.typeId === "minecraft:villager_v2").length, 3)
    resetSetting("cleanup.mobCap")
    for (const e of [...overworld.list]) e.remove()
}

console.log("\n— /lagclear opens a menu, /lagcheck a report —")
{
    addMob(overworld, "minecraft:villager_v2", { x: 200, y: 64, z: 200 })
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.invoke(full("lagclear"), staff)
    await settle()
    const names = buttonsOf(__ui.shown[0])
    check("the menu is titled Lag clear", titleOf(__ui.shown[0]).includes("Lag clear"), true)
    check("with the main choices", ["Clear now", "Merge only", "Busiest places"].every(n => names.some(b => b.startsWith(n))), true)
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.invoke(full("lagcheck"), staff)
    await settle()
    const report = __ui.shown[0]
    check("/lagcheck opens Busiest places", titleOf(report).includes("Busiest places"), true)
    check("which names the busiest chunk and what's in it", buttonsOf(report).some(b => b.includes("Overworld 200, 200") && b.includes("villager")), true)
    for (const e of [...overworld.list]) e.remove()
}

console.log("\n— clearing by itself —")
{
    setSetting("cleanup.autoAt", "50")
    for (let i = 0; i < 60; i++) addItem(overworld, stackOf("minecraft:rotten_flesh", 1), { x: i * 20, y: 64, z: 500 })
    __test.timers.length = 0
    __cleanupState().lastAuto = 0
    const first = autoCheck(Date.now())
    check("past the limit, it starts a clear by itself", first.why, "clutter")
    drain()
    check("and clears", items(overworld).length, 0)
    for (let i = 0; i < 60; i++) addItem(overworld, stackOf("minecraft:rotten_flesh", 1), { x: i * 20, y: 64, z: 600 })
    check("but not again within five minutes", autoCheck(Date.now()).go, false)
    setSetting("cleanup.auto", "false")
    __cleanupState().lastAuto = 0
    check("switched off, it never does", autoCheck(Date.now()).go, false)
    resetSetting("cleanup.auto")
    resetSetting("cleanup.autoAt")
    for (const e of [...overworld.list]) e.remove()
}

console.log("\n— the speed it reports comes from real ticks —")
{
    const t = __tickTimes()
    t.length = 0
    for (let i = 0; i < 21; i++) t.push(i * 80)
    check("80 ms ticks read as 12.5 a second", speed().tps, 12.5)
    t.length = 0
}

world.getDimension = realGetDimension
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
