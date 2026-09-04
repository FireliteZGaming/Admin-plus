import { __test } from "@minecraft/server"
import {
    PRESETS, applyPreset, allRanks, setRanks, has
} from "../Admin+ BP/scripts/core/ranks.js"

// Who may ban, and for how long, across every ladder we ship.
//
// The rule, in server terms: TEMP BAN is Admin and up, PERMANENT BAN is Manager
// and up. Two nodes, `admin.ban` and `admin.banperm`, and the gap between them
// is the point — an Admin can put somebody away for a week; ending an account
// for good is a rung higher.
//
// This walks the real ladders and asks the real resolver, because the grants
// are mostly IMPLICIT: manager-tier ranks hold `admin.*`, which reaches
// `admin.banperm` through the wildcard rather than by naming it. Reasoning
// about that instead of checking it is how a preset edit hands permanent bans
// to a Mod without anybody noticing.
//
// The per-preset checks are written as RULES rather than as a list of expected
// rank ids, so a preset added later is covered the day it is added. An earlier
// draft of this file did hardcode the list, and it crashed on the first preset
// it had not been told about — which was the useful part, but only once.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function holderOf(rankId) {
    // NOT an operator. has() lets operators through any node nothing explicitly
    // denies, which would make every one of these come back true.
    const player = {
        id: `p${nextId++}`, name: `Test_${rankId}`,
        sendMessage: () => { },
        commandPermissionLevel: 0,
        getTags: () => []
    }
    __test.players.push(player)
    setRanks(player.id, [rankId], player.name)
    return player
}

const presetKeys = Object.keys(PRESETS)
check("there is more than one ladder to check", presetKeys.length > 1, true)

for (const key of presetKeys) {
    console.log(`\n— ${PRESETS[key].name} —`)
    applyPreset(key)

    const ranks = allRanks()
    const rows = ranks.map(rank => ({
        id: rank.id,
        weight: rank.weight,
        staff: !!rank.staff,
        temp: has(holderOf(rank.id), "admin.ban"),
        perm: has(holderOf(rank.id), "admin.banperm")
    }))

    const temp = rows.filter(r => r.temp)
    const perm = rows.filter(r => r.perm)

    check(`${key}: somebody can ban`, temp.length > 0, true)
    check(`${key}: somebody can ban permanently`, perm.length > 0, true)

    // The invariant that matters most: you can never end an account for good
    // without also being trusted with the lesser thing.
    check(`${key}: nobody bans forever but not for a week`,
        perm.filter(r => !r.temp).map(r => r.id), [])

    // Permanent ban must sit at least as high on the ladder as temp ban.
    const tempFloor = Math.min(...temp.map(r => r.weight))
    const permFloor = Math.min(...perm.map(r => r.weight))
    check(`${key}: permanent ban's floor is not below temp ban's`,
        permFloor >= tempFloor, true)

    // Neither belongs to anyone who is not staff at all.
    check(`${key}: no non-staff rank can ban`,
        rows.filter(r => !r.staff && (r.temp || r.perm)).map(r => r.id), [])

    // Where a ladder actually uses these names, the rule is literal.
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    if (byId.manager) {
        check(`${key}: Manager can ban permanently`,
            [byId.manager.temp, byId.manager.perm], [true, true])
    }
    if (byId.mod) {
        check(`${key}: Mod can do neither`,
            [byId.mod.temp, byId.mod.perm], [false, false])
    }
}

console.log("\n— the split, spelled out on the Realm ladder —")
applyPreset("realm")
check("a Mod cannot ban at all",
    [has(holderOf("mod"), "admin.ban"), has(holderOf("mod"), "admin.banperm")],
    [false, false])
check("an Admin can ban, but not for good",
    [has(holderOf("admin"), "admin.ban"), has(holderOf("admin"), "admin.banperm")],
    [true, false])
check("a Manager can do both",
    [has(holderOf("manager"), "admin.ban"), has(holderOf("manager"), "admin.banperm")],
    [true, true])
check("so can the Owner",
    [has(holderOf("owner"), "admin.ban"), has(holderOf("owner"), "admin.banperm")],
    [true, true])

console.log("\n— Lockdown is not a ladder any more —")
check("it is gone from the preset list", "lockdown" in PRESETS, false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
