import { __test } from "@minecraft/server"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import {
    noteOre, drainFinishedVeins, noteBreak, noteChat,
    describeVein, oreThresholds, liveVeins, forgetPlayer
} from "../Admin+ BP/scripts/core/automod.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name) {
    const p = {
        id: `am${nextId++}`, name,
        location: { x: 0, y: 12, z: 0 },
        dimension: { id: "minecraft:overworld" },
        sendMessage: () => {}
    }
    __test.players.push(p)
    return p
}
const at = (x, y, z) => ({ x, y, z })
const miner = fakePlayer("Nova")
const other = fakePlayer("Alex")
const t0 = 1000000

console.log("\n— a vein is one find, however many blocks —")
// Eight diamond blocks in a tight cluster, mined one after another.
let finished
for (let i = 0; i < 8; i++) {
    finished = noteOre(miner, "minecraft:diamond_ore", at(100 + (i % 3), 12, -300 + Math.floor(i / 3)), t0 + i * 400)
    if (finished) break
}
check("nothing is reported mid-vein", finished, undefined)
check("one vein is being followed", liveVeins(), [{ id: miner.id, name: "Nova", ore: "diamond_ore", count: 8 }])

const drained = drainFinishedVeins(t0 + 60000)
check("closing it gives ONE alert", drained.length, 1)
check("carrying the whole vein size", drained[0].count, 8)
check("worded the Skeppy way", describeVein(drained[0]), "x8 diamond ore")
check("with where it was", [drained[0].at.x, drained[0].at.z], [100, -300])

console.log("\n— mining somewhere else is a separate find —")
noteOre(miner, "minecraft:diamond_ore", at(100, 12, -300), t0)
noteOre(miner, "minecraft:diamond_ore", at(101, 12, -300), t0 + 500)
noteOre(miner, "minecraft:diamond_ore", at(102, 12, -300), t0 + 1000)
// 40 blocks away: a new vein, and the old one is handed back at once.
const closed = noteOre(miner, "minecraft:diamond_ore", at(140, 12, -300), t0 + 1500)
check("the previous vein is reported immediately", closed && closed.count, 3)
check("and the new one starts at one", liveVeins()[0].count, 1)
forgetPlayer(miner.id)

console.log("\n— a small find stays quiet —")
noteOre(miner, "minecraft:diamond_ore", at(0, 12, 0), t0)
noteOre(miner, "minecraft:diamond_ore", at(1, 12, 0), t0 + 200)   // 2 < threshold of 3
check("two diamonds is not news", drainFinishedVeins(t0 + 60000).length, 0)

console.log("\n— switching ore closes the old vein —")
noteOre(miner, "minecraft:diamond_ore", at(0, 12, 0), t0)
noteOre(miner, "minecraft:diamond_ore", at(1, 12, 0), t0 + 100)
noteOre(miner, "minecraft:diamond_ore", at(2, 12, 0), t0 + 200)
const swapped = noteOre(miner, "minecraft:ancient_debris", at(2, 12, 1), t0 + 300)
check("the diamond vein is handed back", swapped && [swapped.ore, swapped.count], ["diamond_ore", 3])
check("and debris is now being followed", liveVeins()[0].ore, "ancient_debris")
forgetPlayer(miner.id)

console.log("\n— radius is configurable —")
setSetting("automod.veinRadius", "2")
noteOre(miner, "minecraft:diamond_ore", at(0, 12, 0), t0)
const tooFar = noteOre(miner, "minecraft:diamond_ore", at(6, 12, 0), t0 + 100)
check("6 blocks apart is a different vein at radius 2", tooFar !== undefined || liveVeins()[0].count === 1, true)
forgetPlayer(miner.id)
resetSetting("automod.veinRadius")

console.log("\n— unwatched blocks never start a vein —")
noteOre(miner, "minecraft:stone", at(0, 12, 0), t0)
check("stone is ignored", liveVeins().length, 0)

console.log("\n— players are followed separately —")
for (let i = 0; i < 3; i++) noteOre(miner, "minecraft:diamond_ore", at(i, 12, 0), t0 + i * 100)
for (let i = 0; i < 3; i++) noteOre(other, "minecraft:diamond_ore", at(200 + i, 12, 0), t0 + i * 100)
check("two veins", liveVeins().length, 2)
check("two alerts", drainFinishedVeins(t0 + 60000).map(v => v.name).sort(), ["Alex", "Nova"])

console.log("\n— thresholds —")
setSetting("automod.oreThresholds", "iron_ore:3, diamond_ore:1")
check("parsed", oreThresholds(), { iron_ore: 3, diamond_ore: 1 })
setSetting("automod.oreThresholds", "")
check("blank falls back to defaults", oreThresholds().diamond_ore, 3)
setSetting("automod.oreThresholds", "???")
check("nonsense falls back too", oreThresholds().diamond_ore, 3)
resetSetting("automod.oreThresholds")

console.log("\n— break rate flags once per burst —")
setSetting("automod.breakRate", "10")
let flags = 0
for (let i = 0; i < 40; i++) if (noteBreak(miner, t0)) flags++
check("flagged once", flags, 1)
check("a new second starts clean", noteBreak(miner, t0 + 1000), 0)
forgetPlayer(miner.id)

console.log("\n— chat flooding —")
setSetting("automod.spamRate", "5")
let spam = 0
for (let i = 0; i < 12; i++) if (noteChat(other, t0)) spam++
check("flagged once", spam, 1)
check("a fresh window is clean", noteChat(other, t0 + 11000), 0)

console.log("\n— switches gate the checks —")
setSetting("automod.breaks", "false")
forgetPlayer(miner.id)
let off = 0
for (let i = 0; i < 40; i++) if (noteBreak(miner, t0)) off++
check("break checking off means no flags", off, 0)
setSetting("automod.spam", "false")
check("spam checking off means no flags", noteChat(other, t0 + 40000), 0)
for (const k of ["automod.breaks", "automod.spam", "automod.breakRate", "automod.spamRate"]) resetSetting(k)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
