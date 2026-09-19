import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, getRank, RANK_VALUES, valueFor } from "../Admin+ BP/scripts/core/ranks.js"
import {
    candidate, landingY, findSpot, rtpRange, rtpMinimum, rtpTries
} from "../Admin+ BP/scripts/core/rtp.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const player = {
    id: "r-1", name: "Wanderer", nameTag: "Wanderer",
    location: { x: 0, y: 64, z: 0 },
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
}
__test.players.push(player)
setRanks(player.id, ["member"], player.name)

/**
 * A world you can describe in one object.
 *
 * `ground(x, z)` returns the Y of the surface, or undefined for "nothing to
 * stand on here". `loaded(x, z)` decides whether the column can be read at all
 * — an unloaded chunk hands back undefined in the real API rather than
 * throwing, and that difference is the whole reason findSpot can be cheap.
 */
function fakeWorld({ id = "minecraft:overworld", ground, loaded = () => true, throwAt } = {}) {
    const block = (y, solid, liquid = false) => ({
        location: { y }, isAir: !solid && !liquid, isLiquid: liquid
    })
    return {
        id,
        getBlock({ x, y, z }) {
            if (throwAt && throwAt(x, z)) throw new Error("chunk gone")
            if (!loaded(x, z)) return undefined
            const top = ground(x, z)
            if (top === undefined) return block(y, false)
            if (y === top) return block(y, true)
            if (y < top) return block(y, true)
            return block(y, false)
        },
        getTopmostBlock({ x, z }) {
            const top = ground(x, z)
            return top === undefined ? undefined : block(top, true)
        }
    }
}

const flatAt = y => fakeWorld({ ground: () => y })

console.log("\n— it looks in a ring, not a square —")
// A uniform square puts a quarter of every attempt near spawn, which is the one
// place somebody asking to be sent elsewhere does not want to land.
{
    const spots = []
    for (let i = 0; i < 400; i++) {
        spots.push(candidate({ x: 0, z: 0 }, 1000, 200, Math.random))
    }
    const distances = spots.map(s => Math.hypot(s.x, s.z))
    check("nothing lands inside the minimum", distances.every(d => d >= 199), true)
    check("and nothing lands beyond the range", distances.every(d => d <= 1001), true)

    // Both signs in both axes, or the "ring" is an arc and everybody ends up in
    // the same quadrant.
    check("it reaches all four quadrants",
        [spots.some(s => s.x > 0 && s.z > 0), spots.some(s => s.x < 0 && s.z > 0),
         spots.some(s => s.x > 0 && s.z < 0), spots.some(s => s.x < 0 && s.z < 0)],
        [true, true, true, true])
}

console.log("\n— it searches around YOU, not around the origin —")
{
    const far = candidate({ x: 10000, z: -10000 }, 500, 100, () => 0.5)
    check("the ring is centred on where they stand",
        Math.hypot(far.x - 10000, far.z + 10000) <= 501, true)
}

console.log("\n— what counts as somewhere to stand —")
{
    const world = flatAt(70)
    check("flat ground is fine", landingY(world, 100, 100), 70)

    // Air above matters as much as ground below: solid-on-solid is the inside
    // of a mountain, and landing there is suffocation.
    const buried = fakeWorld({ ground: () => 70 })
    const original = buried.getBlock.bind(buried)
    buried.getBlock = ({ x, y, z }) => y === 71
        ? { location: { y }, isAir: false, isLiquid: false }
        : original({ x, y, z })
    check("solid ground with no room above is not", landingY(buried, 0, 0), undefined)

    const ocean = fakeWorld({ ground: () => undefined })
    check("open water or void is not", landingY(ocean, 0, 0), undefined)
}

console.log("\n— an unloaded chunk costs one candidate, not the command —")
{
    const world = fakeWorld({ ground: () => 70, loaded: () => false })
    check("nothing is read from it", landingY(world, 0, 0), undefined)

    // And a chunk that disappears MID-SCAN throws in the real API. A throw here
    // would take the whole command down instead of costing one attempt.
    const flaky = fakeWorld({ ground: () => 70, throwAt: () => true })
    let threw = false
    try { landingY(flaky, 0, 0) } catch { threw = true }
    check("a chunk vanishing mid-read does not throw", threw, false)
}

console.log("\n— the Nether's ceiling is a block, so topmost is the roof —")
// The bug this exists to prevent: /rtp in the Nether dropping people on top of
// the world, above the bedrock, where there is nothing and no way down.
{
    const nether = fakeWorld({ id: "minecraft:nether", ground: () => 60 })
    check("it scans down and finds real ground", landingY(nether, 0, 0), 60)

    // A roof at 127 with the floor far below: the overworld route would return
    // the roof. The downward scan must not.
    const roofed = {
        id: "minecraft:nether",
        getBlock: ({ y }) => ({
            location: { y },
            isAir: !(y <= 60 || y >= 127),
            isLiquid: false
        }),
        getTopmostBlock: () => ({ location: { y: 127 }, isAir: false, isLiquid: false })
    }
    check("never the ceiling", landingY(roofed, 0, 0), 60)
}

console.log("\n— finding a spot, and giving up —")
{
    const world = flatAt(70)
    const spot = findSpot(player, world)
    check("it found somewhere", spot !== undefined, true)
    check("one above the ground", spot.y, 71)
    // Centred in the block, like every other teleport here — an integer edge
    // drops people through the floor often enough to be worth the half.
    //
    // Measured as the offset from the block BELOW, not with `% 1`. JavaScript's
    // remainder keeps the sign of the left operand, so a perfectly centred
    // x = -10.5 reads as -0.5 — and since the direction is random this failed
    // only on runs that happened to go west. A flaky assertion is worse than a
    // wrong one, because it teaches people to re-run instead of to look.
    const offset = n => n - Math.floor(n)
    check("centred in the block", [offset(spot.x), offset(spot.z)], [0.5, 0.5])

    // Driven from both directions on purpose, rather than trusting one roll.
    const west = findSpot({ location: { x: -9000, y: 64, z: -9000 } }, world)
    check("and still centred going west", [offset(west.x), offset(west.z)], [0.5, 0.5])

    const ocean = fakeWorld({ ground: () => undefined })
    check("a world of water gives up rather than hanging", findSpot(player, ocean), undefined)
}

console.log("\n— the search is BOUNDED, which is what stops the watchdog —")
// An unbounded retry loop on an ocean world spins inside one tick and is killed
// by Bedrock's watchdog, which reads as the pack crashing rather than as the sea.
{
    let reads = 0
    const ocean = {
        id: "minecraft:overworld",
        getBlock: () => { reads++; return { location: { y: 0 }, isAir: true, isLiquid: false } },
        getTopmostBlock: () => undefined
    }
    setSetting("rtp.tries", "10")
    findSpot(player, ocean)
    check("it stopped after the configured number of attempts", reads <= 10, true)
    check("and the setting is what bounded it", rtpTries(), 10)
    resetSetting("rtp.tries")

    setSetting("rtp.tries", "9999")
    check("an absurd setting is still capped", rtpTries(), 64)
    resetSetting("rtp.tries")
}

console.log("\n— the range settings —")
{
    check("a sane range is used", rtpRange() >= 64, true)
    setSetting("rtp.range", "1200")
    check("and it is configurable", rtpRange(), 1200)
    setSetting("rtp.range", "10")
    check("something too small to be useful falls back", rtpRange(), 4000)
    resetSetting("rtp.range")

    setSetting("rtp.minimum", "500")
    check("the minimum is configurable too", rtpMinimum(), 500)
    resetSetting("rtp.minimum")
}

console.log("\n— a minimum bigger than the range does not invert the ring —")
// Left unguarded this produces a negative span, and every candidate lands in
// exactly one place — the furthest ring, in a straight line.
{
    setSetting("rtp.range", "500")
    setSetting("rtp.minimum", "5000")
    const spots = []
    for (let i = 0; i < 50; i++) spots.push(findSpot(player, flatAt(70)))
    const found = spots.filter(Boolean)
    check("it still finds somewhere", found.length > 0, true)
    check("and not all in the same place",
        new Set(found.map(s => `${s.x},${s.z}`)).size > 1, true)
    resetSetting("rtp.range")
    resetSetting("rtp.minimum")
}

console.log("\n— the cooldown is a rank value like the others —")
{
    check("it is declared", RANK_VALUES["rtp.cooldown"].kind, "cooldown")
    check("and defaults to the longest of them",
        RANK_VALUES["rtp.cooldown"].fallback >= RANK_VALUES["home.cooldown"].fallback, true)
    saveRank("member", { meta: { ...getRank("member")?.meta, "rtp.cooldown": 90 } })
    check("it resolves off the rank", valueFor(player, "rtp.cooldown"), 90)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
