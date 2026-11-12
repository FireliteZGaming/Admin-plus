import { __test } from "@minecraft/server"
import { setSetting, resetSetting, setting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, whereToGrant, nodeLabels, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
import {
    canNuke, nukeBlockedBy, nukeMissing, nukeArmed, armNuke,
    beatOffsets, fuseTicks, aimPoint, orbitalStrike, spiralPoints,
    fallTicks, TNT_FUSE, DROP_HEIGHT
} from "../Admin+ BP/scripts/core/orbital.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// A staff member with everything: the troll node comes with the rank, operator
// and the Dev tag come from the player object.
function holder({ dev = true, op = true, rank = "Admin" } = {}) {
    const tags = dev ? ["Dev"] : []
    const p = {
        id: `h-${rank}-${dev}-${op}`,
        name: "Holder",
        getTags: () => [...tags],
        commandPermissionLevel: op ? 1 : 0,
        location: { x: 0, y: 64, z: 0 },
        dimension: __test.dimension,
        getHeadLocation: () => ({ x: 0, y: 65.62, z: 0 }),
        getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
        getBlockFromViewDirection: () => undefined,
        addEffect: () => {},
        removeEffect: () => {},
        sendMessage: () => {}
    }
    setRanks(p.id, [rank], p.name)
    return p
}

console.log("\n— the locks, and which of them actually lock —")
// Each is a different KIND of claim: the section is the owner's decision,
// operator and the Dev tag are about who is holding it, armed is a deliberate
// act at the console in THIS world, and the node is the ladder's say. Any one
// of the first three missing must be enough.
//
// The node is the exception, and the tests below say so out loud rather than
// letting the count read as four independent keys.
{
    armNuke(true)
    const full = holder()
    check("everything present, and it fires", canNuke(full), true)
    check("with nothing to report", nukeBlockedBy(full), undefined)

    armNuke(false)
    check("disarmed closes it", canNuke(full), false)
    check("and says so", nukeBlockedBy(full).includes("toggle nuke"), true)
    armNuke(true)

    check("no Dev tag closes it", canNuke(holder({ dev: false })), false)
    check("no operator closes it", canNuke(holder({ op: false })), false)
    check("both missing closes it", canNuke(holder({ dev: false, op: false })), false)
    // The node lock is SUBTRACTIVE, not additive, and this is what proves it.
    // has() lets an operator through any node no rank has an opinion about —
    // deliberately, so a fresh world cannot lock out its own host — and this
    // gate already demands operator. So a plain Member who IS an op is not
    // stopped by the node, and claiming four independent keys would be a lie:
    check("a bare rank does not stop an operator — the node cannot add keys",
        canNuke(holder({ rank: "Member" })), true)

    // What the node CAN do is take it away, which is how a realm carves this
    // out of one rank without touching the other three locks.
    saveRank("nobombs", { display: "§7NoBombs", perms: ["-admin.smite"] })
    const denied = holder({ rank: "nobombs" })
    check("an explicit denial closes it", canNuke(denied), false)
    check("and says which lock", nukeBlockedBy(denied).includes("Pranks"), true)
}

console.log("\n— arming is a switch, and it survives —")
{
    armNuke(false)
    check("it starts off", nukeArmed(), false)
    check("toggling with no argument turns it on", armNuke(), true)
    check("and it stayed on", nukeArmed(), true)
    check("toggling again turns it off", armNuke(), false)
    check("explicitly on", armNuke(true), true)
    check("explicitly off", armNuke(false), false)
}

console.log("\n— the countdown accelerates, which is what makes it frightening —")
// Taken from lllTango_lll's chain, which runs 56, 50, 46, 36, 30, 26, 20. The
// shape is the point: a steady beat is a timer, a quickening one is a warning.
{
    const offsets = beatOffsets()
    const gaps = offsets.slice(1).map((at, i) => at - offsets[i])
    check("every gap is shorter than the one before",
        gaps.every((gap, i) => i === 0 || gap < gaps[i - 1]), true)
    check("it starts at zero, so the first beat is immediate", offsets[0], 0)
    check("there is a beat for each gap plus the impact", offsets.length, gaps.length + 1)
    // Long enough to run, short enough that nobody stands there bored. Theirs
    // is about thirteen seconds; this is under nine.
    check("the fuse is between four and nine seconds",
        fuseTicks() > 80 && fuseTicks() < 180, true)
    check("and the impact lands at the end", fuseTicks(), beatOffsets().at(-1))
}

console.log("\n— aiming —")
{
    const p = holder()
    // Nothing in the way: it still fires, at maximum range along the same line.
    // A strike that refused because there was no roof would be a strange weapon.
    setSetting("nuke.range", "100")
    const far = aimPoint(p)
    check("looking at nothing still gives a target", Math.round(far.z), 100)
    check("at the same height they are looking", Math.round(far.y), 66)

    // A block in the way wins, and the point sits ON it rather than inside.
    p.getBlockFromViewDirection = () => ({ block: { location: { x: 10, y: 70, z: 20 } } })
    check("a block in the way is the target", aimPoint(p), { x: 10.5, y: 71, z: 20.5 })
    resetSetting("nuke.range")
}
console.log("\n— the strike itself: real TNT, in a spiral, falling —")
// The first version was a handful of createExplosion calls: an effect that
// LOOKED like a strike. The thing it copies is not an effect — it is hundreds
// of primed TNT hanging in the sky and coming down together, and you can watch
// them fall. No number of scripted blasts gets there.
{
    armNuke(true)
    const p = holder()
    p.getBlockFromViewDirection = () => ({ block: { location: { x: 0, y: 64, z: 30 } } })

    __test.timers.length = 0
    __test.explosions.length = 0
    __test.spawned.length = 0
    check("it reports that it went out", orbitalStrike(p), true)

    // Nothing yet — the warning is the point, and it is three seconds of it.
    check("nothing is in the sky at the moment it is called", __test.spawned.length, 0)
    __test.runTimers()

    const tnt = __test.spawned.filter(e => e.typeId === "minecraft:tnt")
    check("hundreds of primed TNT go up", tnt.length >= 150, true)
    // All at one height, because the fall IS the timing: nothing can set a TNT
    // fuse, so they have to start level to land level.
    check("all at one height", new Set(tnt.map(e => Math.round(e.location.y))).size, 1)
    check("well above the target", tnt[0].location.y - 64 > 40, true)
    // Spread around the target, not stacked on it.
    check("spread out around the centre",
        tnt.some(e => Math.hypot(e.location.x, e.location.z - 30) > 10), true)
    // Read from the setting rather than a number written here — the width is
    // tunable and a test that pins it only proves it was not changed.
    const width = Number(setting("nuke.spiralRadius"))
    check("and none of them beyond the spiral's width",
        tnt.every(e => Math.hypot(e.location.x, e.location.z - 30) <= width + 1), true)
    check("which is wide enough to be a strike, not a firework", width >= 40, true)

    // The scripted blasts are gone from this path — TNT does its own damage.
    check("no scripted explosions when the TNT is real", __test.explosions.length, 0)
}

console.log("\n— block damage off keeps the sound and loses the hole —")
{
    // TNT cannot be told not to break things, so the setting decides WHICH of
    // the two you get rather than tuning one of them.
    setSetting("nuke.breaksBlocks", "false")
    const p = holder()
    p.getBlockFromViewDirection = () => ({ block: { location: { x: 0, y: 64, z: 30 } } })
    __test.timers.length = 0
    __test.explosions.length = 0
    __test.spawned.length = 0
    orbitalStrike(p)
    __test.runTimers()
    check("no TNT is spawned at all",
        __test.spawned.filter(e => e.typeId === "minecraft:tnt").length, 0)
    check("scripted blasts instead", __test.explosions.length > 0, true)
    check("and every one of them breaks nothing",
        __test.explosions.every(e => e.options.breaksBlocks === false), true)
    resetSetting("nuke.breaksBlocks")
}

console.log("\n— the spiral is a spiral —")
{
    const pts = spiralPoints(320, 5, 48, 3)
    check("it makes what it was asked for", pts.length, 320)
    check("nothing outside the radius",
        pts.every(p => Math.hypot(p.x, p.z) <= 48.001), true)
    // Dense at the CENTRE, which is what the reference looks like — and the
    // density is per area, not per count. r grows linearly with the step, so
    // the inner and outer halves hold the same NUMBER of shells while the inner
    // half is a quarter of the area. Using sqrt(t) would even out the area and
    // draw a flat disc instead of a galaxy.
    const inner = pts.filter(p => Math.hypot(p.x, p.z) < 24).length
    check("the halves hold the same count", Math.abs(inner - pts.length / 2) <= 5, true)
    check("so the inner half is four times as dense", inner / (Math.PI * 24 ** 2) >
        (pts.length - inner) / (Math.PI * (48 ** 2 - 24 ** 2)), true)
    // Several arms, which is what makes it read as a spiral rather than a coil.
    const armCount = new Set(pts.map(p => Math.round(p.t * 1000))).size
    check("the arms are in step with each other", armCount, 320 / 5)
    check("one arm still works", spiralPoints(10, 1, 5, 1).length, 10)
    // A mis-typed setting must give a plain strike, never no strike.
    check("zero arms still fires", spiralPoints(10, 0, 5, 1).length > 0, true)
    check("and so does a negative", spiralPoints(10, -3, 5, 1).length > 0, true)
}


armNuke(false)


console.log("\n— they land before the fuse runs out, which is the whole trick —")
// Reported from a world: "it only skins the surface". That was arithmetic, not
// taste. A TNT fuse is 80 ticks and nothing can set it, so the drop height is
// the only way to choose WHERE a shell goes off — and the old 78 blocks takes
// 79 ticks to fall, so they detonated at the instant they arrived.
//
// So this asserts the RELATIONSHIP rather than the number: whatever the height
// is set to, the fall has to finish with fuse left over. Pinning 68 would only
// prove nobody changed it.
{
    // The old height, pinned as the thing that was wrong: 78 blocks is a
    // 79-tick fall, one tick inside the fuse. And 80 blocks does not make it
    // at all, which is why there is no room to simply drop it from higher.
    check("the fall is modelled, not guessed: 78 blocks took 79 ticks",
        fallTicks(78), 79)
    check("and 80 blocks never lands in time", fallTicks(80) > TNT_FUSE, true)
    check("the first blocks are slow, because it accelerates", fallTicks(1), 7)

    const height = Number(setting("nuke.height"))
    const landed = fallTicks(height)
    check("the shells reach the ground before the fuse ends", landed < TNT_FUSE, true)
    check("with enough left to be sitting on it, not skimming past",
        TNT_FUSE - landed >= 5, true)
    // The other end: a shell that lands with half its fuse to spare is a lit
    // stick of TNT lying in the open for two seconds, which anyone can outrun.
    check("but not so much that you could walk away from it",
        TNT_FUSE - landed <= 20, true)
    check("the shipped default is what the setting says", height, DROP_HEIGHT)
    // High enough that you watch it come down. Below this it is a dropped
    // block, not a strike.
    check("and still a fall worth watching", height >= 40, true)

    // The real path agrees with the arithmetic — the spawn height is what
    // fallTicks was asked about, not a second number that drifted.
    armNuke(true)
    const p = holder()
    p.getBlockFromViewDirection = () => ({ block: { location: { x: 0, y: 64, z: 30 } } })
    __test.timers.length = 0
    __test.spawned.length = 0
    orbitalStrike(p)
    __test.runTimers()
    const tnt = __test.spawned.filter(e => e.typeId === "minecraft:tnt")
    // Measured from the aim point, which sits ON the block rather than in it —
    // that surface is the ground the shells are falling towards.
    check("and the shells really do go up that far",
        Math.round(tnt[0].location.y - aimPoint(p).y), height)
    // Put the switch back the way the next section expects to find it.
    armNuke(false)
}

console.log("\n— a locked item says everything it needs, and where —")
// Reporting one lock per attempt is what made the Orbital Strike maddening: you
// were told it was not armed, armed it, and were then told about developer mode
// — a second errand you could have run at the same time if anybody had said so.
{
    const who = (tags, op) => ({
        id: `lock-${tags.join()}-${op}`, name: "W", typeId: "minecraft:player",
        getTags: () => tags, commandPermissionLevel: op ? 1 : 0
    })
    const plain = who([], false)
    const op = who([], true)
    const dev = who(["Dev"], true)

    // A member is missing all three, and hears about all three.
    check("a member is told every lock at once", nukeMissing(plain).length, 3)
    // An operator holds the troll node already (has() passes an op through any
    // node no rank denies), so they are down to two.
    check("an operator is told the two that are left", nukeMissing(op).length, 2)
    check("with the Dev tag, only arming remains", nukeMissing(dev).length, 1)
    check("and arming it clears the list", (armNuke(true), nukeMissing(dev)), [])
    armNuke(false)

    // Every line has to be actionable — it names the switch, not the symptom.
    for (const line of nukeMissing(plain)) {
        check(`"${line.replace(/§./g, "").slice(0, 28)}…" says where to go`,
            /Ranks ▸|\/mode|Console|operator/.test(line), true)
    }
}

console.log("\n— and it names the switch the way the editor does —")
// "Ranks ▸ the rank ▸ What it can do ▸ Pranks ▸ smite", not "admin.smite".
// The node id is what the code says; the path is the buttons somebody taps to
// reach the switch, in the words those buttons use. Since 2.7.9 the switches
// sit behind a rank's "What it can do" button. Derived from nodeLabels so it
// cannot drift.
{
    const at = "Ranks ▸ the rank ▸ What it can do ▸ "
    check("a prank node", whereToGrant("admin.smite"), `${at}Pranks ▸ smite`)
    check("and its dangerous twin", whereToGrant("admin.sudo"), `${at}Pranks ▸ sudo`)
    check("a punishment node", whereToGrant("admin.banperm"), `${at}Punishments ▸ banperm`)
    // The 55-switch Operator group is gone, so a cmd.* node has no button to
    // point at any more — and nothing asks it to. The single switch that
    // replaced them does have one.
    check("a vanilla command node has no button now", whereToGrant("cmd.kill"), `${at}cmd.kill`)
    check("but the one switch that gates them all does",
        whereToGrant("admin.commands"), `${at}Server settings ▸ commands`)
    // Every label it can produce must be one the editor would actually show.
    for (const [group, nodes] of Object.entries(PERMISSION_NODES)) {
        const labels = nodeLabels(nodes)
        const wrong = nodes.filter((n, i) => whereToGrant(n) !== `${at}${group} ▸ ${labels[i]}`)
        check(`${group}: every node points at its real button`, wrong, [])
    }
    // A node nobody lists still gets a usable answer rather than a crash.
    check("an unknown node does not throw", whereToGrant("made.up"), `${at}made.up`)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
