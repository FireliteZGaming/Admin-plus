import { __test, CustomCommandParamType as P } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { commandSpecs, command } from "../Admin+ BP/scripts/core/registry.js"
import { onPlayerJoin, setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// The namespace is read, never spelled: this test hardcoded "admin:" and every
// lookup missed, because the pack registers under "a:".
const full = name => `${NS}:${name}`

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// The whole file exists because system.beforeEvents.startup used to be a no-op
// in the stub, so core/registry.js's engine-facing half — the parameter list it
// hands Bedrock and the argument marshalling it does on the way back — had
// never been executed by a test. That is precisely where the selector bug lived.

// A probe command, declared through the real command() API and registered with
// all the others. Watching what its handler RECEIVES is the contract itself;
// driving /vanish instead would be testing what vanish does about it.
const probeSaw = []
command({
    name: "__probe",
    description: "test probe",
    mandatory: [{ name: "who", type: P.PlayerSelector }],
    optional: [{ name: "what", type: P.EntitySelector }],
    run: (player, args) => { probeSaw.push(args) }
})

const registered = __test.runStartup()

console.log("\n— every command actually reached the engine —")
{
    check("startup registered something at all", registered.size > 0, true)
    // Registration is per-spec and a throw is swallowed and logged, so a
    // mismatch here means a command silently does not exist in game.
    const specs = commandSpecs()
    const missing = specs
        .filter(s => (s.mandatory?.length ?? 0) + (s.optional?.length ?? 0) <= 8)
        .map(s => full(s.name))
        .filter(n => !registered.has(n))
    check("and every spec under the 8-parameter cap got through", missing, [])
}

console.log("\n— NO command may hand Bedrock a selector parameter —")
// **This is the rule the bug broke, and the only place it can be enforced.**
//
// A PlayerSelector/EntitySelector parameter is expanded by the ENGINE at the
// command's declared permission level, which registry.js sets to `Any` on
// purpose — so every `@` form is refused before the handler runs. `/tp` was
// fixed at its call site, the 54 passthroughs in theirs, and two dozen of the
// pack's own commands were left declaring it. /vanish was reported from a world.
//
// Asserted against what the ENGINE was given, not against the source text: the
// specs still say PlayerSelector, and that is fine, because registry.js is what
// translates. Reading the registration is the only way to tell those apart.
{
    const offenders = []
    for (const [name, { def }] of registered) {
        for (const p of [...def.mandatoryParameters, ...def.optionalParameters]) {
            if (p.type === P.PlayerSelector || p.type === P.EntitySelector) {
                offenders.push(`${name} ▸ ${p.name}`)
            }
        }
    }
    check("not one selector parameter survives registration", offenders, [])

    // And the downgrade is not silent — the name has to say what goes there,
    // because the description is off-screen while you fill the argument in.
    const vanish = registered.get(full("vanish")).def
    check("/vanish takes plain text now", vanish.optionalParameters[0].type, P.String)
    check("and its name says what to put there",
        vanish.optionalParameters[0].name, "player_or_me")
}

console.log("\n— a selector argument reaches the handler as entities —")
// The other half of the contract: handlers were written against expanded
// selectors and must not have to change. If this fails, 23 commands are broken.
{
    const tags = new Set()
    const me = {
        id: "reg1", name: "Vanisher", nameTag: "Vanisher", typeId: "minecraft:player",
        commandPermissionLevel: 1, location: { x: 0, y: 64, z: 0 },
        dimension: __test.dimension, inbox: [],
        getTags: () => [...tags], addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        sendMessage: m => me.inbox.push(m),
        runCommand: () => ({ successCount: 1 }),
        addEffect: () => {}, removeEffect: () => {},
        getComponent: () => undefined
    }
    __test.players.push(me)
    onPlayerJoin(me)
    saveRank("boss", { display: "§4Boss", weight: 100, staff: true, perms: ["*"] })
    setRanks(me.id, ["boss"], me.name)

    // `me` — the word that has to work for somebody who has never typed an @.
    probeSaw.length = 0
    __test.invoke(full("__probe"), me, "me")
    check("the handler was called", probeSaw.length, 1)
    check("and got ENTITIES, not the word", Array.isArray(probeSaw[0][0]), true)
    check("which is the player who typed it", probeSaw[0][0][0]?.id, me.id)

    // An @ form — the case that was refused by the engine before the handler
    // ever ran, for two dozen commands, for months.
    probeSaw.length = 0
    __test.invoke(full("__probe"), me, "@s")
    check("@s resolves now instead of being refused", probeSaw[0]?.[0]?.[0]?.id, me.id)

    probeSaw.length = 0
    __test.invoke(full("__probe"), me, "Vanisher")
    check("a literal name still works, as it always did", probeSaw[0]?.[0]?.[0]?.id, me.id)

    // An absent optional stays undefined: "no argument" is how /vanish means
    // "me", and an empty array would read as "matched nobody".
    probeSaw.length = 0
    __test.invoke(full("__probe"), me, "me", undefined)
    check("an optional left off stays undefined", probeSaw[0]?.[1], undefined)

    // A target that matches nobody is refused BY THE REGISTRY, and the handler
    // never runs — it would otherwise act on an empty list and report success.
    probeSaw.length = 0
    const refused = __test.invoke(full("__probe"), me, "NobodyByThatName")
    check("an unmatched target is refused", refused?.status !== undefined, true)
    check("the handler never ran for it", probeSaw.length, 0)
    check("and the refusal points at the words that do work",
        String(refused?.message ?? "").includes("me"), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
