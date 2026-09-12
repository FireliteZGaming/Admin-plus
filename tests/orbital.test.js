import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import {
    canNuke, nukeBlockedBy, nukeArmed, armNuke,
    beatOffsets, fuseTicks, aimPoint, orbitalStrike
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
    saveRank("nobombs", { display: "§7NoBombs", perms: ["-admin.troll"] })
    const denied = holder({ rank: "nobombs" })
    check("an explicit denial closes it", canNuke(denied), false)
    check("and says which lock", nukeBlockedBy(denied).includes("Staff tools"), true)
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

console.log("\n— the strike itself —")
{
    armNuke(true)
    const p = holder()
    p.getBlockFromViewDirection = () => ({ block: { location: { x: 0, y: 64, z: 30 } } })

    __test.timers.length = 0
    __test.explosions.length = 0
    check("it reports that it went out", orbitalStrike(p), true)

    // Nothing has happened yet — that is the whole design. Everything is
    // scheduled, so there is time to get out of the way.
    check("nothing has exploded at the moment it is called",
        __test.explosions.length, 0)
    check("but a queue of work exists", __test.timers.length > 0, true)

    __test.runTimers()
    check("after the fuse, it has gone off", __test.explosions.length > 0, true)
    // One central blast and a ring: a single explosion of the same size reads
    // as a pop and a crater rather than as something arriving.
    check("one blast is bigger than the rest",
        __test.explosions.filter(e => e.radius === 12).length, 1)
    check("and the ring is around it, not on it",
        __test.explosions.filter(e => e.radius < 12).length, 6)
    check("the ring sits at the same height as the centre",
        new Set(__test.explosions.map(e => Math.round(e.location.y))).size, 1)
    check("nothing is set on fire — that is what the block setting is for",
        __test.explosions.every(e => e.options.causesFire === false), true)

    // Block damage is a setting, and it has to actually reach the explosion.
    setSetting("nuke.breaksBlocks", "false")
    __test.timers.length = 0
    __test.explosions.length = 0
    orbitalStrike(p)
    __test.runTimers()
    check("turning block damage off reaches every blast",
        __test.explosions.every(e => e.options.breaksBlocks === false), true)
    resetSetting("nuke.breaksBlocks")

    setSetting("nuke.radius", "30")
    __test.timers.length = 0
    __test.explosions.length = 0
    orbitalStrike(p)
    __test.runTimers()
    check("the size setting reaches it too",
        __test.explosions.some(e => e.radius === 30), true)
    resetSetting("nuke.radius")

    // A player with no dimension is somebody who left mid-cast.
    check("somebody who is nowhere is reported, not thrown at",
        orbitalStrike({ id: "gone" }), false)
}

armNuke(false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
