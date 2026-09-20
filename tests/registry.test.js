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
// **One deliberate exception, listed here by name.** `picker: true` keeps the
// real type so the game offers its player list — asked for on the moderation
// commands, where naming one person is the whole job and `/mute @a` is not
// something anybody needs. The cost is that `@` forms are refused on THOSE
// commands again. Spelling the list out is the point: a command cannot join it
// quietly, and anything that appears here without being added on purpose is
// the old bug coming back.
const PICKER = [
    // Moderation — asked for by name 2026-09-12.
    "mute", "ban", "unmute", "warn", "warnings",
    // The pack's OWN single-target commands, 2026-09-17. Naming one
    // person is the whole job of each, so trading `@` forms for the
    // game's player list is the same bargain the moderation five made.
    "nick", "sudo", "invsee", "grant", "report", "smite", "mm",
    "tpa", "tpahere", "msg", "pm", "praccept", "prchat", "prdeny",
    "vanish",
    // Land claims, 2026-09-19. Both name one person on YOUR OWN claim, which is
    // the picker's exact case — and `/trust @a` on a private plot is not a
    // thing anybody wants to be one mistyped character away from.
    "trust", "untrust",
    // 2026-09-20. These were missed when the picker went out to the rest of the
    // pack, TWICE, and the reason is mechanical: their parameter list is a
    // named constant, so every scan looking for
    // `CustomCommandParamType.PlayerSelector` inside the command block found
    // nothing and filed them as not taking a player at all.
    "ec", "enderchest"
].map(full)
{
    const offenders = []
    for (const [name, { def }] of registered) {
        if (PICKER.includes(name)) continue
        for (const p of [...def.mandatoryParameters, ...def.optionalParameters]) {
            if (p.type === P.PlayerSelector || p.type === P.EntitySelector) {
                offenders.push(`${name} ▸ ${p.name}`)
            }
        }
    }
    check("no selector survives registration, bar the listed few", offenders, [])
}

// **Every command of ours that names a person is CLASSIFIED — picker, or a
// written reason.** Read off commandSpecs(), which holds the resolved
// parameter objects, so a list declared as a named constant is seen exactly
// like an inline one.
//
// That distinction is the entire point of this block. `/ec` and `/enderchest`
// declare `optional: PLAYER`, and every source-scanning audit of "which
// commands take a player" reported them as taking none — so they sat without
// a picker through two separate passes that were each meant to catch them.
{
    // Reasons, not exemptions: a name here has to say why the picker is wrong
    // for it, and the check below proves each one still takes a player.
    const noPicker = {
        gm: "group targeting is real here - /gm creative @a for a build event - "
          + "and keeping one live command on the String path stops forEngine's "
          + "downgrade rotting into code only unit tests reach",
        gmc: "a shortcut for /gm creative, and splitting the family would be worse",
        gms: "same, survival",
        gma: "same, adventure",
        gmsp: "same, spectator"
        // /tp is NOT here, and that is worth a line: it was, and this block's
        // rot check rejected it immediately. /tp declares plain String
        // parameters by hand (`target_me_or_all`) rather than a selector type,
        // so it never reaches this scan at all - a reason for it would have
        // been a comment about a rule it is not subject to.
    }

    const P_SEL = new Set([P.PlayerSelector, P.EntitySelector])
    const unclassified = []
    const takesPlayer = new Set()
    for (const spec of commandSpecs()) {
        if (spec.group === "vanilla") continue
        // The probe registered at the top of this file, not a real command.
        if (spec.name.startsWith("__")) continue
        const params = [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
        if (!params.some(p => P_SEL.has(p.type))) continue
        takesPlayer.add(spec.name)
        if (spec.picker) continue
        if (spec.name in noPicker) continue
        unclassified.push(spec.name)
    }

    check("the scan sees commands whose parameters are a named constant",
        ["ec", "enderchest"].every(n => takesPlayer.has(n)), true)
    check("every command that names a person has a picker or a written reason",
        unclassified.sort(), [])
    // And the reasons cannot rot: one for a command that no longer takes a
    // player excuses nothing while looking like it excuses something.
    check("every written reason names a command that still takes a player",
        Object.keys(noPicker).filter(n => !takesPlayer.has(n)).sort(), [])

    // And the listed few really did keep it — an opt-in that silently did
    // nothing would leave the moderator with no picker and no explanation.
    const withPicker = PICKER.filter(name => {
        const def = registered.get(name)?.def
        return [...(def?.mandatoryParameters ?? []), ...(def?.optionalParameters ?? [])]
            .some(p => p.type === P.PlayerSelector || p.type === P.EntitySelector)
    })
    check("every command that asked for the picker has one", withPicker, PICKER)

    // And the downgrade is not silent — the name has to say what goes there,
    // because the description is off-screen while you fill the argument in.
    // **/gm is deliberately NOT on the list above**, and it is the last command
    // that is. Group use is real there — `/gm creative @a` for a build event —
    // and it keeps the String-downgrade path exercised by a live command rather
    // than by unit tests alone. Picker-ising everything would leave that path
    // dead code.
    const gm = registered.get(full("gm")).def
    check("/gm still takes plain text, so the downgrade path stays covered",
        gm.optionalParameters[0].type, P.String)
    check("and its name says what to put there",
        gm.optionalParameters[0].name, "player_or_me")
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
