import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { checkCommand, commandName, runAsServer } from "../Admin+ BP/scripts/core/execute.js"
import { setting, setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const ran = []
    const p = {
        id: `x${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        ran,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: () => { },
        dimension: { id: "minecraft:overworld", runCommand: c => { ran.push(c); return { successCount: 1 } } }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const owner = fakePlayer("Owner"); setRanks(owner.id, ["owner"], owner.name)
const admin = fakePlayer("Admin"); setRanks(admin.id, ["admin"], admin.name)
const mod = fakePlayer("Mod"); setRanks(mod.id, ["mod"], mod.name)

console.log("\n— the point of it —")
// Losing op used to mean losing the whole vanilla command set, so telling
// somebody "your rank gives you the same power" was not true. It is now.
const gave = runAsServer(owner, "give @s diamond 1")
check("a vanilla command runs", gave.ok, true)
check("it is handed to the DIMENSION, which runs at operator level",
    owner.ran.length, 1)
check("wrapped so @s and ~ mean the person who typed it",
    owner.ran[0].startsWith('execute as "Owner" at @s run '), true)
check("and the command itself is intact", owner.ran[0].endsWith("give @s diamond 1"), true)
check("a leading slash is accepted too",
    runAsServer(owner, "/time set day").ok, true)

console.log("\n— what it refuses —")
check("nothing to run", runAsServer(owner, "   ").ok, false)
check("op is blocked by default", runAsServer(owner, "op Steve").ok, false)
check("and so is deop", runAsServer(owner, "deop Steve").ok, false)
check("the refusal says where the switch is",
    runAsServer(owner, "op Steve").reason.includes("Blocked commands"), true)
check("blocking is by command NAME, not a substring",
    checkCommand("optimize something").ok, true)
check("case does not matter", runAsServer(owner, "OP Steve").ok, false)

console.log("\n— the blocked list is the owner's to set —")
check("it ships blocking the ones that escape the rank system, plus /kick",
    setting("commands.denied"), "op,deop,kick")
check("/kick is refused, because it locks somebody out until the host restarts",
    runAsServer(owner, "kick Steve").ok, false)
setSetting("commands.denied", "give, kill")
check("a newly blocked command is refused", runAsServer(owner, "give @s stone").ok, false)
check("and one taken off the list is allowed again", runAsServer(owner, "op Steve").ok, true)
resetSetting("commands.denied")

console.log("\n— names —")
check("plain", commandName("give @s stone"), "give")
check("with a slash", commandName("/time set day"), "time")
check("padded", commandName("   kill @e  "), "kill")

console.log("\n— who gets it —")
// Deliberately not in any shipped ladder. Handing somebody the vanilla command
// set is a decision an owner makes for one person, not something a preset does.
check("admin.commands is declared",
    Object.values(PERMISSION_NODES).flat().includes("admin.commands"), true)
check("an Owner has it through the wildcard", has(owner, "admin.commands"), true)
check("an Admin does NOT", has(admin, "admin.commands"), false)
check("nor a Mod", has(mod, "admin.commands"), false)

// ...but it can be granted, which is the entire point.
saveRank("admin", { perms: [...PERMISSION_NODES.Management.slice(0, 0), "admin.commands"] })
check("granting it works", has(admin, "admin.commands"), true)
applyPreset("server")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
