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

console.log("\n— only Vanilla ships —")
// 2.12.7, the user: "it even has a preset somewhere like quiet, idk why we
// have that thing, shouldn't actually exist". Realm, Strict and Quiet were
// early ready-made setups; your own saved setups stay.
check("Realm, Strict and Quiet are gone", Object.keys(BUILT_IN), ["vanilla"])
check("so loading one finds nothing", ["realm", "strict", "quiet"].map(id => getPreset(id)), [undefined, undefined, undefined])

// Two setups of our own, standing in for the ones that shipped.
setSetting("spawn.protect", "true")
setSetting("spawn.radius", "24")
setSetting("teleport.warmup", "1")
savePresetFromCurrent("camp", "Camp", "a small world")
replaceOverrides({})
setSetting("presence.announce", "false")
setSetting("automod.ores", "false")
savePresetFromCurrent("hush", "Hush", "no join lines, no ore alerts")
replaceOverrides({})

console.log("\n— applying one is detected back —")
applyPreset("camp")
check("now on Camp", detectPreset().id, "camp")
check("and it actually set the values", [setting("spawn.protect"), setting("spawn.radius")], ["true", "24"])
// A setup only changes what it lists, so start clean to switch to another.
replaceOverrides({})
applyPreset("hush")
check("switching setup", detectPreset().id, "hush")

console.log("\n— changing ONE value drops you to Custom —")
replaceOverrides({})
applyPreset("camp")
check("on camp", detectPreset().id, "camp")
setSetting("spawn.radius", "25")
check("one value off the setup", detectPreset().id, "custom")
check("labelled Custom", detectPreset().label, "Custom")
setSetting("spawn.radius", "24")
check("putting it back restores the name", detectPreset().id, "camp")

console.log("\n— a setup only claims the keys it names —")
replaceOverrides({})
applyPreset("hush")
check("hush detected", detectPreset().id, "hush")
// hush says nothing about spawn, so changing spawn must not break the match
setSetting("spawn.radius", "99")
check("an unrelated key does not break it", detectPreset().id, "hush")
resetSetting("spawn.radius")

console.log("\n— vanilla means no overrides at all —")
replaceOverrides({})
check("clean", detectPreset().id, "vanilla")
setSetting("bracket.open", DEFAULTS["bracket.open"].value)   // an override equal to the default
check("an override that equals the default still counts as vanilla", detectPreset().id, "vanilla")
setSetting("bracket.open", "<<")
check("a real change does not", detectPreset().id, "custom")
replaceOverrides({})

console.log("\n— saving the current values as a hidden setup —")
setSetting("teleport.warmup", "7")
setSetting("presence.announce", "false")
const mine = savePresetFromCurrent("myrealm", "My Realm", "how we run it")
check("saved", !!mine, true)
check("captures only what differs", Object.keys(mine.values).sort(), ["presence.announce", "teleport.warmup"])
check("it appears alongside Vanilla", "myrealm" in allPresets(), true)
check("and is detected", detectPreset().id, "myrealm")
replaceOverrides({})
check("back to vanilla", detectPreset().id, "vanilla")
applyPreset("myrealm")
check("re-applying it works", [setting("teleport.warmup"), setting("presence.announce")], ["7", "false"])

console.log("\n— Vanilla is protected —")
check("cannot overwrite the built-in id", savePresetFromCurrent("vanilla", "Nope"), undefined)
check("cannot delete it", deletePreset("vanilla"), false)
check("can delete a saved one", deletePreset("myrealm"), true)
check("and it is gone", "myrealm" in allPresets(), false)

console.log("\n— the preset line in the editable block —")
replaceOverrides({})
applyPreset("camp")
const block = toBlock()
check("the block names the setup", block.includes("preset = camp"), true)
const parsed = fromBlock(block)
check("and it parses back", parsed.values.preset, "camp")
check("without being mistaken for a setting", parsed.unknown.includes("preset"), false)
setSetting("spawn.radius", "1")
check("the block says custom once you drift", toBlock().includes("preset = custom"), true)
deletePreset("camp")
deletePreset("hush")
replaceOverrides({})

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
