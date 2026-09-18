import { __test, CustomCommandParamType as P } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { command } from "../Admin+ BP/scripts/core/registry.js"
import { setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { NS } from "../Admin+ BP/scripts/config.js"
import {
    noteCommand, noteExecuted, recentCommands, commandsBy, searchCommands,
    refusedCommands, commandLogSize, clearCommandLog, commandText,
    __resetCommandLog
} from "../Admin+ BP/scripts/core/cmdlog.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const full = name => `${NS}:${name}`

const staff = {
    id: "c-staff", name: "Staff", nameTag: "Staff",
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
}
const member = {
    id: "c-member", name: "Member", nameTag: "Member",
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
}
__test.players.push(staff, member)

// Probe commands declared through the REAL command() API, so what is under
// test is the funnel in core/registry.js rather than a reimplementation of it.
// One gated, one open — the gated one is how a refusal gets recorded at all.
command({
    name: "__logprobe",
    description: "test probe",
    optional: [{ name: "who", type: P.PlayerSelector }, { name: "note", type: P.String }],
    run: () => {}
})
command({
    name: "__gatedprobe",
    description: "test probe, gated",
    perm: "admin.ban",
    run: () => {}
})
__test.runStartup()

const fire = (player, name, ...args) => __test.invoke(full(name), player, ...args)

console.log("\n— every command that runs is written down —")
{
    __resetCommandLog()
    fire(staff, "__logprobe", "Member", "hello")
    const entries = recentCommands(10)
    check("one entry", entries.length, 1)
    check("naming the command", entries[0].cmd, "__logprobe")
    check("and who typed it", entries[0].name, "Staff")
    check("with the arguments as typed", entries[0].args, "Member hello")
    check("and it did not run as anything else", entries[0].ran, undefined)
    check("it reads back as a command line", commandText(entries[0]), "/__logprobe Member hello")
    check("nothing is marked refused", entries[0].refused, undefined)
}

console.log("\n— including the ones that were turned away —")
// The more interesting half. Somebody working down the command list trying
// what sticks looks exactly like a column of refusals, and nothing else in the
// pack would show it.
{
    __resetCommandLog()
    setRanks(member.id, ["Member"], member.name)
    fire(member, "__gatedprobe")
    const entries = recentCommands(10)
    check("the attempt is recorded", entries.length, 1)
    check("marked refused", entries[0].refused, "no permission")
    check("naming who tried", entries[0].name, "Member")
    check("and it shows up in the refused list", refusedCommands(10).length, 1)
}

console.log("\n— a selector that matches nobody is a refusal, not a silence —")
{
    __resetCommandLog()
    fire(staff, "__logprobe", "NoSuchPlayer")
    const entries = recentCommands(10)
    check("recorded", entries.length, 1)
    check("with the reason", entries[0].refused, 'nothing matched "NoSuchPlayer"')
    // The point of capturing BEFORE resolution: after it, that slot would hold
    // entity objects, and a failed resolution holds nothing readable at all.
    check("and what they actually typed survives", entries[0].args, "NoSuchPlayer")
}

console.log("\n— arguments are captured as text, never as objects —")
// The single most common way a log line becomes useless is `[object Object]`.
{
    __resetCommandLog()
    fire(staff, "__logprobe", "Member", "a note")
    const entry = recentCommands(1)[0]
    check("no object stringification leaked in", /\[object/.test(entry.args ?? ""), false)
    check("the picked name is the text", entry.args, "Member a note")
}

console.log("\n— what a passthrough expanded to rides on the same entry —")
// Not a second entry. The same command appearing twice is the confusion the
// 2.6.6 reorganisation exists to end.
{
    __resetCommandLog()
    noteCommand(staff, "eff", ["mobs", "speed"])
    noteExecuted(staff, "effect @e[tag=tmp1] speed")
    const entries = recentCommands(10)
    check("still one entry", entries.length, 1)
    check("typed is what they typed", commandText(entries[0]), "/eff mobs speed")
    check("ran is what it became", entries[0].ran, "/effect @e[tag=tmp1] speed")

    // A leading slash, always — the two routes into noteExecuted disagree
    // about it and a log that reads as two different things is worse than one
    // that reads as neither.
    __resetCommandLog()
    noteCommand(staff, "kill", ["mobs"])
    noteExecuted(staff, "/kill @e[tag=tmp2]")
    check("one slash, not two", recentCommands(1)[0].ran, "/kill @e[tag=tmp2]")
}

console.log("\n— it attaches to the right person's line —")
{
    __resetCommandLog()
    noteCommand(member, "eff", ["me"])
    noteCommand(staff, "eff", ["all"])
    noteExecuted(staff, "effect @a speed")
    const mine = commandsBy(staff.id, 10)
    const theirs = commandsBy(member.id, 10)
    check("the expansion landed on the staff line", mine[0].ran, "/effect @a speed")
    check("and not on somebody else's", theirs[0].ran, undefined)
}

console.log("\n— one person's history —")
{
    __resetCommandLog()
    noteCommand(staff, "gm", ["creative"])
    noteCommand(member, "warp", ["spawn"])
    noteCommand(staff, "vanish")
    check("only theirs comes back", commandsBy(staff.id, 10).length, 2)
    check("newest first", commandsBy(staff.id, 10)[0].cmd, "vanish")
    check("a command with no arguments is still an entry",
        commandsBy(staff.id, 10)[0].args, undefined)
    check("and reads without a trailing space",
        commandText(commandsBy(staff.id, 10)[0]), "/vanish")
}

console.log("\n— search finds it however it was typed —")
{
    __resetCommandLog()
    noteCommand(staff, "give", ["NotSteve", "diamond"])
    check("by command", searchCommands("give").length, 1)
    check("by argument", searchCommands("diamond").length, 1)
    check("by who typed it", searchCommands("Staff").length, 1)
    // Asked for by name: "it shouldn't be case senseitive either."
    check("case does not matter", searchCommands("GIVE").length, 1)
    check("nor does it for an argument", searchCommands("DIAMOND").length, 1)
    // Substring, not prefix — the rule the chat search already follows.
    check("a substring is enough", searchCommands("ste").length, 1)
    check("and something absent finds nothing", searchCommands("zzzz").length, 0)
    check("an empty search is not everything", searchCommands("").length, 0)
}

console.log("\n— the switch, and the ceiling —")
{
    __resetCommandLog()
    setSetting("logs.commands", "false")
    fire(staff, "__logprobe", "Member", "quiet")
    check("switched off, nothing is recorded", commandLogSize(), 0)
    // And the expansion cannot sneak one in through the side door.
    noteExecuted(staff, "effect @a speed")
    check("nor through noteExecuted", commandLogSize(), 0)
    resetSetting("logs.commands")

    __resetCommandLog()
    setSetting("logs.commandCap", "5")
    for (let i = 0; i < 12; i++) noteCommand(staff, `probe${i}`)
    check("the cap holds", commandLogSize(), 5)
    check("and keeps the NEWEST, which is what somebody is coming to read",
        recentCommands(1)[0].cmd, "probe11")
    resetSetting("logs.commandCap")
}

console.log("\n— it is its own table, and that is the whole point —")
// core/chatlog.js says it outright for chat: sharing the audit log's ring
// buffer would push every ban out of Recent within minutes. Commands are the
// higher-volume half of that argument, because ordinary players type /warps.
{
    __resetCommandLog()
    const { recent: auditRecent, clear: clearAudit } =
        await import("../Admin+ BP/scripts/core/logs.js")
    clearAudit()
    for (let i = 0; i < 40; i++) noteCommand(member, "warps")
    check("forty commands are in the command log", commandLogSize(), 40)
    check("and none of them reached the action log", auditRecent(50).length, 0)
}

console.log("\n— clearing one log leaves the others alone —")
{
    __resetCommandLog()
    noteCommand(staff, "gm", ["creative"])
    check("there is something to clear", commandLogSize(), 1)
    clearCommandLog()
    check("and it is gone", commandLogSize(), 0)
    check("reading an empty log is not an error", recentCommands(10).length, 0)
    check("nor is searching one", searchCommands("gm").length, 0)
    check("nor is attaching an expansion to nothing",
        noteExecuted(staff, "gamemode creative"), undefined)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
