import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { onPlayerJoin, applyPreset, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, resetSetting, overrides, flag } from "../Admin+ BP/scripts/core/settings.js"
import { getSpawn, restoreSpawnPoint } from "../Admin+ BP/scripts/core/warps.js"
import {
    makeRegion, regionContains, sphereRadius, describeRegion, outlinePoints,
    spawnRecord, reconcileSpawn, enableOmniSpawn, deleteOmniSpawn, saveSpawnArea,
    keepSimplePoint, dontSetPoint, setOmniPoint, currentSpawnPoint, insideSpawnArea
} from "../Admin+ BP/scripts/core/omnitool.js"
import {
    worldToolsScreen, giveOmnitool, onOmnitoolClick, applyLocks, swapLooks, clearIdle, sessionOf, OMNI_TYPES
} from "../Admin+ BP/scripts/features/worldtools.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// World tools (2.9.0): /wts, the Omnitool, and spawn as an area. The design is
// the user's, 2026-11-12 (Obsidian: Admin+ ▸ World Tools).

const OW = "minecraft:overworld"
const said = new Map()
function person(id, name) {
    const slots = new Array(36).fill(undefined)
    const container = {
        size: 36,
        getItem: i => slots[i],
        setItem: (i, item) => { slots[i] = item },
        addItem: item => { const i = slots.findIndex(s => !s); if (i < 0) return item; slots[i] = item; return undefined }
    }
    const p = {
        id, name, nameTag: name, commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: { id: OW }, selectedSlotIndex: 0, isSneaking: false,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: m => said.get(id).push(String(m).replace(/§./g, "")),
        getComponent: c => c === "minecraft:inventory" ? { container } : undefined,
        slots
    }
    said.set(id, [])
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const lastSaid = p => said.get(p.id).at(-1) ?? ""
const press = selection => ({ canceled: false, selection })
const block = (x, y, z) => ({ location: { x, y, z } })
const titleOf = form => String(form.parts.find(p => p[0] === "title")?.[1] ?? "").replace(/§./g, "")
const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => String(p[1]).replace(/§./g, "").split("\n")[0])
const formsSince = from => __ui.shown.slice(from)

applyPreset("server")
const boss = person("wt-boss", "Boss")
setRanks(boss.id, ["owner"], boss.name)
const pat = person("wt-pat", "Pat")

console.log("\n— shapes work the way WorldEdit's do —")
{
    const sphere = makeRegion("sphere", OW, { x: 10, y: 64, z: 10 }, { x: 13, y: 68, z: 10 })
    check("pos2 sets the radius: the distance, rounded", sphereRadius(sphere), 5)
    check("a block near the centre is inside", regionContains(sphere, { x: 12, y: 66, z: 11 }, OW), true)
    check("a block past the radius is not", regionContains(sphere, { x: 17, y: 64, z: 10 }, OW), false)
    check("the same spot in the nether is not", regionContains(sphere, { x: 10, y: 64, z: 10 }, "minecraft:nether"), false)
    const box = makeRegion("cuboid", OW, { x: 5, y: 60, z: 5 }, { x: 1, y: 70, z: 8 })
    check("a cuboid's corners are both included", [regionContains(box, { x: 5.9, y: 70.5, z: 8.2 }, OW), regionContains(box, { x: 1, y: 60, z: 5 }, OW)], [true, true])
    check("one block past a corner is out", regionContains(box, { x: 6, y: 65, z: 6 }, OW), false)
    check("sizes read plainly", [describeRegion(sphere), describeRegion(box)], ["radius 5 blocks", "5 × 11 × 4 blocks"])
    check("a box outline is its corners and edges", outlinePoints(box).length > 8 && outlinePoints(box).length <= 8 + 12 * 23, true)
    check("a sphere outline is three rings and a centre", outlinePoints(sphere).length <= 3 * 64 + 1, true)
    check("a huge sphere stays cheap", outlinePoints(makeRegion("sphere", OW, { x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 })).length, 3 * 64 + 1)
    check("with only pos1, a small box marks it", outlinePoints(makeRegion("cuboid", OW, { x: 1, y: 2, z: 3 }, null)).length > 0, true)
}

console.log("\n— turning Omnitool spawn on sets simple spawn aside —")
const oldPoint = { x: 100.5, y: 70, z: -40.5, dimension: OW, set: 1 }
restoreSpawnPoint(oldPoint)
setSetting("spawn.radius", "24")
setSetting("spawn.protect", "true")
resetSetting("feature.spawn")
{
    check("simple spawn protects its circle first", insideSpawnArea({ x: 110, y: 5, z: -40 }, OW), true)
    check("reconciling with the switch off does nothing", reconcileSpawn(), "")
    check("on, it says so once", enableOmniSpawn(), "enabled")
    check("with no area yet there is no spawn area", insideSpawnArea({ x: 100, y: 70, z: -40 }, OW), false)
    check("and /spawn has no point until one is chosen", currentSpawnPoint(), undefined)
    check("simple spawn's point was saved to put back", spawnRecord().before.point, oldPoint)

    saveSpawnArea(makeRegion("sphere", OW, { x: 0, y: 64, z: 0 }, { x: 8, y: 64, z: 0 }))
    check("the sphere is spawn now", insideSpawnArea({ x: 3, y: 66, z: 2 }, OW), true)
    check("and the old circle isn't", insideSpawnArea({ x: 110, y: 70, z: -40 }, OW), false)

    keepSimplePoint()
    check("Keep current keeps /spawn where it was", currentSpawnPoint(), oldPoint)
    dontSetPoint()
    check("Don't set spawn turns /spawn off", [currentSpawnPoint(), flag("feature.spawn")], [undefined, false])
    setOmniPoint({ x: 2.5, y: 65, z: 2.5, dimension: OW })
    check("a clicked point turns /spawn back on", [currentSpawnPoint().y, flag("feature.spawn")], [65, true])

    // Things that can change meanwhile (spawn's Settings, < Code >), so Delete
    // has something real to put back.
    setSetting("spawn.protect", "false")
    setSetting("spawn.radius", "99")
    restoreSpawnPoint({ x: 1, y: 1, z: 1, dimension: OW })
}

console.log("\n— Delete puts back exactly what you had —")
{
    check("it says it restored", deleteOmniSpawn(), "restored")
    check("the old point is back", getSpawn(), oldPoint)
    check("the radius and protection are back", [setting("spawn.radius"), setting("spawn.protect")], ["24", "true"])
    check("a setting that was never set is unset again, not frozen", "feature.spawn" in overrides(), false)
    check("the switch is off", flag("omni.spawn"), false)
    check("the old circle protects again", insideSpawnArea({ x: 110, y: 5, z: -40 }, OW), true)
}

console.log("\n— the switch can change anywhere; reconciling catches up —")
{
    setSetting("omni.spawn", "true")
    check("switched on in settings, the next pass sets simple spawn aside", [reconcileSpawn(), spawnRecord().on], ["enabled", true])
    setSetting("omni.spawn", "false")
    check("switched off, the next pass puts it back", [reconcileSpawn(), getSpawn()], ["restored", oldPoint])
}

console.log("\n— /wts —")
{
    setSetting("feature.claims", "false")
    let from = __ui.shown.length
    await worldToolsScreen(pat)
    check("with claims off, a player without the Omnitool can't open it", formsSince(from).length, 0)
    check("and is told why", lastSaid(pat).includes("land claims are turned off"), true)
    setSetting("feature.claims", "true")
    from = __ui.shown.length
    await worldToolsScreen(pat)
    check("with claims on, they see land claims only", buttonsOf(formsSince(from)[0]), ["Land claims"])
    from = __ui.shown.length
    await worldToolsScreen(boss)
    check("staff with the Omnitool see both", buttonsOf(formsSince(from)[0]), ["Omnitool", "Land claims"])
    setSetting("feature.worldtools", "false")
    await worldToolsScreen(boss)
    check("the section's own switch turns it all off", lastSaid(boss).includes("turned off"), true)
    resetSetting("feature.worldtools"); resetSetting("feature.claims")
}

console.log("\n— the stick: setting up spawn from nothing —")
{
    giveOmnitool(boss)
    check("the Omnitool is in the inventory", boss.slots[0]?.typeId, OMNI_TYPES[0])
    giveOmnitool(boss)
    check("only one at a time", boss.slots.filter(s => s && OMNI_TYPES.includes(s.typeId)).length, 1)

    // First click: the picker, Spawn, the one question, then the shape.
    __ui.answers.length = 0
    __ui.answers.push(press(0), press(1), press(0))
    const from = __ui.shown.length
    await onOmnitoolClick(boss, "right", block(0, 63, 0))
    const titles = formsSince(from).map(titleOf)
    check("a first click asks how to use it", titles[0].endsWith("Omnitool"), true)
    check("then the one question about simple spawn", titles[1].endsWith("Spawn through the Omnitool"), true)
    check("then the shape, sphere first", buttonsOf(formsSince(from)[2]), ["Sphere", "Cuboid"])
    check("and it's editing a sphere", [sessionOf(boss)?.mode, sessionOf(boss)?.shape], ["editing", "sphere"])
    check("the stick can't be dropped while editing", boss.slots[0].lockMode, "slot")

    onOmnitoolClick(boss, "left", block(0, 64, 0))
    onOmnitoolClick(boss, "right", block(6, 64, 0))
    check("left click is the centre, right click the edge", [sessionOf(boss).pos1, sessionOf(boss).pos2], [{ x: 0, y: 64, z: 0 }, { x: 6, y: 64, z: 0 }])

    // Shift + right click: the details, Confirm; then where /spawn goes: Keep current.
    __ui.answers.push(press(0), press(1))
    const from2 = __ui.shown.length
    await onOmnitoolClick(boss, "sneak", block(6, 64, 0))
    check("shift + right click shows Confirm, Keep editing and Cancel", buttonsOf(formsSince(from2)[0]), ["Confirm", "Keep editing", "Cancel"])
    check("the first save asks where /spawn goes, Keep current in the middle", buttonsOf(formsSince(from2)[1]), ["Set spawn point", "Keep current", "Don't set spawn"])
    check("the sphere is saved", describeRegion(spawnRecord().region), "radius 6 blocks")
    check("and /spawn keeps its old point", currentSpawnPoint(), oldPoint)
    check("the stick unlocks again", boss.slots[0].lockMode, "none")
}

console.log("\n— when spawn exists: set a point, then Delete —")
{
    // Click inside spawn: the picker, Spawn, then its menu. Set spawn point.
    __ui.answers.push(press(0), press(2))
    const from = __ui.shown.length
    await onOmnitoolClick(boss, "right", block(1, 64, 1))
    check("the spawn menu has Delete at the bottom", buttonsOf(formsSince(from)[1]), ["Flash the border", "Recalibrate", "Set spawn point", "Settings", "Delete"])
    check("Set spawn point waits for a block", sessionOf(boss)?.mode, "point")
    onOmnitoolClick(boss, "left", block(5, 70, 5))
    check("players land on top of the clicked block", currentSpawnPoint(), { x: 5.5, y: 71, z: 5.5, dimension: OW, set: currentSpawnPoint().set })

    __ui.answers.push(press(0), press(4), press(1))
    await onOmnitoolClick(boss, "right", block(1, 64, 1))
    check("Delete puts simple spawn back", [flag("omni.spawn"), getSpawn()], [false, oldPoint])
}

console.log("\n— an idle selection clears, and the looks swap —")
{
    __ui.answers.push(press(0), press(1), press(1))
    await onOmnitoolClick(boss, "left", block(0, 64, 0))
    check("editing a cuboid", sessionOf(boss)?.shape, "cuboid")
    sessionOf(boss).last = Date.now() - 11 * 60000
    check("ten idle minutes clear it", clearIdle(boss), true)
    check("the selection is gone", sessionOf(boss), undefined)
    check("and the stick is free again", boss.slots[0].lockMode, "none")

    boss.slots[0].setLore(["kept"])
    boss.selectedSlotIndex = 5
    swapLooks(boss)
    check("away from the hand, the look moves on", boss.slots[0].typeId, OMNI_TYPES[1])
    check("and keeps its lore", boss.slots[0].getLore(), ["kept"])
    boss.selectedSlotIndex = 0
    swapLooks(boss)
    check("in the hand, it holds still", boss.slots[0].typeId, OMNI_TYPES[1])
}

console.log("\n— someone without the Omnitool permission —")
{
    pat.slots[0] = boss.slots[0]
    const from = __ui.shown.length
    await onOmnitoolClick(pat, "right", block(0, 64, 0))
    check("gets no menu", formsSince(from).length, 0)
    check("and is told", lastSaid(pat).includes("can't use the Omnitool"), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
