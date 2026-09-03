import { DEFAULTS, setting, setSetting, resetSetting, overrides, replaceOverrides } from "../Admin+ BP/scripts/core/settings.js"
import { BUILT_IN, allPresets, getPreset, detectPreset, applyPreset, savePresetFromCurrent, deletePreset } from "../Admin+ BP/scripts/core/configPresets.js"
import { toBlock, fromBlock } from "../Admin+ BP/scripts/features/code.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

replaceOverrides({})

console.log("\n— a clean config is Vanilla —")
check("detected", detectPreset().id, "vanilla")
check("labelled", detectPreset().label, "Vanilla")

console.log("\n— applying one is detected back —")
applyPreset("realm")
check("now on Realm", detectPreset().id, "realm")
check("and it actually set the values", [setting("spawn.protect"), setting("spawn.radius")], ["true", "24"])
applyPreset("strict")
check("switching preset", detectPreset().id, "strict")
check("strict makes staff wait too", setting("staff.exemptCooldowns"), "false")

console.log("\n— changing ONE value drops you to Custom —")
applyPreset("realm")
check("on realm", detectPreset().id, "realm")
setSetting("spawn.radius", "25")
check("one value off the preset", detectPreset().id, "custom")
check("labelled Custom", detectPreset().label, "Custom")
setSetting("spawn.radius", "24")
check("putting it back restores the name", detectPreset().id, "realm")

console.log("\n— a preset only claims the keys it names —")
applyPreset("quiet")
check("quiet detected", detectPreset().id, "quiet")
// quiet says nothing about spawn, so changing spawn must not break the match
setSetting("spawn.radius", "99")
check("an unrelated key does not break it", detectPreset().id, "quiet")
resetSetting("spawn.radius")

console.log("\n— vanilla means no overrides at all —")
replaceOverrides({})
check("clean", detectPreset().id, "vanilla")
setSetting("bracket.open", DEFAULTS["bracket.open"].value)   // an override equal to the default
check("an override that equals the default still counts as vanilla", detectPreset().id, "vanilla")
setSetting("bracket.open", "<<")
check("a real change does not", detectPreset().id, "custom")
replaceOverrides({})

console.log("\n— saving the current values as a hidden preset —")
setSetting("teleport.warmup", "7")
setSetting("presence.announce", "false")
const mine = savePresetFromCurrent("myrealm", "My Realm", "how we run it")
check("saved", !!mine, true)
check("captures only what differs", Object.keys(mine.values).sort(), ["presence.announce", "teleport.warmup"])
check("it appears alongside the built-ins", "myrealm" in allPresets(), true)
check("and is detected", detectPreset().id, "myrealm")
replaceOverrides({})
check("back to vanilla", detectPreset().id, "vanilla")
applyPreset("myrealm")
check("re-applying it works", [setting("teleport.warmup"), setting("presence.announce")], ["7", "false"])

console.log("\n— built-ins are protected —")
check("cannot overwrite a built-in id", savePresetFromCurrent("realm", "Nope"), undefined)
check("cannot delete a built-in", deletePreset("realm"), false)
check("can delete a saved one", deletePreset("myrealm"), true)
check("and it is gone", "myrealm" in allPresets(), false)

console.log("\n— the preset line in the editable block —")
replaceOverrides({})
applyPreset("realm")
const block = toBlock()
check("the block names the preset", block.includes("preset = realm"), true)
const parsed = fromBlock(block)
check("and it parses back", parsed.values.preset, "realm")
check("without being mistaken for a setting", parsed.unknown.includes("preset"), false)
setSetting("spawn.radius", "1")
check("the block says custom once you drift", toBlock().includes("preset = custom"), true)
replaceOverrides({})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
