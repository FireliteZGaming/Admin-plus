import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { world } from "@minecraft/server"
import { missingCapabilities, BETA_NOTICE } from "../Admin+ BP/scripts/core/health.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— the notice reads as asked —")
check("blue Beta-APIs", BETA_NOTICE.includes("§9Beta-API's"), true)
check("red Update/Install", BETA_NOTICE.includes("§cUpdate/Install"), true)
check("grey around both", BETA_NOTICE.startsWith("§7Turn on ") && BETA_NOTICE.includes("§7or "), true)

console.log("\n— probing —")
// The test runtime provides chatSend and startup but no block events, which is
// exactly the "surface moved" case this is meant to catch.
const missing = missingCapabilities()
check("a genuinely absent capability is reported", missing.some(m => m.id === "blocks"), true)
check("a present one is not", missing.some(m => m.id === "chat"), false)
check("each missing item says what stops working", missing.every(m => m.label.length > 5), true)

console.log("\n— nothing missing reads clean —")
const realBreak = world.beforeEvents.playerBreakBlock
world.beforeEvents.playerBreakBlock = { subscribe: () => {} }
check("with every surface present, nothing is reported", missingCapabilities().length, 0)
world.beforeEvents.playerBreakBlock = realBreak

console.log("\n— a surface disappearing is caught, not assumed —")
const realChat = world.beforeEvents.chatSend
world.beforeEvents.chatSend = undefined
check("losing chat is reported", missingCapabilities().some(m => m.id === "chat"), true)
world.beforeEvents.chatSend = realChat
check("and restored when it comes back", missingCapabilities().some(m => m.id === "chat"), false)

console.log("\n— the watchdog functions, which are data and not script —")
// These are the only channel that reaches a player when the scripts never
// start, so they are worth asserting on directly. The bug they encode: the
// heartbeat used to create its objectives behind
//   execute unless score #timer ap_tick matches 0.. run function admin/init
// on the assumption that a missing objective reads as "no score". On Bedrock it
// does not — naming an objective that does not exist fails the whole execute,
// so the unless never fired, the objectives were never created, and every score
// test in the watchdog AND in /function check silently did nothing. Creating
// them outright is the only form that cannot deadlock.
const fn = (name) => readFileSync(new URL(`../Admin+ BP/functions/${name}`, import.meta.url), "utf8")
    .split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith("#"))

const heartbeat = fn("admin/heartbeat.mcfunction")
const creates = heartbeat.filter(l => l.startsWith("scoreboard objectives add "))
check("the heartbeat creates all three objectives itself", creates.length, 3)
check("unconditionally, so it cannot deadlock", creates.every(l => !l.includes("execute")), true)
check("ap_alive among them", creates.some(l => l.includes("ap_alive")), true)
check("ap_tick among them", creates.some(l => l.includes("ap_tick")), true)
check("ap_seen among them", creates.some(l => l.includes("ap_seen")), true)

const chk = fn("check.mcfunction")
check("check materialises the heartbeat score before reading it",
    chk.some(l => l.startsWith("scoreboard players add @s ap_alive 0")), true)
check("and always prints something, whatever the scores say",
    chk.some(l => l.startsWith("tellraw")), true)
check("including the raw heartbeat, so a bad state is visible",
    chk.some(l => l.includes('"objective":"ap_alive"')), true)
check("both verdicts are still there",
    chk.some(l => l.includes("if entity")) && chk.some(l => l.includes("unless entity")), true)
check("playsound coordinates are three, not one",
    chk.some(l => l.includes("playsound") && l.trim().endsWith("~ ~ ~")), true)

console.log("\n— no Java-style fake players anywhere in the functions —")
// The bug this pins, straight from the content log:
//   Syntax error: Unexpected "#": at " if score >>#<<script ap_"
// Bedrock rejects "#" in a command target. A datapack habit put "#script" and
// "#timer" in here; every conditional line failed to parse, each file was
// dropped WHOLE as unparseable, and the symptoms were two apparently separate
// bugs: /function check printed nothing, and tick.json reported
// admin/heartbeat "not found". One cause, one character.
const FN_FILES = ["check.mcfunction", "healthcheck.mcfunction",
    "admin/heartbeat.mcfunction", "admin/init.mcfunction", "admin/warn.mcfunction"]

for (const file of FN_FILES) {
    const offending = fn(file).filter(line => /(^|[ =,{])#/.test(line))
    check(`${file} addresses no # fake player`, offending, [])
}
check("the watchdog counts down on real players instead",
    fn("admin/heartbeat.mcfunction").some(l => l.startsWith("scoreboard players remove @a ap_alive")), true)
check("and warns them one at a time",
    fn("admin/heartbeat.mcfunction").some(l => l.includes("run function admin/warn")), true)

// The join-time safety net. Somebody who installs the pack without enabling
// Beta APIs gets no script at all, so this data-only path is the ONLY thing
// that can tell them — and it has to speak up on arrival, not a minute later.
const hb = fn("admin/heartbeat.mcfunction")
check("a player the watchdog has not met is primed",
    hb.some(l => l.includes("ap_seen") && l.includes("add @a")), true)
check("their timer starts already due, so the warning is immediate",
    hb.some(l => l.includes("ap_seen=0") && l.includes("ap_tick 1200")), true)
check("and they are marked as met, so it does not repeat forever",
    hb.some(l => l.includes("ap_seen=0") && l.includes("ap_seen 1")), true)

// -40 rather than 0 is what stops a false alarm: a player who joins a HEALTHY
// world sits at 0 until the script's next heartbeat tops them up.
check("dead is measured well below zero, not at it",
    hb.some(l => l.includes("ap_alive=..-40")), true)
check("and the warning agrees with the watchdog",
    fn("admin/warn.mcfunction").every(l => !l.includes("ap_alive=..0")), true)
check("so does /function check",
    fn("check.mcfunction").some(l => l.includes("ap_alive=-39..")), true)
check("the script pushes the heartbeat onto players, not a fake one",
    readFileSync(new URL("../Admin+ BP/scripts/core/health.js", import.meta.url), "utf8")
        .includes("scoreboard players set @a ap_alive 100"), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
