import { __test, CustomCommandParamType } from "@minecraft/server"
import { setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { tokenise, coerce, specFor, runPackCommand } from "../Admin+ BP/scripts/core/dispatch.js"
import { command } from "../Admin+ BP/scripts/core/registry.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const P = CustomCommandParamType

// Registered up front. The registry is populated by feature modules loading,
// and this suite deliberately does not import them — so the only command it
// can look up is one it declares itself.
let sawPlayer, sawArgs
command({
    name: "dispatchtest",
    description: "test only",
    perm: "admin.panel",
    mandatory: [{ name: "who", type: P.PlayerSelector }],
    optional: [{ name: "note", type: P.String }],
    run: (player, args) => { sawPlayer = player; sawArgs = args }
})

console.log("\n— splitting a line the way a command line is split —")
check("plain words", tokenise("gm creative Steve"), ["gm", "creative", "Steve"])
check("runs of spaces collapse", tokenise("  gm    creative  "), ["gm", "creative"])
// A reason or a nickname has spaces in it, so quotes have to survive.
check("double quotes hold a phrase together",
    tokenise('ban Steve "griefing the spawn"'), ["ban", "Steve", "griefing the spawn"])
check("and single quotes do too",
    tokenise("nick Steve 'Big Red'"), ["nick", "Steve", "Big Red"])
check("nothing at all is nothing", tokenise(""), [])
check("and neither is undefined", tokenise(undefined), [])

console.log("\n— arguments become what the handler expects —")
{
    // typeId matters: resolveSelector filters an @-selector down to players, and
    // a stand-in without one is filtered out of its own result. A plain NAME
    // returns before that filter, which is why it passed while @s did not.
    // NOT called "Me": `me` is a reserved word now (core/selector.js WORDS), so
    // a stand-in with that name would make the name check below pass without
    // ever looking up a name.
    const me = { id: "d-me", name: "Dispatcher", typeId: "minecraft:player",
                 getTags: () => [], commandPermissionLevel: 1,
                 location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension }
    __test.players.push(me)

    check("a word stays a word", coerce("creative", { type: P.Enum }, me),
        { ok: true, value: "creative" })
    check("an integer is truncated", coerce("7.9", { type: P.Integer }, me),
        { ok: true, value: 7 })
    check("a float is not", coerce("7.5", { type: P.Float }, me), { ok: true, value: 7.5 })
    check("nonsense where a number goes is refused",
        coerce("soon", { type: P.Integer }, me).ok, false)
    check("true is true", coerce("true", { type: P.Boolean }, me), { ok: true, value: true })
    check("so is on", coerce("on", { type: P.Boolean }, me), { ok: true, value: true })
    check("off is false", coerce("off", { type: P.Boolean }, me), { ok: true, value: false })
    check("and a word that is neither is refused",
        coerce("maybe", { type: P.Boolean }, me).ok, false)

    // The hard one, and the reason this file is short: the selector resolver
    // already exists and already knows @s, @a, names and nicknames.
    const sel = coerce("@s", { type: P.PlayerSelector }, me)
    check("a selector becomes entities", sel.ok && sel.value.map(p => p.id), ["d-me"])
    check("a name works too",
        coerce("Dispatcher", { type: P.PlayerSelector }, me).value.map(p => p.id), ["d-me"])
    // And the plain words the target box now teaches reach the console as well
    // — same resolver, so this is the console inheriting it rather than a
    // second copy of it.
    check("so does the word the help offers",
        coerce("me", { type: P.PlayerSelector }, me).value.map(p => p.id), ["d-me"])
    check("a target that matches nobody points at those words",
        coerce("Nobody", { type: P.PlayerSelector }, me).reason.includes("everyone"), true)
    // A selector matching nobody is an ERROR, not an empty list: handlers
    // written against the engine have never had to consider one, because the
    // engine refuses the command before calling them.
    check("a selector that matches nobody is refused",
        coerce("Nobody", { type: P.PlayerSelector }, me).ok, false)

    __test.players.pop()
}

console.log("\n— finding the command —")
check("by name", specFor("dispatchtest")?.name, "dispatchtest")
// The console should not make people type the namespace they came here to avoid.
check("the a: prefix is optional", specFor("a:dispatchtest")?.name, "dispatchtest")
check("case does not matter", specFor("DISPATCHTEST")?.name, "dispatchtest")
check("and an unknown name is nothing", specFor("nosuchthing"), undefined)

console.log("\n— running one —")
{
    const op = { id: "d-op", name: "Op", typeId: "minecraft:player",
                 getTags: () => [], commandPermissionLevel: 1,
                 location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension }
    __test.players.push(op)

    check("a line that is not ours falls through",
        runPackCommand(op, "kill @e[type=cow]"), undefined)
    check("so does an empty one", runPackCommand(op, "   "), undefined)

    const ran = runPackCommand(op, "dispatchtest Op")
    check("ours runs", ran?.ok, true)
    check("and reports the name it ran", ran?.command, "a:dispatchtest")
    check("the handler got the player", sawPlayer?.id, "d-op")
    check("and entities, not the word", sawArgs?.[0]?.map(p => p.id), ["d-op"])
    check("with the optional left undefined", sawArgs?.[1], undefined)

    // The last String parameter swallows the rest of the line, so a reason does
    // not have to be quoted — /ban Steve griefing again keeps "again".
    runPackCommand(op, "dispatchtest Op griefing the spawn again")
    check("a trailing reason keeps its words", sawArgs?.[1], "griefing the spawn again")

    // Missing arguments are named rather than crashing the handler.
    const short = runPackCommand(op, "dispatchtest")
    check("a missing argument is refused", short?.ok, false)
    check("and the message names it", short?.reason.includes("<who>"), true)
    // An Enum parameter must be registered under a NAMESPACED name — that is how
    // Bedrock links it to its values — so the parameter is literally called
    // `a:effect`. Showing that to somebody who just typed the command wrong
    // hands them a registration detail instead of an argument.
    check("and does not leak the enum namespace into the usage line",
        /<[a-z0-9_]+:/i.test(short?.reason ?? ""), false)

    // Permission is the command's own, checked exactly as the engine checks it.
    const member = { id: "d-member", name: "Member", getTags: () => [], commandPermissionLevel: 0 }
    saveRank("nopanel", { display: "§7NoPanel", perms: ["-admin.panel"] })
    setRanks(member.id, ["nopanel"], member.name)
    const refused = runPackCommand(member, "dispatchtest Op")
    check("the console does not bypass a command's own permission", refused?.ok, false)
    check("and says so", refused?.reason.includes("permission"), true)

    __test.players.pop()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
