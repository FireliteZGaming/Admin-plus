import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { acceptTerms } from "../Admin+ BP/scripts/features/terms.js"
import { setRanks, onPlayerJoin, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { NS } from "../Admin+ BP/scripts/config.js"
import { TIMES, WEATHERS, clockFace } from "../Admin+ BP/scripts/features/timeweather.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// /clock and /sky, Admin+'s own since 2.8.4. The user, 2026-11-12: /sky
// offers clear, rain and thunder, and /clock takes day, night, sunrise,
// sunset, noon, midnight, or a number.

__test.runStartup()
const full = name => `${NS}:${name}`
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const pick = selection => ({ canceled: false, selection })
const submit = (...formValues) => ({ canceled: false, formValues })
const firstLines = form => form.parts.filter(p => p[0] === "button").map(p => String(p[1]).split("\n")[0].replace(/§./g, ""))

let n = 0
function makePlayer(name) {
    const inbox = []
    const p = {
        id: `tw${n++}`, name, nameTag: name, commandPermissionLevel: 0, inbox,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: m => inbox.push(String(m)), dimension: __test.dimension,
        location: { x: 0, y: 64, z: 0 }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
applyPreset("server")
const owner = makePlayer("Owner")
setRanks(owner.id, ["owner"], owner.name)
// 3.1.6: an owner accepts Admin+'s terms before using its commands.
acceptTerms(owner)
const member = makePlayer("Member")
setRanks(member.id, ["member"], member.name)

console.log("\n— the six times, as the game names them —")
check("Microsoft's TimeOfDay values", Object.fromEntries(TIMES),
    { day: 1000, noon: 6000, sunset: 12000, night: 13000, midnight: 18000, sunrise: 23000 })
check("tick 0 is six in the morning", clockFace(0), "06:00")
check("6000 is noon", clockFace(6000), "12:00")
check("18000 is midnight", clockFace(18000), "00:00")
check("23000 is five in the morning", clockFace(23000), "05:00")
check("the weather list", WEATHERS, ["clear", "rain", "thunder"])

console.log("\n— /clock, typed —")
{
    __test.invoke(full("clock"), owner, "night")
    await settle()
    check("/clock night", __test.sky.time, 13000)

    __test.invoke(full("clock"), owner, "set", 4500)
    await settle()
    check("/clock set 4500", __test.sky.time, 4500)

    __test.invoke(full("clock"), owner, "set", 99999)
    await settle()
    check("a number past 24000 is refused, and the time stays", __test.sky.time, 4500)
    check("with a reason", owner.inbox.some(m => m.includes("0 to 24000")), true)

    __ui.answers.push(submit("800"))
    __test.invoke(full("clock"), owner, "set")
    await settle()
    check("/clock set with no number asks for one", __test.sky.time, 800)
}

console.log("\n— /clock, typed alone —")
{
    __ui.shown.length = 0
    __ui.answers.push(pick(5))
    __test.invoke(full("clock"), owner)
    await settle()
    check("it offers the six times and a number",
        firstLines(__ui.shown[0]), ["Day", "Noon", "Sunset", "Night", "Midnight", "Sunrise", "A number"])
    check("and a button sets that time", __test.sky.time, 23000)

    __ui.answers.push(pick(6), submit("12345"))
    __test.invoke(full("clock"), owner)
    await settle()
    check("A number asks for it", __test.sky.time, 12345)
}

console.log("\n— /sky —")
{
    __test.invoke(full("sky"), owner, "rain")
    await settle()
    check("/sky rain", __test.sky.weather?.type, "Rain")
    check("leaving the length to the game", __test.sky.weather?.duration, undefined)
    check("in the Overworld", __test.sky.weather?.dimension, "minecraft:overworld")

    __test.invoke(full("sky"), owner, "thunder", 10)
    await settle()
    check("/sky thunder 10 lasts ten minutes, in ticks", [__test.sky.weather?.type, __test.sky.weather?.duration], ["Thunder", 12000])

    __test.invoke(full("sky"), owner, "clear", 0)
    await settle()
    check("0 minutes is refused, the weather unchanged", __test.sky.weather?.type, "Thunder")

    __ui.shown.length = 0
    __ui.answers.push(pick(0))
    __test.invoke(full("sky"), owner)
    await settle()
    check("typed alone, it offers the three", firstLines(__ui.shown[0]).slice(0, 3), ["clear", "rain", "thunder"])
    check("and sets the one picked", __test.sky.weather?.type, "Clear")
}

console.log("\n— who may —")
{
    const before = __test.sky.time
    __test.invoke(full("clock"), member, "day")
    await settle()
    check("a rank without the time and weather switch is refused", __test.sky.time, before)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
