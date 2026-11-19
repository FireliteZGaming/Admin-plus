import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin } from "../Admin+ BP/scripts/core/ranks.js"
import { pendingReports } from "../Admin+ BP/scripts/core/reports.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// 2.12.15, the user: "you only have to type /report and it pops up with the
// playerlist if you don't select a player". Bare /report asks who first, from
// the shared player list without the reporter on it; the form then names who
// was picked and asks only what kind and what happened.

const full = name => `${NS}:${name}`
let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const pick = selection => ({ canceled: false, selection })
const submit = (...formValues) => ({ canceled: false, formValues })
const buttonsOf = form => (form?.parts ?? []).filter(p => p[0] === "button").map(p => String(p[1]).replace(/§./g, ""))

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `rc${nextId++}`, name, nameTag: name, inbox: [], commandPermissionLevel: 0,
        location: { x: nextId * 3, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" },
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        hasTag: t => tags.has(t), sendMessage: m => p.inbox.push(String(m))
    }
    __test.players.push(p)
    return p
}

__test.runStartup()
const nova = fakePlayer("Nova")
const griefer = fakePlayer("Griefer")
for (const p of [nova, griefer]) onPlayerJoin(p)

console.log("\n— bare /report asks who first —")
let names = []
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.invoke(full("report"), nova)
    await settle()
    names = buttonsOf(__ui.shown[0])
    check("a player list opened", __ui.shown.length >= 1, true)
    check("the player to report is on it", names.some(n => n.includes("Griefer")), true)
    check("the reporter is not", names.some(n => n.includes("Nova")), false)
}

console.log("\n— picking someone opens the form, which names them and files the report —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(pick(names.findIndex(n => n.includes("Griefer"))), submit(0, "broke my base"))
    __test.invoke(full("report"), nova)
    await settle()
    const form = JSON.stringify(__ui.shown[1]?.parts ?? [])
    check("the form says who is being reported", form.includes("Reporting") && form.includes("Griefer"), true)
    check("and doesn't ask who again", form.includes('"Who"'), false)
    const filed = pendingReports().find(r => r.reporter?.id === nova.id)
    check("the report is filed about them", filed?.target?.id, griefer.id)
    check("with what happened", filed?.reason, "broke my base")
}

console.log("\n— naming yourself is refused —")
{
    __ui.shown.length = 0; __ui.answers.length = 0; nova.inbox.length = 0
    __test.invoke(full("report"), nova, [nova])
    await settle()
    check("it says why", nova.inbox.some(m => m.includes("can't report yourself")), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
