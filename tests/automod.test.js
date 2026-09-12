import { __test } from "@minecraft/server"
import { readFileSync } from "node:fs"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import {
    noteOre, drainFinishedVeins, noteBreak, noteChat,
    describeVein, oreThresholds, liveVeins, forgetPlayer,
    spamStrike, spamStrikesOn, forgetStrikes, spamLadder, spamPenalty
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

console.log("\n— typing fast is not spamming —")
// One threshold had to be either chatty or strict, so it was set high enough
// not to punish ordinary excitement and therefore high enough to miss real
// flooding. Two lines: over the first you are TOLD, over the second it is a
// strike.
setSetting("automod.spamRate", "5")
setSetting("automod.spamHard", "9")
forgetPlayer(other.id)
{
    const seen = []
    for (let i = 0; i < 12; i++) {
        const verdict = noteChat(other, t0)
        if (verdict) seen.push(verdict.kind)
    }
    check("crossing the first line says you are typing fast", seen[0], "fast")
    check("and carrying on past the second says you are spamming", seen[1], "spam")
    check("each is said once per window, not once per message", seen.length, 2)
}
check("a fresh window is clean", noteChat(other, t0 + 11000), undefined)

// A burst that never reaches the hard line is only ever "fast". This is the
// case the whole split exists for: three quick "yes" in an argument must not
// put anything on somebody's record.
forgetPlayer(other.id)
{
    const seen = []
    for (let i = 0; i < 7; i++) {
        const verdict = noteChat(other, t0)
        if (verdict) seen.push(verdict.kind)
    }
    check("a short burst is never called spam", seen, ["fast"])
}

console.log("\n— strikes escalate, and are forgotten —")
setSetting("automod.spamLadder", "0, 60, 300, 600")
setSetting("automod.spamForget", "30")
forgetStrikes(other.id)
{
    check("the first strike is a talking-to", spamPenalty(spamStrike(other, t0)), 0)
    check("the second is a minute", spamPenalty(spamStrike(other, t0 + 1000)), 60)
    check("the third is five", spamPenalty(spamStrike(other, t0 + 2000)), 300)
    check("the fourth is ten", spamPenalty(spamStrike(other, t0 + 3000)), 600)
    // The last rung repeats rather than falling off the end — a four-entry
    // ladder must not quietly stop punishing on the fifth offence.
    check("and the fifth is ten as well", spamPenalty(spamStrike(other, t0 + 4000)), 600)

    check("strikes are visible without adding one", spamStrikesOn(other, t0 + 5000), 5)
    // Behave for the window and you start clean. Without this the ladder is
    // permanent for the session and a second offence an hour later lands on
    // the ten-minute rung, which reads as broken rather than strict.
    check("an old strike is forgotten entirely, not decremented",
        spamStrikesOn(other, t0 + 31 * 60000), 0)
    check("so the next one starts at the beginning",
        spamStrike(other, t0 + 31 * 60000), 1)
}

// A mis-typed ladder must not mean "automod stopped punishing".
setSetting("automod.spamLadder", "not a ladder")
check("nonsense falls back to the shipped ladder", spamLadder(), [0, 60, 300, 600])
setSetting("automod.spamLadder", "0, 30")
check("a shorter ladder is honoured", spamPenalty(2), 30)
check("and its last rung repeats", spamPenalty(9), 30)

for (const k of ["automod.spamRate", "automod.spamHard", "automod.spamLadder", "automod.spamForget"]) resetSetting(k)
forgetStrikes(other.id)
forgetPlayer(other.id)


console.log("\n— switches gate the checks —")
setSetting("automod.breaks", "false")
forgetPlayer(miner.id)
let off = 0
for (let i = 0; i < 40; i++) if (noteBreak(miner, t0)) off++
check("break checking off means no flags", off, 0)
setSetting("automod.spam", "false")
check("spam checking off means no flags", noteChat(other, t0 + 40000), undefined)
for (const k of ["automod.breaks", "automod.spam", "automod.breakRate", "automod.spamRate"]) resetSetting(k)


console.log("\n— automod acts on spam, and says who did it —")
// This reverses what the file used to state: "nothing is ever punished
// automatically". That rule was right about GUESSES — an ore vein or a
// break-rate flag might be innocent, and those still only alert. Flooding chat
// is counted, not inferred, and the person doing it knows they are doing it.
{
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/automod.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    check("spam reaches the mute call", /mute\(player, seconds \* 1000/.test(code), true)
    // The ladder decides, not a number written at the call site.
    check("the length comes from the ladder, not a literal",
        /spamPenalty\(strike\)/.test(code), true)
    check("a zero rung is a talking-to rather than a zero-length mute",
        /if \(!seconds\)/.test(code), true)

    // The tag. A mute nobody chose has to say it was automatic, or the first
    // thing the player does is accuse whoever is online.
    check("automod speaks as [Automod]", code.includes('"§6§l[Automod] §r"'), true)
    check("and never borrows the pack's own prefix",
        /CONFIG\.brand\.prefix/.test(code), false)

    // Typing fast reaches none of it.
    check("typing fast is answered without a strike",
        /verdict\.kind === "fast"[\s\S]{0,200}?return/.test(code), true)
    check("and staff are not told about it",
        /kind === "fast"[\s\S]{0,160}?alertStaff/.test(code), false)

    // Ore and break checks stay advisory — the reversal is about spam only.
    check("ore veins still only alert",
        /reportVein[\s\S]{0,300}?mute\(/.test(code), false)
}

console.log("\n— a timed mute says when it is over —")
// Nothing did. A mute with a length announced itself at the start and the only
// way to find out it had lifted was to try talking, so a one-minute mute felt
// exactly like a permanent one until you guessed right.
{
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/core/moderation.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    check("a sweep runs on a timer", /runInterval\(sweepExpiredMutes/.test(code), true)
    // The tag being on while the record is dead means exactly one thing: this
    // expired and nobody has been told. No extra state, nothing lost to a
    // reload, and it works for mutes laid down before the sweep existed.
    check("it finds them by the tag outliving the record",
        /if \(!held \|\| active\(held\)\) continue[\s\S]{0,120}?hasMuteTag\(player\)/.test(code), true)
    check("the tag comes off", /removeTag\(MUTE_TAG\)/.test(code), true)
    check("the record goes with it", /mutes\.delete\(player\.id\)/.test(code), true)
    check("and the player is told", /Your mute has ended/.test(code), true)
    // An automod mute ends in automod's voice, not the pack's — the same reason
    // it started in automod's voice.
    check("in the voice that muted them", /by === "Automod"/.test(code), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
