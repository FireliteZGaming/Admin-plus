import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { checkCommand, commandName, runAsServer } from "../Admin+ BP/scripts/core/execute.js"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { OP_COMMANDS } from "../Admin+ BP/scripts/core/opcommands.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const ran = [], tags = []
    const p = {
        id: `x${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        ran,
        getTags: () => [...tags],
        addTag: t => { if (!tags.includes(t)) tags.push(t); return true },
        removeTag: t => { const i = tags.indexOf(t); if (i >= 0) tags.splice(i, 1); return true },
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

// The shipped list is EMPTY — nothing runs until an owner turns something on,
// which is the whole point of a whitelist. So say what this world allows rather
// than leaning on a default, which is also what stops this test quietly passing
// again if that default ever came back.
// Commands are ON by default now: one gate, and it asks whether a rank took
// this away rather than whether anybody granted it.
check("out of the box, commands just work", runAsServer(owner, "give @s diamond 1").ok, true)
owner.ran.length = 0
setSetting("commands.allowed", "give, time, kill, tp, say")

const gave = runAsServer(owner, "give @s diamond 1")
check("a vanilla command runs", gave.ok, true)
check("it is handed to the DIMENSION, which runs at operator level",
    owner.ran.length, 1)

// THE fix of 2.1.11, and the reason /a:tp answered "insufficient permission"
// for months. `execute as` REPLACES the executor with the player, so the inner
// command was dispatched at THEIR permission level and handing it to the
// dimension bought nothing at all. `at` moves position and rotation only.
console.log("\n— it runs as the SERVER, positioned on the player —")
check("never `execute as`", owner.ran[0].includes("execute as"), false)
check("`execute at`, so the executor stays the server",
    owner.ran[0].startsWith("execute at @a[tag="), true)
check("aimed at exactly one player",
    /^execute at @a\[tag=[^\],]+,c=1\] run /.test(owner.ran[0]), true)

// `at` costs @s its meaning — it would be the server — so it is rewritten to
// the same one-player selector.
check("@s is rewritten to that player, not left pointing at the server",
    owner.ran[0].includes("@s"), false)
check("and the command is otherwise intact",
    owner.ran[0].replace(/@a\[tag=[^\]]*\]/g, "@s"), "execute at @s run give @s diamond 1")

// The tag is a means, not a mark. One left behind would be picked up by the
// next selector that asked for it.
check("the tag does not outlive the command",
    owner.getTags().filter(t => t.startsWith("apx_")), [])

owner.ran.length = 0
runAsServer(owner, "kill @s[r=5]")
check("@s keeps its own arguments, merged rather than trailing",
    owner.ran[0].replace(/tag=[^\],]+,/g, ""), "execute at @a[c=1] run kill @a[c=1,r=5]")

owner.ran.length = 0
runAsServer(owner, "tp @s ~ ~10 ~")
check("~ still means where they are standing, because `at` is what places it",
    owner.ran[0].endsWith(" ~ ~10 ~"), true)

owner.ran.length = 0
runAsServer(owner, "say @stuff is not a selector")
check("only a bare @s is rewritten", owner.ran[0].endsWith("say @stuff is not a selector"), true)

console.log("\n— an OMITTED target is the player, not the server —")
// The other half of dropping `execute as`, and the half that is easy to miss:
// `as` decided what a left-out target meant as well as what @s meant.
// `/gamemode creative` names nobody, so there is no @s for the rewrite above to
// catch — it just quietly meant the executor, which is now the server.
function line(text) {
    owner.ran.length = 0
    runAsServer(owner, text)
    // The tag is unique per call and uninteresting; ME is what matters.
    return owner.ran[0].replace(/@a\[tag=[^\],]+,c=1/g, "@a[ME")
}

check("gamemode names the player", line("gamemode creative"),
    "execute at @a[ME] run gamemode creative @a[ME]")
check("but not when one was given", line("gamemode creative Steve"),
    "execute at @a[ME] run gamemode creative Steve")

check("kill is the player, not everything", line("kill"),
    "execute at @a[ME] run kill @a[ME]")
check("and a given target still wins", line("kill @e[type=cow]"),
    "execute at @a[ME] run kill @e[type=cow]")

check("clear empties their inventory", line("clear"),
    "execute at @a[ME] run clear @a[ME]")
check("spawnpoint sets theirs", line("spawnpoint"),
    "execute at @a[ME] run spawnpoint @a[ME]")
check("a bare position is a position, not a name", line("spawnpoint 10 64 30"),
    "execute at @a[ME] run spawnpoint @a[ME] 10 64 30")
check("clearspawnpoint too", line("clearspawnpoint"),
    "execute at @a[ME] run clearspawnpoint @a[ME]")
check("playsound plays it to them", line("playsound note.harp"),
    "execute at @a[ME] run playsound note.harp @a[ME]")

// The unit is spelled out rather than counted, so a NAME in that position is
// left alone. Guessing wrong here would silently give somebody else the levels.
check("xp with no unit", line("xp 30"), "execute at @a[ME] run xp 30 @a[ME]")
check("xp with a unit", line("xp 30 levels"), "execute at @a[ME] run xp 30 levels @a[ME]")
check("xp already naming somebody is untouched", line("xp 30 Steve"),
    "execute at @a[ME] run xp 30 Steve")

console.log("\n— /tp, the command that started this —")
// `tp <destination>` moves YOU; `tp <victim> <destination>` moves somebody
// else. Under `execute at` the first form moved the server, which is why
// /a:tp was the command people reported.
check("to a coordinate", line("tp 10 64 30"),
    "execute at @a[ME] run tp @a[ME] 10 64 30")
check("relative to where they stand", line("tp ~ ~10 ~"),
    "execute at @a[ME] run tp @a[ME] ~ ~10 ~")
check("to another player", line("tp Steve"),
    "execute at @a[ME] run tp @a[ME] Steve")
check("to another player, checking blocks", line("tp Steve true"),
    "execute at @a[ME] run tp @a[ME] Steve true")
check("but moving somebody ELSE is left alone", line("tp Steve Alex"),
    "execute at @a[ME] run tp Steve Alex")
check("as is moving them to a coordinate", line("tp Steve 10 64 30"),
    "execute at @a[ME] run tp Steve 10 64 30")
check("@s as the victim is rewritten, not doubled", line("tp @s ~ ~10 ~"),
    "execute at @a[ME] run tp @a[ME] ~ ~10 ~")

console.log("\n— it never guesses on a command with a real target —")
// A command whose target is mandatory has nothing to default to, so nothing
// here may touch it. This is the failure that would be silent.
check("give", line("give @s stone"), "execute at @a[ME] run give @a[ME] stone")
check("effect", line("effect Steve speed 10"),
    "execute at @a[ME] run effect Steve speed 10")
check("say is not a target command at all", line("say gamemode creative"),
    "execute at @a[ME] run say gamemode creative")
check("time set day is untouched", line("time set day"),
    "execute at @a[ME] run time set day")

// A selector carries spaces inside its brackets, so counting arguments by
// splitting on whitespace would see three where there is one — and then write
// a second target into a command that already had one.
check("a selector with spaces is ONE argument", line('kill @e[type=cow, r=5]'),
    "execute at @a[ME] run kill @e[type=cow, r=5]")
check("and so is a quoted name", line('gamemode creative "Some Player"'),
    'execute at @a[ME] run gamemode creative "Some Player"')

owner.ran.length = 0
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
check("the refusal explains itself",
    runAsServer(owner, "op Steve").reason.includes("hand the world over"), true)
check("the never-list matches by NAME, not a substring",
    checkCommand("operation start").ok, true)
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
check("summon is unaffected by the old list", runAsServer(owner, "summon cow").ok, true)
setSetting("commands.allowed", "")
check("an empty list no longer blocks anything", runAsServer(owner, "give @s stone").ok, true)
check("but op is refused however the list is set", runAsServer(owner, "op Steve").ok, false)
resetSetting("commands.allowed")
check("and the shipped state is that same yes",
    runAsServer(owner, "give @s stone").ok, true)

console.log("\n— names —")
check("plain", commandName("give @s stone"), "give")
check("with a slash", commandName("/time set day"), "time")
check("padded", commandName("   kill @e  "), "kill")

console.log("\n— one node per command, and both layers must agree —")
// `commands.allowed` is the WORLD asking whether a command exists here at all;
// `cmd.<name>` is the LADDER asking who may use it. A command needs both — so a
// Mod can hold /a:zkill and be refused /a:zgamemode, which matters most where a
// vanilla command duplicates something this pack already does better.
applyPreset("server")
setSetting("commands.allowed", "give, kill, gamemode")

// **Three layers now, not two.** `admin.commands` is the ladder asking whether
// this rank may use vanilla commands AT ALL — a node that was declared for
// exactly that and had never been wired to anything until 2026-09-13. It
// replaced the fifty-five per-command switches in the rank editor.
check("a rank without admin.commands is refused outright",
    runAsServer(mod, "give @s stone").ok, false)
check("and told which switch to ask for",
    runAsServer(mod, "give @s stone").reason.includes("vanilla commands"), true)

saveRank("mod", { perms: ["admin.commands"] })
check("granting it opens the set",
    runAsServer(mod, "give @s stone").ok, true)

// From here the per-command layer behaves exactly as it always did.
check("allowed unless a rank says otherwise",
    runAsServer(mod, "give @s stone").ok, true)
saveRank("mod", { perms: ["admin.commands", "-cmd.give"] })
check("and a denial is what refuses it", runAsServer(mod, "give @s stone").ok, false)

check("a command nobody denied runs", runAsServer(mod, "kill @e[type=cow]").ok, true)
check("and the denied one does not", runAsServer(mod, "give @s stone").ok, false)

// Ordinary nodes in every respect — that is the point of making them nodes.
saveRank("mod", { perms: ["admin.commands", "cmd.*"] })
check("clearing the denial restores it", runAsServer(mod, "give @s stone").ok, true)
saveRank("mod", { perms: ["admin.commands", "cmd.*", "-cmd.gamemode"] })
check("a denial carves a hole in the wildcard",
    runAsServer(mod, "gamemode creative").ok, false)
check("without touching its siblings", runAsServer(mod, "give @s stone").ok, true)

// Inheritance, which is the half that makes this usable on a real ladder.
saveRank("mod", { perms: ["admin.commands", "cmd.kill"] })
saveRank("admin", { perms: [] })
check("a rank inherits command nodes from the rank below",
    runAsServer(admin, "kill @e").ok, true)

// And the world keeps the final say, so a node can never widen the whitelist.
setSetting("commands.allowed", "kill")
saveRank("mod", { perms: ["admin.commands", "cmd.*"] })
check("a rank that was not denied still runs it",
    runAsServer(mod, "give @s stone").ok, true)
check("while what it did allow still runs", runAsServer(mod, "kill @e").ok, true)

applyPreset("server")
resetSetting("commands.allowed")

console.log("\n— who gets it —")
// Deliberately not in any shipped ladder. Handing somebody the vanilla command
// set is a decision an owner makes for one person, not something a preset does.
check("admin.commands is declared",
    Object.values(PERMISSION_NODES).flat().includes("admin.commands"), true)
check("an Owner has it through the wildcard", has(owner, "admin.commands"), true)
check("an Admin does NOT", has(admin, "admin.commands"), false)
check("nor a Mod", has(mod, "admin.commands"), false)

// ...but it can be granted, which is the entire point.
saveRank("admin", { perms: ["admin.commands"] })
check("granting it works", has(admin, "admin.commands"), true)
applyPreset("server")

console.log("\n— nothing is on until somebody turns it on —")
// The list used to SHIP with fifty-six commands enabled, which made a whitelist
// into a blocklist with extra steps. The setting's own comment argued for empty
// the whole time; now the value agrees with it.
check("the shipped whitelist is empty",
    String(DEFAULTS["commands.allowed"].value).trim(), "")

console.log("\n— what the OFFERED list must never contain —")
// The curation moved: the default is empty, so these guarantees now belong to
// the set the Op commands screen offers. They are not opinions — each one hands
// over more than the whitelist means to, and the failure is silent, so they get
// pinned rather than remembered.
const shipped = [...OP_COMMANDS]

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
    ["kill", "clear", "give", "effect", "enchant", "gamemode", "teleport",
        "summon", "xp", "time", "weather", "fill", "setblock", "kill"]
        .filter(c => !shipped.includes(c)), [])
check("every entry is a single lowercase word",
    shipped.filter(c => !/^[a-z]+$/.test(c)), [])
check("no duplicates", shipped.length, new Set(shipped).size)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
