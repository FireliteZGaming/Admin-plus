import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, getRank, RANK_VALUES, valueFor } from "../Admin+ BP/scripts/core/ranks.js"
import { lastPlace, takeLastPlace, mark, clearLastPlace, __resetBack } from "../Admin+ BP/scripts/core/back.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const at = (x, y, z) => ({ x, y, z })
const player = {
    id: "b-1", name: "Wanderer", nameTag: "Wanderer",
    location: at(100, 64, -200),
    dimension: { id: "minecraft:overworld" },
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
}
__test.players.push(player)
setRanks(player.id, ["member"], player.name)
setSetting("feature.back", "true")

console.log("\n— a mark is where you stood —")
{
    __resetBack()
    const m = mark(player)
    check("it recorded", !!m, true)
    // Centred in the block, like every other place this pack sends people.
    check("centred in the block", [m.x, m.z], [100.5, -199.5])
    check("and kept the dimension", m.dimension, "minecraft:overworld")
    check("a teleport mark is not a death", m.death, false)
    check("it can be read back", lastPlace(player.id)?.x, 100.5)
}

console.log("\n— a death mark outranks a teleport mark —")
// The rule the whole store turns on. Dying and then warping to spawn must not
// lose the coordinates of your things — which is the only reason /back matters.
{
    __resetBack()
    mark({ ...player, location: at(10, 70, 10) }, { death: true })
    check("the death is recorded", lastPlace(player.id)?.death, true)

    mark({ ...player, location: at(999, 64, 999) })
    const still = lastPlace(player.id)
    check("a later teleport does NOT overwrite it", still.death, true)
    check("and the coordinates are still the death's", still.x, 10.5)

    // A second death does replace it: the newest body is the one you want.
    mark({ ...player, location: at(-40, 12, -40) }, { death: true })
    check("but a second death replaces the first", lastPlace(player.id).x, -39.5)
}

console.log("\n— a teleport replaces a teleport —")
{
    __resetBack()
    mark({ ...player, location: at(1, 64, 1) })
    mark({ ...player, location: at(2, 64, 2) })
    check("the newer one wins", lastPlace(player.id).x, 2.5)
}

console.log("\n— taking it clears it —")
// Cleared on use, or /back becomes a two-way shuttle rather than an undo.
{
    __resetBack()
    mark({ ...player, location: at(5, 64, 5) })
    const taken = takeLastPlace(player.id)
    check("it came back", taken?.x, 5.5)
    check("and is gone", lastPlace(player.id), undefined)
    check("taking nothing is not an error", takeLastPlace(player.id), undefined)
}

console.log("\n— the feature switch —")
{
    __resetBack()
    setSetting("feature.back", "false")
    check("switched off, nothing is marked", mark(player), undefined)
    check("and nothing was stored", lastPlace(player.id), undefined)
    setSetting("feature.back", "true")
}

console.log("\n— it survives a rejoin, unlike a cooldown —")
// A cooldown exists to slow somebody down and has no business outliving a
// restart. A death position is an hour of work, and a reload between dying and
// getting back is exactly when losing it hurts most — so this one is a Table.
{
    __resetBack()
    mark({ ...player, location: at(7, 64, 7) }, { death: true })
    const { lastPlace: freshRead } = await import("../Admin+ BP/scripts/core/back.js")
    check("a fresh read of the store still has it", freshRead(player.id)?.x, 7.5)
    clearLastPlace(player.id)
    check("and clearing works", lastPlace(player.id), undefined)
}

console.log("\n— the cooldown is a rank value like the others —")
{
    check("it is declared", RANK_VALUES["back.cooldown"].kind, "cooldown")
    // Shorter than /rtp on purpose: the usual reason to use it is that you just
    // died, and making somebody wait a minute for their things is a punishment.
    check("and is shorter than the one for /rtp",
        RANK_VALUES["back.cooldown"].fallback < RANK_VALUES["rtp.cooldown"].fallback, true)
    saveRank("member", { meta: { ...getRank("member")?.meta, "back.cooldown": 25 } })
    check("it resolves off the rank", valueFor(player, "back.cooldown"), 25)
}

console.log("\n— a mark with nowhere to point is refused —")
{
    __resetBack()
    check("no location, no mark", mark({ id: "b-9", name: "Ghost" }), undefined)
    check("no id, no mark", mark({ location: at(0, 0, 0) }), undefined)
}

resetSetting("feature.back")
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
