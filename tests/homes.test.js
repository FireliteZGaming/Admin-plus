import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, getRank, RANK_VALUES, valueFor } from "../Admin+ BP/scripts/core/ranks.js"
import {
    homesOf, getHome, setHome, deleteHome, homeLimit, clearHomes,
    normaliseHomeId, playersWithHomes, __resetHomes
} from "../Admin+ BP/scripts/core/homes.js"
import { remaining, start, waitLine, __resetCooldowns } from "../Admin+ BP/scripts/core/cooldowns.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const at = (x, y, z) => ({ x, y, z })
const makePlayer = (id, name, loc = at(10, 64, -20)) => ({
    id, name, nameTag: name, location: loc,
    dimension: { id: "minecraft:overworld" },
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
})

const player = makePlayer("h-1", "Settler")
const staff = makePlayer("h-2", "Mod")
__test.players.push(player, staff)
// Rank ids are case-SENSITIVE, and setRanks falls back to the default rank
// for one it does not know rather than complaining. "Mod" silently becomes
// member, which is a quiet way to write a test that proves nothing.
setRanks(player.id, ["member"], player.name)

// Homes ship OFF from 2.7.4 — like land claims, both hand players something
// new to own and a world should switch that on rather than find it running
// after an update. The feature switch has its own section further down; every
// other block here is about what homes DO, so it is turned on once up here.
setSetting("feature.homes", "true")

console.log("\n— setting one, and coming back to it —")
{
    __resetHomes()
    const result = setHome(player, "base")
    check("it saved", result.ok, true)
    check("under a tidy id", result.home.id, "base")
    check("keeping what they typed for display", result.home.display, "base")
    // Centred in the block, like warps — landing on an edge drops you through
    // the floor often enough to be worth the half.
    check("centred in the block", [result.home.x, result.home.z], [10.5, -19.5])
    check("and the dimension came along", result.home.dimension, "minecraft:overworld")
    check("it can be found again", getHome(player.id, "base")?.id, "base")
    check("case-insensitively, because people type fast", getHome(player.id, "BASE")?.id, "base")
}

console.log("\n— a name is tidied, not rejected —")
{
    __resetHomes()
    check("spaces become underscores", normaliseHomeId("my cool base"), "my_cool_base")
    check("case is flattened", normaliseHomeId("BASE"), "base")
    check("and a very long one is cut rather than refused",
        normaliseHomeId("x".repeat(60)).length, 24)
}

console.log("\n— the limit is the rank's, and setting one twice is not two homes —")
{
    __resetHomes()
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 2 } })
    check("the rank decides", homeLimit(player), 2)

    check("first is fine", setHome(player, "one").ok, true)
    check("second is fine", setHome(player, "two").ok, true)
    const third = setHome(player, "three")
    check("third is refused", third.ok, false)
    check("and says why, in words a 13-year-old can act on",
        /delete one first/i.test(third.reason), true)

    // The commonest thing anybody does after the first day: move a home.
    const moved = setHome(player, "one", at(99, 70, 99))
    check("but overwriting an existing one still works", moved.ok, true)
    check("it is flagged as a replacement", moved.replaced, true)
    check("the count did not grow", homesOf(player.id).length, 2)
    check("and it really moved", getHome(player.id, "one").x, 99.5)
}

console.log("\n— a rank allowed none gets a straight answer —")
{
    __resetHomes()
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 0 } })
    const result = setHome(player, "nope")
    check("refused", result.ok, false)
    check("because of the rank, not the count",
        /rank can't set homes/i.test(result.reason), true)
    check("and nothing was stored", homesOf(player.id).length, 0)
}

console.log("\n— lowering a limit does not destroy what somebody already had —")
// The kinder failure, and the one that does not lose anything on a mistake.
{
    __resetHomes()
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 3 } })
    setHome(player, "a"); setHome(player, "b"); setHome(player, "c")
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 1 } })
    check("all three are still there", homesOf(player.id).length, 3)
    check("and still reachable", getHome(player.id, "c")?.id, "c")
    check("but no more can be added", setHome(player, "d").ok, false)
}

console.log("\n— homes are yours, and nobody else's list —")
{
    __resetHomes()
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 3 } })
    setRanks(staff.id, ["mod"], staff.name)
    setHome(player, "secret")
    check("mine are mine", homesOf(player.id).length, 1)
    check("and not somebody else's", homesOf(staff.id).length, 0)
    check("a staff member cannot read them by id either",
        getHome(staff.id, "secret"), undefined)
    // The overview exists for "who is using this", never for where they are.
    const rows = playersWithHomes()
    check("the staff overview counts them", rows.find(r => r.id === player.id)?.count, 1)
    check("and carries no coordinates",
        Object.keys(rows[0]).sort(), ["count", "id"])
}

console.log("\n— deleting —")
{
    __resetHomes()
    setHome(player, "gone")
    check("it goes", deleteHome(player.id, "gone"), true)
    check("and is gone", homesOf(player.id).length, 0)
    check("deleting nothing is not an error", deleteHome(player.id, "gone"), false)

    setHome(player, "x"); setHome(player, "y")
    check("clearing returns how many went", clearHomes(player.id), 2)
    check("and leaves none", homesOf(player.id).length, 0)
}

console.log("\n— the feature switch —")
{
    __resetHomes()
    setSetting("feature.homes", "false")
    const result = setHome(player, "off")
    check("switched off, nothing is stored", result.ok, false)
    check("and it says so plainly", /turned off/i.test(result.reason), true)
    resetSetting("feature.homes")
}

console.log("\n— cooldowns are numbers on the rank —")
{
    __resetCooldowns()
    check("the table declares /home's cooldown", RANK_VALUES["home.cooldown"].kind, "cooldown")
    check("and the homes limit", RANK_VALUES["home.limit"].kind, "limit")

    saveRank("member", { meta: { ...getRank("member")?.meta, "home.cooldown": 5 } })
    check("the value resolves off the rank", valueFor(player, "home.cooldown"), 5)

    check("nothing is owed before it is used", remaining(player, "home"), 0)
    check("starting it returns the length", start(player, "home", "home.cooldown"), 5)
    const left = remaining(player, "home")
    check("and now there is a wait", left > 0 && left <= 5, true)

    // Separate timers per action, or the shorter cooldown would be pointless.
    check("a different action is unaffected", remaining(player, "warp"), 0)
}

console.log("\n— staff wait for nothing, but limits still apply to them —")
{
    __resetCooldowns()
    saveRank("mod", { meta: { ...getRank("mod")?.meta, "home.cooldown": 30, "home.limit": 2 } })
    check("a staff rank's cooldown collapses to zero", valueFor(staff, "home.cooldown"), 0)
    check("so starting one does nothing", start(staff, "home", "home.cooldown"), 0)
    check("and they never wait", remaining(staff, "home"), 0)
    // Deliberate: a limit is about how much of the world somebody occupies, and
    // "staff get unlimited" is an owner's decision, not the pack's assumption.
    check("but their home limit is still their rank's", valueFor(staff, "home.limit"), 2)
}

console.log("\n— a value out of range is clamped, not obeyed —")
{
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": 9999 } })
    check("above the maximum", valueFor(player, "home.limit"), RANK_VALUES["home.limit"].max)
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": -5 } })
    check("and below the minimum", valueFor(player, "home.limit"), RANK_VALUES["home.limit"].min)
    saveRank("member", { meta: { ...getRank("member")?.meta, "home.limit": "banana" } })
    check("something that is not a number falls back",
        valueFor(player, "home.limit"), RANK_VALUES["home.limit"].fallback)
}

console.log("\n— how a wait reads —")
{
    check("seconds", waitLine(9), "9s")
    check("a round minute", waitLine(60), "1m")
    check("and the remainder", waitLine(95), "1m 35s")
}

console.log("\n— every number the rank editor can set is one something reads —")
// The same rule CLAUDE.md states for switches: a value nobody reads is worse
// than no value, because it looks like it does something.
{
    const readers = ["home.limit", "home.cooldown", "tpCooldown",
                     "claim.limit", "claim.size", "rtp.cooldown", "back.cooldown"]
    const declared = Object.keys(RANK_VALUES).sort()
    check("the table and the readers agree", declared, readers.sort())
    for (const key of declared) {
        const spec = RANK_VALUES[key]
        check(`${key} has a usable range`, spec.min < spec.max, true)
        check(`${key}'s fallback sits inside it`,
            spec.fallback >= spec.min && spec.fallback <= spec.max, true)
    }
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
