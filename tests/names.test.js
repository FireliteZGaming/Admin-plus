import { __test } from "@minecraft/server"
import { resolveSelector, SELECTOR_HELP, SELECTOR_HINT } from "../Admin+ BP/scripts/core/selector.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { GAME_OWNED } from "../Admin+ BP/scripts/core/gameowned.js"
import { readFileSync, readdirSync } from "node:fs"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// Names: what a player types to mean somebody, and which command names the
// game already owns. Moved here from the vanilla wrapper test when the
// wrappers went in 2.8.4; the resolver and the names are still in use.

const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
const ours = readdirSync(dir)
    .filter(f => f.endsWith(".js"))
    .flatMap(f => [...readFileSync(new URL(f, dir), "utf8")
        .matchAll(/command\(\{[^}]*?name:\s*"([a-z0-9_]+)"/gs)].map(m => m[1]))
    .concat(["admin", "tp"])              // registered in main.js
// Built with the REAL codenameFor, not by restating the naming rule here. The
// version of this block that this replaced did `COMMANDS.map(c => \`z${c.name}\`)`
// — it wrote down its own expectation and then agreed with itself, so when the
// z prefix was removed in 2.1.15 every assertion below still passed while
// testing nothing at all. If the naming changes again, this has to notice.

console.log("\n— time and weather have names of their own —")
check("our own commands were found", ours.length > 30, true)
check("/clock and /sky are pack commands", ["clock", "sky"].filter(n => ours.includes(n)), ["clock", "sky"])
check("and the game owns neither", ["clock", "sky"].filter(n => GAME_OWNED.has(n)), [])
check("the game still owns time and weather themselves", ["time", "weather"].filter(n => GAME_OWNED.has(n)), ["time", "weather"])
check("and every name Admin+ used to wrap",
    ["kill", "give", "fill", "summon", "effect", "gamemode", "teleport", "tp"].filter(n => !GAME_OWNED.has(n)), [])

console.log("\n— a name is whatever is on the screen, nickname included —")
// Admin+ shows a nicknamed player as their nickname everywhere: the list, the
// nametag, chat. That is the name staff read off the screen and type back in,
// so matching only the gamertag answered "nobody here is called Starlight"
// about somebody standing in front of them wearing exactly that name.
{
    const players = __test.players
    const before = players.length
    const make = (id, name) => ({
        id, name, typeId: "minecraft:player",
        getTags: () => [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension
    })
    const cass = make("p-cass", "CassRunner")
    const dana = make("p-dana", "DanaBuilds")
    players.push(cass, dana)
    setNickname(cass, "§dStarlight")

    check("the gamertag still resolves",
        resolveSelector("CassRunner", cass, true).entities.map(p => p.id), ["p-cass"])
    check("and so does the nickname now",
        resolveSelector("Starlight", cass, true).entities.map(p => p.id), ["p-cass"])
    check("case does not matter",
        resolveSelector("starLIGHT", cass, true).entities.map(p => p.id), ["p-cass"])
    // The codes are not something anybody can type, and the plain form is what
    // was on screen.
    check("the formatting codes are not part of the name",
        resolveSelector("§dStarlight", cass, true).ok, false)

    // The gamertag wins when both could match: it is the name that cannot be
    // changed by the person answering to it, so a moderator typing a gamertag
    // they looked up must never reach somebody else.
    setNickname(dana, "CassRunner")
    check("a nickname cannot steal somebody else's gamertag",
        resolveSelector("CassRunner", cass, true).entities.map(p => p.id), ["p-cass"])

    check("and an unknown name says it looked at both",
        resolveSelector("Nobody", cass, true).reason.includes("nicknamed"), true)

    setNickname(cass, "")
    setNickname(dana, "")
    players.length = before
}


console.log("\n— a word anybody can guess, where a selector used to be offered —")
// The engine no longer offers `@a @e @p @r @s` as you type — it expands
// selectors at the command's permission level and refuses all five at `Any`,
// which is where this pack has to register. So the target box is blank, and a
// playtest report put it plainly: nobody would know how to use /eff at all.
//
// These words are the answer, and each one is exactly one selector written out
// — no new behaviour to explain, and `@s` still works for whoever already knew
// it.
{
    const players = __test.players
    const before = players.length
    const make = (id, name) => ({
        id, name, typeId: "minecraft:player",
        getTags: () => [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension
    })
    const cass = make("p-cass", "CassRunner")
    const dana = make("p-dana", "DanaBuilds")
    players.push(cass, dana)

    check("me is you", resolveSelector("me", cass).entities.map(p => p.id), ["p-cass"])
    check("and so are self and myself",
        ["self", "myself"].map(w => resolveSelector(w, cass).entities.length), [1, 1])
    check("everyone is every player",
        resolveSelector("everyone", cass).entities.map(p => p.id).sort(), ["p-cass", "p-dana"])
    check("all says the same thing",
        resolveSelector("all", cass).entities.length, 2)
    check("nearest picks one", resolveSelector("nearest", cass).entities.length, 1)
    check("random picks one", resolveSelector("random", cass).entities.length, 1)
    // `mobs` is `@e`, which is every entity including players. The word is a
    // small lie and a deliberate one — it is what people reach for.
    check("mobs reaches entities, not only players",
        resolveSelector("mobs", cass).ok, true)
    // Capitals are how a person actually types a word at the start of an
    // argument, so this is not a nicety.
    check("case does not matter", resolveSelector("ME", cass).entities.map(p => p.id), ["p-cass"])

    // The words BEAT a player carrying one, on purpose: `me` has to mean me
    // every time or it is not worth teaching. `me` itself cannot collide at all
    // — a gamertag is at least three characters — but `random` can.
    players.push(make("p-troll", "Random"))
    check("a player named Random does not steal the word",
        resolveSelector("random", cass).entities.length, 1)
    check("and they are still reachable the long way",
        resolveSelector("@a[name=Random]", cass, true).entities.map(p => p.id), ["p-troll"])

    // Getting it wrong has to teach, because a blank box plus a bare refusal is
    // the state this whole change exists to leave.
    check("an unknown name points at the words",
        resolveSelector("Nobody", cass, true).reason.includes("me"), true)
    check("so does a selector that is not one",
        resolveSelector("@x", cass).reason.includes("everyone"), true)
    check("and so does an empty target",
        resolveSelector("", cass).reason.includes("nearest"), true)

    players.length = before
}

console.log("\n— the two surfaces that can still say it —")
// A description is read while you are PICKING the command and gone by the time
// you are filling it in; the parameter name is what stays on screen. Both had
// to change, so both are pinned.
{
    check("the help leads with the plain words, not the @ forms",
        SELECTOR_HELP.indexOf("me") < SELECTOR_HELP.indexOf("@"), true)
    check("and names every word the resolver accepts",
        ["me", "everyone", "nearest", "random", "mobs"].filter(w => !SELECTOR_HELP.includes(w)), [])
    // No § codes: this goes into a registration, not into chat.
    check("no formatting codes in a registration string",
        SELECTOR_HELP.includes("§"), false)
    check("the chat hint is the one that IS formatted",
        SELECTOR_HINT.includes("§f"), true)

    // The suffix is the only thing a person sees while typing the argument.
    const src = readFileSync("Admin+ BP/scripts/core/registry.js", "utf8")
    check("selector parameters are renamed so the hint is on screen",
        src.includes("`${name}_or_me`") && src.includes("`${name}_me_or_all`"), true)
    check("/tp carries it too, in the required form",
        readFileSync("Admin+ BP/scripts/main.js", "utf8").includes("target_me_or_all"), true)
}

console.log("\n— how many commands still ask the engine to expand a selector —")
// Every command in this pack registers at CommandPermissionLevel.Any — the
// pack's own and the 54 passthroughs alike, see core/registry.js — and the
// engine refuses to expand ANY `@` form at that level, before the handler runs.
// So a PlayerSelector or EntitySelector parameter on a registration is a
// parameter that works for a typed name and refuses `@p`.
//
// The passthroughs were fixed in 2.1.21 and /a:tp in 2.2.2. The rest were found
// at the same time as /a:tp and are NOT fixed. This counts them rather than
// listing them as prose, so the number goes down as they are converted and
// nobody has to remember the list.
//
// **Lowering this number means fixing a command. Raising it means somebody
// wrote a new one with the broken shape.** Either way the test should be
// touched deliberately.
{
    const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
    const sources = [
        ...readdirSync(dir)
            .filter(f => f.endsWith(".js"))
            .map(f => [f, readFileSync(new URL(f, dir), "utf8")]),
        ["main.js", readFileSync(new URL("../Admin+ BP/scripts/main.js", import.meta.url), "utf8")]
    ]

    const exposed = []
    for (const [file, text] of sources) {
        // Comment lines describe the problem; they are not the problem.
        const code = text.split("\n").filter(l => !l.trim().startsWith("//")).join("\n")
        const count = [...code.matchAll(/CustomCommandParamType\.(Player|Entity)Selector/g)].length
        if (count) exposed.push(`${file}:${count}`)
    }

    check("main.js no longer declares one — /a:tp was converted",
        exposed.filter(e => e.startsWith("main.js")), [])
    // A per-file count of the rest used to stand here, to catch a raw selector
    // arriving WITHOUT the player list. Since 2.7.8 the list is the registry's
    // default, so that cannot happen by omission, and tests/registry.test.js
    // checks every selector parameter against what the ENGINE was given.
    check("the pack's own commands do still name players, so that guard has work to do",
        exposed.length > 0, true)
}


console.log("\n— the pack's OWN names, checked against the ones the game owns —")
// The vanilla passthroughs were renamed so their bare form reaches ours. The pack's
// own commands were never put through the same check, and the ENGINE has been
// saying so at every load for months:
//
//   Custom Command alias [tp]  already in use. Required to use full name [a:tp].
//   Custom Command alias [msg] already in use.
//   Custom Command alias [me]  already in use.
//
// This matters because **the audience holds a rank and not operator.** The
// consequence is different for each, and the difference is the whole point:
//
//   tp   vanilla's needs operator, so for a ranked non-op /tp does NOTHING.
//        Fatal, not slow.
//   msg  vanilla's /msg works for everybody — so it silently SUCCEEDS while
//        bypassing this pack's version: no socialspy, no chat log, and a muted
//        player still gets their message out.
//   me   same shape, lower stakes.
//
// Pinned as the known three rather than as "none", because asserting none would
// have to fail today. When one is renamed, take it off this list.
{
    const shadowed = ours.filter(name => GAME_OWNED.has(name)).sort()
    check("exactly the three the engine names, and no new ones",
        shadowed, ["me", "msg", "tp"])

    // Each has a sibling that is NOT game-owned and therefore works bare for a
    // non-op. `tp` is the one that does not, which is why it is the urgent one.
    check("me has a working bare alternative", ours.includes("emote"), true)
    // /msg's own description says "bare /msg is vanilla's" — that one was a
    // known, written-down choice with /pm as the way through. /tp was not.
    check("msg has one, and its description already admits the problem",
        ours.includes("pm"), true)
    // tp's answer is not another command name — it is the ENDER EYE. /port
    // hands one over and the eye opens a menu of who to jump to, so the person
    // who cannot type /tp never needed a name to type. That only holds while
    // BOTH doors are reachable by a non-op, which is what these pin: a
    // game-owned name would send them to vanilla exactly as /tp does.
    check("the eye's doors are pack commands",
        ["port", "items"].filter(n => ours.includes(n)), ["port", "items"])
    check("and the game owns neither of them",
        ["port", "items"].filter(n => GAME_OWNED.has(n)), [])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
