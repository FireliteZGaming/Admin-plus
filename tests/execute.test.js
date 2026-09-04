import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { checkCommand, commandName, runAsServer } from "../Admin+ BP/scripts/core/execute.js"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"

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

console.log("\n— ONE list, and it is a whitelist —")
// There is no blocklist. /op does not run because it is not on the list, not
// because something forbids it by name. Two lists meant an owner had to check
// both to answer "can they run that", and a mistake either way was silent.
check("nothing to run", runAsServer(owner, "   ").ok, false)
check("a listed command runs", runAsServer(owner, "give @s diamond").ok, true)
check("op is not on the list, so it does not run", runAsServer(owner, "op Steve").ok, false)
check("nor deop", runAsServer(owner, "deop Steve").ok, false)
check("nor kick, which locks people out until the host restarts",
    runAsServer(owner, "kick Steve").ok, false)
check("the refusal names what IS on",
    runAsServer(owner, "op Steve").reason.includes("give"), true)
check("matching is by command NAME, not a substring",
    checkCommand("giveaway something").ok, false)
check("case does not matter", runAsServer(owner, "GIVE @s stone").ok, true)

// execute and function are left off on purpose: only the first word is checked,
// so either one would let anything at all through behind it.
check("execute is not on the shipped list",
    setting("commands.allowed").includes("execute"), false)
check("nor function", setting("commands.allowed").includes("function"), false)

console.log("\n— the list is the owner's to set —")
setSetting("commands.allowed", "give, effect")
check("give is on", runAsServer(owner, "give @s stone").ok, true)
check("effect is on", runAsServer(owner, "effect @s speed 10").ok, true)
check("summon is now off", runAsServer(owner, "summon cow").ok, false)
setSetting("commands.allowed", "")
check("an empty list runs nothing at all", runAsServer(owner, "give @s stone").ok, false)
check("and says so plainly",
    runAsServer(owner, "give @s stone").reason.includes("No vanilla commands"), true)
resetSetting("commands.allowed")
check("back to the shipped set", runAsServer(owner, "give @s stone").ok, true)

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

console.log("\n— what the shipped list must never contain —")
// These are not opinions. Each one hands over more than the whitelist means to,
// and the failure is silent, so they get pinned rather than remembered.
const shipped = String(DEFAULTS["commands.allowed"].value)
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)

check("kick is absent — it locks somebody out until the HOST restarts",
    shipped.includes("kick"), false)
check("op and deop are absent — that is the whole point of a whitelist",
    shipped.filter(c => c === "op" || c === "deop"), [])
// Only the FIRST WORD is checked, so any command that takes another command as
// an argument defeats the list entirely.
check("no command that runs another command is on it",
    shipped.filter(c => ["execute", "function", "scriptevent", "schedule"].includes(c)), [])
check("no dedicated-server admin commands",
    shipped.filter(c => ["stop", "save", "allowlist", "permission", "changesetting",
        "transfer", "setmaxplayers", "wsserver", "reload", "script"].includes(c)), [])

// Bedrock, not Java. A Java-only name on this list is a word that can never
// match anything, which reads as a working entry and is not one.
check("no Java-only command names",
    shipped.filter(c => ["advancement", "data", "bossbar", "worldborder", "team",
        "item", "attribute", "datapack", "forceload", "trigger", "spectate"].includes(c)), [])

check("the commands people actually reach for are on it",
    ["kill", "clear", "give", "effect", "enchant", "gamemode", "tp", "teleport",
        "summon", "xp", "time", "weather", "fill", "setblock", "kill"]
        .filter(c => !shipped.includes(c)), [])
check("every entry is a single lowercase word",
    shipped.filter(c => !/^[a-z]+$/.test(c)), [])
check("no duplicates", shipped.length, new Set(shipped).size)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
