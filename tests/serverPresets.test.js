import { PRESETS as LADDERS, ladder, saveRank, applyPreset as applyLadder } from "../Admin+ BP/scripts/core/ranks.js"
import { setting, setSetting, replaceOverrides, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { getChannel, saveChannel, deleteChannel } from "../Admin+ BP/scripts/core/channels.js"
import {
    SERVER_PRESETS, getServerPreset, detectServerPreset, partsOf,
    nearestPreset, applyServerPreset, ladderMatches, configMatches, channelsMatch
} from "../Admin+ BP/scripts/core/serverPresets.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— every preset is internally coherent —")
// A preset that names a ladder that does not exist, or a config key that has
// been renamed, would apply silently and half-work. Cheap to rule out.
for (const [id, preset] of Object.entries(SERVER_PRESETS)) {
    check(`${id}: its ladder exists`, !!LADDERS[preset.ladder], true)
    check(`${id}: every config key is real`,
        Object.keys(preset.config).every(key => key in DEFAULTS), true)
    check(`${id}: it names at least one chat`, preset.channels.length > 0, true)
    check(`${id}: it explains itself`, preset.notes.length > 20, true)
}

console.log("\n— applying one sets all three parts —")
replaceOverrides({})
const result = applyServerPreset("server")
check("it reports the ladder it set", result.ladder, LADDERS.server.name)
check("with the right number of ranks", result.ranks, Object.keys(LADDERS.server.ranks).length)
check("and the config values it wrote", result.configCount, Object.keys(SERVER_PRESETS.server.config).length)
check("the ladder really changed", ladder().map(r => r.id).includes("coowner"), true)
check("a config value really took", setting("spawn.radius"), "24")
check("the chats it names exist", !!getChannel("staff"), true)

console.log("\n— and it detects as itself afterwards —")
check("detected", detectServerPreset().id, "server")
check("by its label", detectServerPreset().label, "Server")
check("all three parts match", partsOf("server"), { ladder: true, config: true, channels: true })

console.log("\n— change any part and it is honestly Custom —")
setSetting("spawn.radius", "999")
check("a changed config value breaks the match", detectServerPreset().id, "custom")
check("and the config is the part that differs", partsOf("server").config, false)
check("while the ladder still matches", partsOf("server").ladder, true)
check("nearest still points at it", nearestPreset().id, "server")
setSetting("spawn.radius", "24")
check("putting it back restores the name", detectServerPreset().id, "server")

console.log("\n— an edited ladder is a different server —")
saveRank("mod", { display: "§9Moderator" })
check("renaming one rank makes it Custom", detectServerPreset().id, "custom")
check("and the ladder is what differs", partsOf("server").ladder, false)
check("the config is untouched", partsOf("server").config, true)
applyLadder("server")
check("re-applying the ladder fixes it", detectServerPreset().id, "server")

console.log("\n— a missing chat counts too —")
deleteChannel("staff")
check("deleting a chat it names breaks the match", channelsMatch("server"), false)
check("so the server reads Custom", detectServerPreset().id, "custom")
const readded = applyServerPreset("server")
check("re-applying puts the chat back", !!getChannel("staff"), true)
check("and says it added it", readded.channelsAdded, ["staff"])

console.log("\n— it does not delete chats you made —")
saveChannel("events", { display: "§dEvents", open: true })
applyServerPreset("quiet")
check("your channel survives a preset that does not name it", !!getChannel("events"), true)
check("even though the preset only names general", SERVER_PRESETS.quiet.channels, ["general"])

console.log("\n— the quiet preset really is quiet —")
check("nothing is announced", setting("presence.announce"), "false")
check("no ore alerts", setting("automod.ores"), "false")
check("no break-rate alerts", setting("automod.breaks"), "false")
check("and it detects", detectServerPreset().id, "quiet")

console.log("\n— the parts are independently checkable —")
check("ladderMatches on a bad id is false", ladderMatches("nope"), false)
check("configMatches on a bad id is false", configMatches("nope"), false)
check("channelsMatch on a bad id is false", channelsMatch("nope"), false)
check("getServerPreset on a bad id is undefined", getServerPreset("nope"), undefined)
check("applying a bad id does nothing", applyServerPreset("nope"), undefined)

console.log("\n— lockdown is gone, and stays gone —")
// The ladder went in 1.19.0, the preset after the 2.0.0 playtest. A preset
// answers "what kind of place is this"; an incident is not an answer to that,
// and choosing it meant losing the shape you actually had.
check("it is not a preset any more", "lockdown" in SERVER_PRESETS, false)
check("nothing can apply it", applyServerPreset("lockdown"), undefined)
check("and it cannot be looked up", getServerPreset("lockdown"), undefined)
check("no surviving preset points a ladder at it",
    Object.values(SERVER_PRESETS).every(p => p.ladder !== "lockdown"), true)
// What it used to do is still doable — as ordinary settings, reversibly.
check("its keys are all still real config", ["feature.tpa", "spawn.protect", "spawn.radius",
    "teleport.warmup", "teleport.cooldown", "staff.exemptCooldowns"].every(k => k in DEFAULTS), true)

// REMOVED 2026-09-20 with the preset itself. Five sections tested the Spear
// Mace ladder - that Admin could not ban, that Moderator was a trial rank,
// that Member had tpa.use explicitly denied. Every one of those assertions
// was about a ladder built for one particular world, so they went with it
// rather than being repointed at a preset that never made those promises.
//
// What the block was really guarding - that a later edit cannot hand a rank
// a wildcard which quietly undoes a deliberate restriction - is worth
// keeping in mind if a ladder like it is ever built by hand again.

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
