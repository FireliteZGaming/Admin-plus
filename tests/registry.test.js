import { __test, CustomCommandParamType as P } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import "../Admin+ BP/scripts/main.js"
import { commandSpecs, command, defineEnum } from "../Admin+ BP/scripts/core/registry.js"
import { onPlayerJoin, setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { NS } from "../Admin+ BP/scripts/config.js"

// The namespace is read, never spelled: this test once hardcoded "admin:" and
// every lookup missed, because the pack registers under "a:".
const full = name => `${NS}:${name}`

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

/** Let a chain of awaited forms run to the end. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

// core/registry.js is the one place every command passes through, so the
// pack's three command rules are enforced there and checked here, against what
// the ENGINE was given rather than against the source text:
//
//   1. a player argument offers the game's player list
//   2. an argument left off is asked for
//   3. a `rest` text argument takes a plain sentence

// Probe commands, declared through the real command() API and registered with
// all the others. Watching what a handler RECEIVES is the contract itself.
const typedSaw = []
command({
    name: "__probe",
    description: "test probe: typed selectors",
    picker: false,
    mandatory: [{ name: "who", type: P.PlayerSelector }],
    optional: [{ name: "what", type: P.EntitySelector }],
    run: (player, args) => { typedSaw.push(args) }
})

const colour = defineEnum("probecolour", ["red", "green", "blue"])
const askSaw = []
command({
    name: "__askprobe",
    description: "test probe: asking",
    mandatory: [
        { name: "who", type: P.PlayerSelector },
        { name: colour, type: P.Enum },
        { name: "note", type: P.String, rest: true, label: "A note" }
    ],
    run: (player, args) => { askSaw.push(args) }
})

const countSaw = []
command({
    name: "__countprobe",
    description: "test probe: a number, and a prompt of its own",
    mandatory: [
        { name: "amount", type: P.Integer },
        { name: "place", type: P.String, ask: async () => "from-the-list" }
    ],
    run: (player, args) => { countSaw.push(args) }
})

command({
    name: "__badrest",
    description: "test probe: rest in the wrong place",
    optional: [
        { name: "first", type: P.String, rest: true },
        { name: "second", type: P.String }
    ],
    run: () => {}
})

const registered = __test.runStartup()
const defOf = name => registered.get(full(name))?.def
const paramsOf = def => [...(def?.mandatoryParameters ?? []), ...(def?.optionalParameters ?? [])]
const isSelector = p => p.type === P.PlayerSelector || p.type === P.EntitySelector
const isProbe = spec => spec.name.startsWith("__")
const ours = commandSpecs().filter(spec => !isProbe(spec))

console.log("\n— every command actually reached the engine —")
{
    check("startup registered something at all", registered.size > 0, true)
    // Registration is per-spec and a throw is swallowed and logged, so a
    // mismatch here means a command silently does not exist in game.
    const missing = commandSpecs()
        .filter(s => (s.mandatory?.length ?? 0) + (s.optional?.length ?? 0) <= 8)
        .map(s => full(s.name))
        .filter(n => !registered.has(n))
    check("and every spec under the 8-parameter cap got through", missing, [])
    check("no registration went past the cap either",
        [...registered].filter(([, { def }]) => paramsOf(def).length > 8).map(([n]) => n), [])
}

console.log("\n— rule 1: a player argument offers the game's player list —")
// The list is the DEFAULT, so a new command gets it without asking. A command
// that wants typed text instead (`me`, `all`, `@a`) says `picker: false`, and
// has to be named here with a reason — it cannot opt out quietly.
{
    const typed = {
        gm: "group targeting is real here — /gm creative @a for a build event",
        gmc: "a shortcut for /gm creative, and splitting the family would be worse",
        gms: "same, survival",
        gma: "same, adventure",
        gmsp: "same, spectator"
    }

    // Read off commandSpecs(), which holds the resolved parameter objects, so
    // a list declared as a named constant (/ec, /enderchest) is seen exactly
    // like an inline one. A source scan missed those two, twice.
    const naming = ours.filter(spec =>
        [...(spec.mandatory ?? []), ...(spec.optional ?? [])].some(isSelector))
    check("the scan sees commands whose parameters are a named constant",
        ["ec", "enderchest"].every(n => naming.some(spec => spec.name === n)), true)

    const optedOut = naming.filter(spec => spec.picker === false).map(spec => spec.name).sort()
    check("only the commands with a written reason take typed text instead",
        optedOut, Object.keys(typed).sort())

    const withoutList = naming
        .filter(spec => spec.picker !== false)
        .filter(spec => !paramsOf(defOf(spec.name)).some(isSelector))
        .map(spec => spec.name)
    check("every other command that names a player gives the engine a real selector",
        withoutList, [])

    const leaked = optedOut.filter(name => paramsOf(defOf(name)).some(isSelector))
    check("and a typed-text command gives it none, or `@a` would be refused there",
        leaked, [])

    // The hint a typed-text slot carries is its name: that is all that is on
    // screen while the argument is being filled in.
    const gmPlayer = paramsOf(defOf("gm")).find(p => p.name.startsWith("player"))
    check("/gm's player slot is plain text", gmPlayer?.type, P.String)
    check("and its name says what to put there", gmPlayer?.name, "player_or_me")

    check("the accept and deny pairs agree with each other",
        ["tpaccept", "tpadeny", "praccept", "prdeny"]
            .map(name => paramsOf(defOf(name))[0]?.type),
        [P.PlayerSelector, P.PlayerSelector, P.PlayerSelector, P.PlayerSelector])
}

console.log("\n— rule 2: an argument left off is asked for —")
// The engine refuses a command outright when a mandatory parameter is missing,
// so the handler never gets the chance to ask. Every command of ours therefore
// registers with NO mandatory parameters, and the registry asks instead.
{
    const stillMandatory = ours
        .filter(spec => (defOf(spec.name)?.mandatoryParameters ?? []).length > 0)
        .map(spec => spec.name)
    check("no command of ours can be refused by the engine for a missing argument",
        stillMandatory, [])

    check("needed arguments keep their order, ahead of the optional ones",
        paramsOf(defOf("__askprobe")).slice(0, 3).map(p => p.name), ["who", colour, "note"])
}

// Two players, so there is somebody to pick.
const makePlayer = (id, name, x) => {
    const tags = new Set()
    const player = {
        id, name, nameTag: name, typeId: "minecraft:player",
        commandPermissionLevel: 1, location: { x, y: 64, z: 0 },
        dimension: __test.dimension, inbox: [],
        getTags: () => [...tags], addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t), hasTag: t => tags.has(t),
        sendMessage: m => player.inbox.push(m),
        runCommand: () => ({ successCount: 1 }),
        addEffect: () => {}, removeEffect: () => {},
        getComponent: () => undefined
    }
    __test.players.push(player)
    onPlayerJoin(player)
    return player
}
const me = makePlayer("reg1", "Vanisher", 0)
const near = makePlayer("reg2", "Nearby", 5)
const far = makePlayer("reg3", "Faraway", 500)
saveRank("boss", { display: "§4Boss", weight: 100, staff: true, perms: ["*"] })
setRanks(me.id, ["boss"], me.name)

const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => p[1])
const pick = selection => ({ canceled: false, selection })
const submit = (...formValues) => ({ canceled: false, formValues })

console.log("\n— asking: bare, partly typed, and backed out of —")
{
    // Bare. Three questions, in the order the arguments are declared.
    askSaw.length = 0; __ui.shown.length = 0
    __ui.answers.push(pick(0), pick(1), submit("hello there"))
    __test.invoke(full("__askprobe"), me)
    check("nothing runs until the questions are answered", askSaw.length, 0)
    await settle()
    check("then the handler runs once", askSaw.length, 1)
    check("three forms were shown", __ui.shown.length, 3)

    const [who, shade, note] = askSaw[0] ?? []
    check("the player arrives as a list of entities, as the engine hands it over",
        Array.isArray(who) && who.length === 1, true)
    check("nearest first, so the top row is the player standing closest", who?.[0]?.id, near.id)
    check("the fixed word is the button that was tapped", shade, "green")
    check("and the text is what was typed in the box", note, "hello there")

    const listed = buttonsOf(__ui.shown[0]).join(" | ")
    check("the pick list names the other players", listed.includes("Nearby") && listed.includes("Faraway"), true)
    check("and not the person asking", listed.includes("Vanisher"), false)
    check("the fixed words are one button each", buttonsOf(__ui.shown[1]).length, 3)

    // Partly typed: only what is missing is asked for.
    askSaw.length = 0; __ui.shown.length = 0
    __ui.answers.push(submit("just the note"))
    __test.invoke(full("__askprobe"), me, [far], "blue")
    await settle()
    check("one form for the one missing argument", __ui.shown.length, 1)
    check("what was typed is kept as typed",
        [askSaw[0]?.[0]?.[0]?.id, askSaw[0]?.[1], askSaw[0]?.[2]], [far.id, "blue", "just the note"])

    // Closing a form is "never mind".
    askSaw.length = 0; __ui.shown.length = 0
    __test.invoke(full("__askprobe"), me)
    await settle()
    check("closing the first question stops there", __ui.shown.length, 1)
    check("and the handler never runs", askSaw.length, 0)

    // An empty text box is not an answer.
    askSaw.length = 0; __ui.shown.length = 0
    __ui.answers.push(submit("   "))
    __test.invoke(full("__askprobe"), me, [far], "blue")
    await settle()
    check("a blank box is treated as closing it", askSaw.length, 0)

    // Fully typed still runs the same tick, with no form at all.
    askSaw.length = 0; __ui.shown.length = 0
    __test.invoke(full("__askprobe"), me, [far], "red", "typed")
    check("a complete command runs at once", askSaw.length, 1)
    check("and shows nothing", __ui.shown.length, 0)
}

console.log("\n— asking: numbers, and a parameter with a prompt of its own —")
{
    countSaw.length = 0; __ui.shown.length = 0
    __ui.answers.push(submit("12.9"))
    __test.invoke(full("__countprobe"), me)
    await settle()
    check("a whole number comes back as a number", countSaw[0]?.[0], 12)
    check("and a parameter's own `ask` supplies its value", countSaw[0]?.[1], "from-the-list")
    check("so only the number needed a form", __ui.shown.length, 1)

    countSaw.length = 0; __ui.shown.length = 0
    __ui.answers.push(submit("lots"))
    __test.invoke(full("__countprobe"), me)
    await settle()
    check("something that is not a number is refused, not guessed at", countSaw.length, 0)
}

console.log("\n— rule 3: a `rest` argument takes a plain sentence —")
// Bedrock's String takes one word unless quoted, so a sentence arrives as
// several arguments. The registry adds spare word slots after a `rest`
// parameter and joins them back together before the handler sees them.
{
    const def = defOf("__askprobe")
    check("the spare slots fill the command up to the eight-parameter cap",
        paramsOf(def).length, 8)
    check("and are named so the usage line reads in order",
        paramsOf(def).slice(3).map(p => p.name), ["word2", "word3", "word4", "word5", "word6"])

    askSaw.length = 0
    __test.invoke(full("__askprobe"), me, [far], "red", "meet", "me", "at", "spawn")
    check("separate words reach the handler as one sentence", askSaw[0]?.[2], "meet me at spawn")
    check("and the handler gets exactly the arguments it declared", askSaw[0]?.length, 3)

    askSaw.length = 0
    __test.invoke(full("__askprobe"), me, [far], "red", "one quoted sentence")
    check("a quoted sentence still arrives whole", askSaw[0]?.[2], "one quoted sentence")

    check("`rest` anywhere but the last text parameter adds no slots",
        paramsOf(defOf("__badrest")).length, 2)

    // The commands that carry a sentence, counted from the specs so that a new
    // one cannot be added the old one-word way without this list changing.
    const sentences = ours
        .filter(spec => [...(spec.mandatory ?? []), ...(spec.optional ?? [])].some(p => p.rest))
        .map(spec => spec.name).sort()
    check("every free-text command takes a sentence", sentences,
        ["broadcast", "emote", "guestlist", "maintenance", "me", "msg", "mute", "nick", "pm", "r", "sudo"])
    check("/broadcast kept its seven words", paramsOf(defOf("broadcast")).length, 8)
}

console.log("\n— a typed selector reaches the handler as entities —")
// For the commands that opted out of the list: handlers were written against
// expanded selectors and must not have to change.
{
    // `me` — the word that has to work for somebody who has never typed an @.
    typedSaw.length = 0
    __test.invoke(full("__probe"), me, "me")
    check("the handler was called", typedSaw.length, 1)
    check("and got ENTITIES, not the word", Array.isArray(typedSaw[0][0]), true)
    check("which is the player who typed it", typedSaw[0][0][0]?.id, me.id)

    typedSaw.length = 0
    __test.invoke(full("__probe"), me, "@s")
    check("@s resolves instead of being refused", typedSaw[0]?.[0]?.[0]?.id, me.id)

    typedSaw.length = 0
    __test.invoke(full("__probe"), me, "Vanisher")
    check("a literal name still works, as it always did", typedSaw[0]?.[0]?.[0]?.id, me.id)

    // An absent optional stays undefined: "no argument" is how /gm means "me",
    // and an empty array would read as "matched nobody".
    typedSaw.length = 0
    __test.invoke(full("__probe"), me, "me", undefined)
    check("an optional left off stays undefined", typedSaw[0]?.[1], undefined)

    // A target that matches nobody is refused BY THE REGISTRY, and the handler
    // never runs — it would otherwise act on an empty list and report success.
    typedSaw.length = 0
    const refused = __test.invoke(full("__probe"), me, "NobodyByThatName")
    check("an unmatched target is refused", refused?.status !== undefined, true)
    check("the handler never ran for it", typedSaw.length, 0)
    check("and the refusal points at the words that do work",
        String(refused?.message ?? "").includes("me"), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
