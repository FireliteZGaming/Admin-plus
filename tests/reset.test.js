import { __test, ItemStack, world } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { tableReport } from "../Admin+ BP/scripts/core/storage.js"
import { onPlayerJoin, setRanks, heldRankIds, defaultRank, applyPreset, getRank, saveRank, ladder } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, overrides } from "../Admin+ BP/scripts/core/settings.js"
import { ban, isBanned, mute, isMuted, setFrozen, isFrozen } from "../Admin+ BP/scripts/core/moderation.js"
import { saveWarp, allWarps } from "../Admin+ BP/scripts/core/warps.js"
import { setNickname, getNickname } from "../Admin+ BP/scripts/core/identity.js"
import { vanish, isVanished, VANISH_TAG } from "../Admin+ BP/scripts/core/vanish.js"
import { save as saveHologram, list as hologramList } from "../Admin+ BP/scripts/core/holograms.js"
import { enter, inStaffMode } from "../Admin+ BP/scripts/core/staffmode.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { factoryReset, KEPT_BY_RESET } from "../Admin+ BP/scripts/features/reset.js"
import { stopStaffMode } from "../Admin+ BP/scripts/features/staffmode.js"
import { factoryResetScreen } from "../Admin+ BP/scripts/features/code.js"

// 2.9.3. The user, 2026-11-12: "Factory Reset does a complete wipe of the mod
// and resets it back to the state as if the mod just was added to your
// world." Everything is filled in through the real code, then wiped through
// the real code, then checked against what a brand-new world starts with.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name, { op = false } = {}) {
    const tags = new Set()
    const slots = new Array(36).fill(undefined)
    const worn = {}
    const effects = new Set()
    const p = {
        id: `r${nextId++}`, name, nameTag: name, inbox: [],
        location: { x: 10, y: 64, z: 10 },
        commandPermissionLevel: op ? 2 : 0,
        movement: true, camera: true,
        getTags: () => [...tags],
        hasTag: t => tags.has(t),
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(typeof m === "string" ? m : JSON.stringify(m)),
        addEffect: id => { effects.add(String(id)) },
        removeEffect: id => { effects.delete(String(id)) },
        hasEffect: id => effects.has(String(id)),
        runCommand: () => ({ successCount: 1 }),
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }), getEntities: () => [] },
        inputPermissions: {
            setPermissionCategory: (category, enabled) => {
                if (String(category).toLowerCase().includes("camera")) p.camera = enabled
                else p.movement = enabled
            }
        },
        getComponent(id) {
            if (id === "minecraft:inventory") return { container: { size: 36, getItem: i => slots[i], setItem: (i, s) => { slots[i] = s } } }
            if (id === "minecraft:equippable") return { getEquipment: s => worn[s], setEquipment: (s, v) => { worn[s] = v } }
            return undefined
        }
    }
    p._slots = slots
    p._effects = effects
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const leave = p => { const i = __test.players.indexOf(p); if (i >= 0) __test.players.splice(i, 1) }
const press = selection => ({ canceled: false, selection })
const submit = (...formValues) => ({ canceled: false, formValues })
const clean = s => String(s).replace(/§./g, "")
const apKeys = () => [...__test.props.keys()].filter(k => k.startsWith("ap:"))

applyPreset("server")
const owner = fakePlayer("Owner", { op: true })
const helper = fakePlayer("Helper")

/** Fill every corner a world can fill, through the real functions. */
async function fillTheWorld() {
    setRanks(helper.id, ["admin"], helper.name)
    saveRank("vip", { display: "§eVIP", type: "cosmetic", perms: [] })
    setSetting("feature.homes", "true")
    setSetting("feature.claims", "true")
    saveWarp("market", { display: "§aMarket" }, owner)
    setNickname(helper, "§cHelpy")
    saveHologram("hello", { text: "Hi", x: 1, y: 2, z: 3 })
    const villain = fakePlayer("Villain")
    await ban(villain, 0, "griefing", owner)
    const chatty = fakePlayer("Chatty")
    mute(chatty, 60000, "spam", owner)
    world.setDynamicProperty("ap:oldfeature", 1)
    world.setDynamicProperty("ap:oldfeature#0", "{\"left\":\"by an old version\"}")
    world.setDynamicProperty("otherpack:score", 7)
    return { villain, chatty }
}

console.log("\n— a full world first —")
const { villain, chatty } = await fillTheWorld()
const frozen = fakePlayer("Frozen")
setFrozen(frozen, true)
const hidden = fakePlayer("Hidden")
vanish(hidden)
const onDuty = fakePlayer("OnDuty")
onDuty._slots[0] = new ItemStack("minecraft:diamond_sword", 1)
onDuty._slots[5] = new ItemStack("minecraft:cobblestone", 32)
check("(a staff member is in staff mode)", enter(onDuty, []).ok, true)
check("(their sword is stowed away)", onDuty._slots[0], undefined)
const away = fakePlayer("Away")
away._slots[3] = new ItemStack("minecraft:netherite_ingot", 4)
check("(another went into staff mode and left)", enter(away, []).ok, true)
leave(away)
check("(the world is full: a ban)", isBanned(villain), true)
check("(a mute)", isMuted(chatty), true)
check("(a frozen player who can't move)", frozen.movement, false)
check("(a vanished player)", isVanished(hidden) && hidden.hasTag(VANISH_TAG), true)
check("(a warp, a hologram, a nickname, a custom rank)",
    [allWarps().length > 0, hologramList().length > 0, !!getNickname(helper), !!getRank("vip")], [true, true, true, true])

console.log("\n— Factory reset wipes everything —")
// The stub's world.sendMessage drops messages; catch the broadcast here.
const told = []
world.sendMessage = message => told.push(String(message))
const result = factoryReset(owner)
const lines = recent(10)
check("the log holds one line", lines.length, 1)
check("saying who wiped it", [lines[0]?.action, clean(lines[0]?.detail ?? "").includes("Factory reset")], ["config.reset", true])
check("everyone is told", told.some(m => clean(m).includes("An operator reset Admin+")), true)
check("it reports what it removed", result.removed > 0, true)
check("no ban is left", isBanned(villain), false)
check("no mute is left", isMuted(chatty), false)
check("no warp is left", allWarps().length, 0)
check("no hologram is left", hologramList().length, 0)
check("no display name is left", getNickname(helper) ?? "", "")
check("the custom rank is gone", getRank("vip"), undefined)
check("the ranks are the ones a new world starts with", ladder().map(r => r.id).includes("vip"), false)
check("every setting is back to its default", overrides(), {})
check("an online admin is back to the starting rank", heldRankIds(helper), [defaultRank().id])
check("a key left by an old version is gone",
    apKeys().filter(k => k.startsWith("ap:oldfeature")), [])
check("another pack's data is not touched", __test.props.get("otherpack:score"), 7)

console.log("\n— what belongs to players is handed back first —")
check("the frozen player can move again", [frozen.movement, frozen.camera, isFrozen(frozen)], [true, true, false])
check("the vanished player is visible again", [isVanished(hidden), hidden.hasTag(VANISH_TAG)], [false, false])
check("the staff member online got their sword back", onDuty._slots[0]?.typeId, "minecraft:diamond_sword")
check("and their cobblestone", onDuty._slots[5]?.amount, 32)
check("and is out of staff mode", inStaffMode(onDuty), false)
check("it says how many got their things back", result.returned, 1)
check("the staff member who left keeps their stowed things", inStaffMode(away.id), true)
__test.players.push(away)
stopStaffMode(away)
check("and gets them back when they join", away._slots[3]?.typeId, "minecraft:netherite_ingot")

console.log("\n— a brand-new world, apart from what must stay —")
// Allowed to differ from a new world: the kept tables, who holds which rank
// (everyone online re-joined, as on a new world), and the log (its one line,
// plus the staff mode hand-back just above).
const report = tableReport()
const allowed = new Set(report
    .filter(t => KEPT_BY_RESET.includes(t.key) || /holder/i.test(t.key) || t.key === "auditLog")
    .map(t => t.key))
check("every other table is exactly what a new world starts with",
    report.filter(t => !t.atSeed && !allowed.has(t.key)).map(t => t.key), [])

console.log("\n— the screen: operators only, and asked twice —")
async function refill() {
    setSetting("feature.homes", "true")
    saveWarp("market", { display: "§aMarket" }, owner)
}
await refill()
__ui.answers.length = 0
helper.inbox.length = 0
await factoryResetScreen(helper, () => {})
check("someone who isn't an operator is refused", helper.inbox.some(m => clean(m).includes("Only an operator")), true)
check("and nothing is wiped", allWarps().length, 1)

__ui.answers.push(press(0))
await factoryResetScreen(owner, () => {})
check("saying no at the first question wipes nothing", allWarps().length, 1)

__ui.answers.push(press(1), submit("yes please"))
owner.inbox.length = 0
await factoryResetScreen(owner, () => {})
check("typing anything but RESET wipes nothing", allWarps().length, 1)
check("and says so", owner.inbox.some(m => clean(m).includes("Nothing was wiped")), true)

__ui.answers.push(press(1), submit(" reset "))
await factoryResetScreen(owner, () => {})
check("RESET, in any case, wipes it", [allWarps().length, overrides()], [0, {}])
const asked = __ui.shown.slice(-2)
check("the first question lists what goes",
    clean(asked[0]?.parts.find(p => p[0] === "body")?.[1] ?? "").includes("ranks and who has them, bans"), true)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
