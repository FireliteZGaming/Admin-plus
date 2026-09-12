import { CustomCommandParamType, __test } from "@minecraft/server"
import { resolveSelector, SELECTOR_HELP, SELECTOR_HINT } from "../Admin+ BP/scripts/core/selector.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { COMMANDS, ENUMS, SELECTOR_TYPES, CODENAME, codenameFor, GAME_OWNED } from "../Admin+ BP/scripts/core/vanillaparams.js"
import { buildLine, tempTag } from "../Admin+ BP/scripts/features/vanillacmds.js"
import { DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { OP_COMMANDS } from "../Admin+ BP/scripts/core/opcommands.js"
import { commandSpecs } from "../Admin+ BP/scripts/core/registry.js"
import { readFileSync, readdirSync } from "node:fs"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const P = CustomCommandParamType

// Compared against the OFFERED list rather than the shipped whitelist, which is
// now empty on purpose. Registration happens in beforeEvents.startup, and world
// storage cannot be read that early — so every command this pack can ever allow
// must be registered up front, and each one refuses at RUN time until an owner
// turns it on in Settings ▸ Op commands.
const offered = [...OP_COMMANDS]

console.log("\n— every offered command has a typed registration —")
// The two lists are the same thing written twice, and they drift silently: a
// command the screen offers with no row cannot be typed at all, and a row the
// screen never offers registers a command nobody can ever switch on. Both look
// like "it just doesn't work" from inside the game.
const names = COMMANDS.map(c => c.name)
check("a row for every command the screen offers", offered.filter(c => !names.includes(c)), [])
check("and nothing registered the screen cannot switch on", names.filter(n => !offered.includes(n)), [])
check("no command is registered twice", names.length, new Set(names).size)

console.log("\n— shapes Bedrock will actually accept —")
// Over eight parameters and the registration is REFUSED WHOLE, with only a line
// in the content log. /broadcast shipped broken exactly that way once.
check("none asks for more than eight parameters",
    COMMANDS.filter(c => (c.params ?? []).length > 8).map(c => c.name), [])
// Mandatory parameters must all come before optional ones; the registry builds
// two separate lists and a row interleaving them would silently reorder the
// arguments.
check("no row puts a mandatory parameter after an optional one",
    COMMANDS.filter(c => {
        const flags = (c.params ?? []).map(p => !!p[2])
        return flags.indexOf(true) !== -1 && flags.lastIndexOf(false) > flags.indexOf(true)
    }).map(c => c.name), [])
check("every row has a help line", COMMANDS.filter(c => !c.help).map(c => c.name), [])
check("every parameter names a real type",
    COMMANDS.flatMap(c => (c.params ?? []).filter(p => p[1] === undefined).map(() => c.name)), [])

console.log("\n— enum parameters point at a real vocabulary —")
// Bedrock links an Enum parameter to its values BY NAME. A row naming an enum
// that was never registered produces a parameter that offers nothing and
// accepts nothing, and says so nowhere.
check("every Enum parameter names a registered enum",
    COMMANDS.flatMap(c => (c.params ?? [])
        .filter(p => p[1] === P.Enum && !(p[3] in ENUMS))
        .map(p => `${c.name}:${p[3]}`)), [])
check("and no non-Enum parameter claims one",
    COMMANDS.flatMap(c => (c.params ?? [])
        .filter(p => p[1] !== P.Enum && p[3])
        .map(p => `${c.name}:${p[3]}`)), [])
check("every enum has values", Object.entries(ENUMS).filter(([, v]) => !v.length).map(([k]) => k), [])
// ...and every enum is USED. The registration loop registers all of them with
// Bedrock, so one no parameter names is a registration that offers nothing —
// the same "a node exists only if the code checks it" rule the rest of the pack
// follows. `timeset` and `riderule` were both sitting here doing exactly that:
// riderule went dead when /mount's optional pair was corrected, and timeset
// never worked because `/time set` takes a number OR a word and a parameter
// cannot be both.
{
    const named = new Set(COMMANDS.flatMap(c => (c.params ?? []).map(p => p[3]).filter(Boolean)))
    check("no enum is defined without a parameter naming it",
        Object.keys(ENUMS).filter(k => !named.has(k)), [])
}
check("every enum value is a bare identifier",
    Object.entries(ENUMS).flatMap(([k, v]) => v.filter(x => !/^[a-z_0-9]+$/.test(x)).map(x => `${k}:${x}`)), [])

console.log("\n— the commands that made this necessary —")
check("kill takes an entity selector",
    COMMANDS.find(c => c.name === "kill").params[0][1], P.EntitySelector)
check("give takes a player, an item and a count",
    COMMANDS.find(c => c.name === "give").params.map(p => p[1]),
    [P.PlayerSelector, P.ItemType, P.Integer, P.Integer])
check("setblock takes a position and a block",
    COMMANDS.find(c => c.name === "setblock").params.slice(0, 2).map(p => p[1]),
    [P.Location, P.BlockType])
check("summon takes an entity type",
    COMMANDS.find(c => c.name === "summon").params[0][1], P.EntityType)

console.log("\n— rebuilding the command line —")
const spec = { name: "kill", params: [["targets", P.EntitySelector, true]] }

// A selector arrives as TEXT and is pasted straight through, because the engine
// expands a custom command's selector argument at the CALLER's permission level
// — so `/a:zkill @p` was refused with "insufficient permissions for selector
// expansion" before this code ever ran, for exactly the people /a:z* exists for.
// The dimension expands it instead, at operator level, when the command runs.
{
    check("a selector is pasted through as typed",
        buildLine(spec, ["@p"], "T1", []), "kill @p")
    check("filters and all", buildLine(spec, ["@e[type=cow,r=5]"], "T1", []),
        "kill @e[type=cow,r=5]")
    check("and it is never quoted, because a quoted selector is a NAME",
        buildLine(spec, ['"@e[type=cow, r=5]"'], "T1", []), "kill @e[type=cow, r=5]")
}

// The registration has to agree, or the engine resolves it before this file
// gets a say. This is the whole fix, and it is one word.
const vanillaSrc = readFileSync(
    new URL("../Admin+ BP/scripts/features/vanillacmds.js", import.meta.url), "utf8")
check("the table still marks selectors, so render() can find them",
    COMMANDS.flatMap(c => (c.params ?? []).filter(p => SELECTOR_TYPES.has(p[1]))).length > 0,
    true)
// Selectors keep their REAL type, which is what makes the game offer
// `@a @e @p @r @s` and every filter as you type. 2.1.13 downgraded them to
// String to dodge a permission error and that traded the picker for a blank
// text box — useless to anyone who does not already know selector syntax, which
// is most of the audience for a command set aimed at people without operator.
// /gm has always used a real PlayerSelector and works, which is why this went
// back.
// Comment lines stripped first. The file keeps the old downgrade written out
// in a comment as the one-line way back if the permission error ever returns,
// and a raw substring match found its own escape hatch and called it live code.
const vanillaCode = vanillaSrc.split("\n")
    .filter(line => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n")
// Selectors are registered as String and resolved by US, through the script
// API. Not a preference — a parameter registered as EntitySelector is expanded
// by the ENGINE at the command's declared permission level, which is `Any`, and
// every `@` form is refused there. `/slay @e[family=monster]`,
// `/gift @p iron_leggings` and `/ench @p` all failed that way, with a BARE
// error carrying no `[Admin+]` prefix — proof it happened before this file's
// handler ran, so nothing downstream could have helped.
// Asked of the REGISTRATIONS rather than of the source text, because the source
// can be rearranged without changing what gets registered — and it was, when the
// selector parameters picked up their name hint.
{
    const rows = new Map(COMMANDS.map(c => [codenameFor(c.name), c]))
    const built = commandSpecs().filter(spec => rows.has(spec.name))
    check("every command in the table is registered", built.length, COMMANDS.length)

    const selectorParams = built.flatMap(spec => {
        const params = rows.get(spec.name).params ?? []
        const all = [...(spec.mandatory ?? []), ...(spec.optional ?? [])]
        return params
            .map((p, i) => SELECTOR_TYPES.has(p[1]) ? { cmd: spec.name, was: p[0], got: all[i] } : null)
            .filter(Boolean)
    })
    check("there are selector parameters to check", selectorParams.length > 0, true)
    check("the registration downgrades every one of them to String",
        selectorParams.filter(p => p.got?.type !== P.String).map(p => `${p.cmd}:${p.was}`), [])
    // And carries the hint in the name, which is the only part still on screen
    // once the description has scrolled away.
    check("and each one says what it takes",
        selectorParams.filter(p => p.got?.name !== `${p.was}_or_me`).map(p => `${p.cmd}:${p.was}`), [])
}
check("and the handler resolves the text itself",
    vanillaCode.includes("resolveSelector(resolved[i], player"), true)
check("the entity-tagging path survives for what comes back",
    vanillaCode.includes("[tag=${tag}]"), true)
check("and the selector head still depends on the parameter type",
    vanillaCode.includes('type === P.PlayerSelector ? "@a" : "@e"'), true)

console.log("\n— a player parameter gets @a, an entity parameter gets @e —")
{
    // Vanilla checks a selector's TYPE syntactically, not what it resolves to.
    // A player-typed argument handed `@e[tag=…]` is refused with
    //     Error occurred with parsing command params: Selector must be player-type
    // even when every tagged entity IS a player. Reported from a live world:
    // /ench went through and /gift did not, and the only difference was that
    // one of them checks.
    const ent = n => ({ name: n, addTag: () => {}, removeTag: () => {} })
    const line = (name, args) =>
        buildLine(COMMANDS.find(c => c.name === name), args, "T", [])

    // ONE player is written as a NAME, which is not a selector at all, so the
    // game never expands it — and expansion is the thing that gets refused.
    // Confirmed live: `/exp 100` worked and `/exp 100 <name>` did not, and the
    // only difference was a selector in the rebuilt line.
    check("one player becomes a quoted name, no selector",
        line("xp", [100, [ent("FireliteZGaming")]]), 'xp 100 "FireliteZGaming"')
    check("a gamertag with spaces survives as one argument",
        line("xp", [5, [ent("Big Red Dog")]]), 'xp 5 "Big Red Dog"')
    check("give too", line("give", [[ent("p")], { id: "minecraft:chainmail_boots" }]),
        'give "p" minecraft:chainmail_boots')
    check("several players fall back to @a, never @e",
        line("give", [[ent("a"), ent("b")], { id: "minecraft:stone" }]),
        "give @a[tag=T_0] minecraft:stone")
    check("kill takes any entity, so @e",
        line("kill", [[ent("c")]]), "kill @e[tag=T_0]")

    // ...but an entity argument does not actually GO that way any more. The
    // dimension refuses to expand `@e` at all — `/slay @e[family=monster]` came
    // back "insufficient permissions for selector expansion" — so the slot
    // becomes `@s` and the command is run ON each resolved entity instead.
    // `@s` names the executor and expands nothing.
    const self = (name, args, at) =>
        buildLine(COMMANDS.find(c => c.name === name), args, "T", [], at)
    check("an entity argument becomes @s when run per entity",
        self("kill", [[ent("m1"), ent("m2")]], 0), "kill @s")
    check("and the rest of the line is untouched",
        self("effect", [[ent("m")], "speed", 30], 0), "effect @s speed 30")
    check("an empty set still stops the line",
        self("kill", [[]], 0), "kill")

    // The sweep that matters: 21 player parameters were ALL emitting @e.
    const offenders = []
    for (const c of COMMANDS) {
        const params = c.params ?? []
        const args = params.map(p => SELECTOR_TYPES.has(p[1]) ? [ent("x")]
            : p[3] ? ENUMS[p[3]][0]
            : p[1] === P.Location ? { x: 0, y: 0, z: 0 }
            : (p[1] === P.ItemType || p[1] === P.BlockType || p[1] === P.EntityType)
                ? { id: "minecraft:stone" }
            : p[1] === P.Boolean ? true
            : (p[1] === P.Integer || p[1] === P.Float) ? 1 : "w")
        const built = buildLine(c, args, "T", [])
        params.forEach((p, i) => {
            if (p[1] === P.PlayerSelector && built.includes(`@e[tag=T_${i}`)) {
                offenders.push(`${c.name}.${p[0]}`)
            }
        })
    }
    check("no player parameter anywhere emits @e", offenders, [])
}

console.log("\n— two selectors in one command must not share a tag —")
{
    // /mount and /dialog each take TWO selectors. With one tag for the whole
    // line, `/mount <cow> start_riding <steve>` came out as
    //     ride @e[tag=T] start_riding @e[tag=T]
    // which sits both sets on themselves. Caught by a second look before it
    // shipped; the suffix is what keeps the two sides apart.
    //
    // /move was the original example here and no longer qualifies: it took over
    // the COORDINATE overload when `tp` was dropped in 2.1.23, so its second
    // argument is a position now. /mount stands in, and the covered list below
    // is what catches a third command growing a second selector.
    const marks = []
    const ent = n => ({ name: n, addTag: t => marks.push(`${n}:${t}`), removeTag: () => {} })
    const mount = COMMANDS.find(c => c.name === "ride")
    const cleanup = []
    check("each selector parameter gets its own tag",
        buildLine(mount, [[ent("cow")], "start_riding", [ent("steve")]], "T", cleanup),
        "ride @e[tag=T_0] start_riding @e[tag=T_2]")
    check("and the two sets really are tagged differently",
        marks, ["cow:T_0", "steve:T_2"])

    // Cleanup has to know WHICH tag each entity got, or the first set is
    // stripped and the second wears theirs for good.
    check("cleanup carries the tag with the entity",
        cleanup.map(c => `${c.entity.name}:${c.tag}`), ["cow:T_0", "steve:T_2"])
    check("every command taking two selectors is covered",
        COMMANDS.filter(c => (c.params ?? []).filter(p => SELECTOR_TYPES.has(p[1])).length > 1)
            .map(c => c.name).sort(),
        ["dialogue", "ride"])
}

check("an empty selector result is treated as absent",
    buildLine(spec, [[]], "T2", []), "kill")
check("so is a missing optional", buildLine(spec, [undefined], "T3", []), "kill")

{
    const s = { name: "setblock", params: [["position", P.Location], ["block", P.BlockType],
                                           ["mode", P.Enum, true, "setblockmode"]] }
    check("a location becomes three numbers",
        buildLine(s, [{ x: 1, y: -60, z: 3 }, { id: "minecraft:stone" }, "keep"], "T", []),
        "setblock 1 -60 3 minecraft:stone keep")
    check("a block type is written by id",
        buildLine(s, [{ x: 0, y: 0, z: 0 }, { id: "minecraft:dirt" }], "T", []),
        "setblock 0 0 0 minecraft:dirt")
}

{
    const s = { name: "give", params: [["players", P.PlayerSelector], ["item", P.ItemType],
                                       ["amount", P.Integer, true]] }
    check("an item type is written by id, and a count follows",
        buildLine(s, ["@s", { id: "minecraft:diamond" }, 5], "T", []),
        "give @s minecraft:diamond 5")
}

{
    const s = { name: "daylock", params: [["locked", P.Boolean, true]] }
    check("a boolean is written as a word", buildLine(s, [true], "T", []), "daylock true")
    check("including false, which is not the same as absent",
        buildLine(s, [false], "T", []), "daylock false")
}

{
    // Was written against `say`, which is no longer a passthrough — /broadcast
    // does the same job with an audience and an audit record. `tellraw` carries
    // the same String-with-spaces shape, which is all this is testing.
    const s = { name: "tellraw", params: [["players", P.String], ["json", P.String]] }
    check("a plain word needs no quoting",
        buildLine(s, ["@a", "hello"], "T", []), "tellraw @a hello")
    check("but a value with spaces is quoted, or it becomes two arguments",
        buildLine(s, ["@a", "hello there"], "T", []), 'tellraw @a "hello there"')
}

console.log("\n— fixed words the caller should not have to type —")
{
    // /replaceitem's grammar is `replaceitem entity <target> …`, where the
    // second word picks between two overloads rather than carrying anything the
    // caller supplies. It has to reach the game, and it must NOT be a parameter
    // — that would offer a choice with one valid answer.
    const real = COMMANDS.find(c => c.name === "replaceitem")
    check("replaceitem carries a fixed word", real.fixed, ["entity"])
    check("which lands straight after the command name",
        buildLine(real, ["@s", "slot.armor.head", 0, "destroy",
                         { id: "minecraft:diamond_helmet" }], "T", []),
        "replaceitem entity @s slot.armor.head 0 destroy minecraft:diamond_helmet")
    check("and a row without one is untouched",
        buildLine({ name: "kill", params: [["t", P.String, true]] }, ["@e"], "T", []),
        "kill @e")

    // The slot names are why slotType is a String. Every one carries dots, and
    // an enum value that is not a bare identifier makes Bedrock refuse the
    // whole registration without saying so.
    const slotType = real.params.find(p => p[0] === "slotType")
    check("slotType is a String, never an Enum", slotType[1], P.String)
    check("because a real slot name would be stripped by the enum filter",
        /^[a-z_0-9]+$/.test("slot.armor.head"), false)
}

// Optional parameters are positional, so a gap cannot legitimately happen —
// stopping at the first absent one is what keeps a malformed line from being
// assembled if that ever changed.
{
    const s = { name: "effect", params: [["targets", P.EntitySelector], ["effect", P.Enum, false, "effect"],
                                         ["seconds", P.Integer, true], ["amplifier", P.Integer, true]] }
    check("building stops at the first absent argument",
        buildLine(s, ["@s", "speed", undefined, 3], "T", []), "effect @s speed")
}

console.log("\n— a count written in prose goes stale silently —")
// vanillaparams.js, vanillacmds.js and verify.py all said "56" for the whole
// life of a 55-row table. When `tp` was dropped, that stale number was read
// back as if it were the truth and the correction landed one short — a wrong
// comment is worse than no comment, because it gets quoted. So every count
// stated in the prose is checked against the table it describes.
{
    const counted = ["../Admin+ BP/scripts/core/vanillaparams.js",
                     "../Admin+ BP/scripts/features/vanillacmds.js",
                     "../tools/verify.py",
                     "./vanillacmds.test.js"]
    const pattern = /\b(?:all|the) (\d{2})(?= (?:below|of these|vanilla passthroughs|this file|interleave|got renamed|is renamed|share the list))/gi
    const stale = []
    for (const path of counted) {
        const text = readFileSync(new URL(path, import.meta.url), "utf8")
        for (const m of text.matchAll(pattern)) {
            if (Number(m[1]) !== COMMANDS.length) stale.push(`${path}: "${m[0]}"`)
        }
    }
    check("no comment states a stale command count", stale, [])
}

console.log("\n— one namespace, so the grouping is in the name —")
// A pack gets exactly ONE command namespace. Registering these under `cmd:` was
// tried and refused twice: registerEnum would not take a second namespace, and
// commands carrying no enums at all were refused with the same error. So all 54
// share the list with the pack's own commands, and the only lever on where they
// appear is the name, because the in-game list is sorted alphabetically.
// Our own command names, read out of the source the way tools/verify.py does.
// Importing main.js would run every installer and need a whole game around it;
// this needs only the names.
const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
const ours = readdirSync(dir)
    .filter(f => f.endsWith(".js") && f !== "vanillacmds.js")
    .flatMap(f => [...readFileSync(new URL(f, dir), "utf8")
        .matchAll(/command\(\{[^}]*?name:\s*"([a-z0-9_]+)"/gs)].map(m => m[1]))
    .concat(["admin", "tp"])              // registered in main.js
// Built with the REAL codenameFor, not by restating the naming rule here. The
// version of this block that this replaced did `COMMANDS.map(c => \`z${c.name}\`)`
// — it wrote down its own expectation and then agreed with itself, so when the
// z prefix was removed in 2.1.15 every assertion below still passed while
// testing nothing at all. If the naming changes again, this has to notice.
const vanilla = COMMANDS.map(c => codenameFor(c.name))
check("our own commands were found", ours.length > 30, true)
check("every vanilla command has a registered name", vanilla.filter(n => !n), [])

// The two properties that actually matter, now that sort order is not one.
// A duplicate name means one registration silently loses to the other, and
// Bedrock will not say which.
check("no two vanilla commands register the same name",
    vanilla.filter((n, i) => vanilla.indexOf(n) !== i), [])
check("nothing collides with a command we already own",
    vanilla.filter(n => ours.includes(n)), [])

// CODENAME may only rename commands that exist. A typo'd key would sit there
// doing nothing, and the command would quietly keep its vanilla name.
const realNames = new Set(COMMANDS.map(c => c.name))
check("every CODENAME key is a real vanilla command",
    [...CODENAME.keys()].filter(k => !realNames.has(k)), [])

// THE ONE THAT MATTERS. Bedrock resolves the bare `/slay` to this pack only
// while nothing else claims that word; if a registration is named `kill`, then
// `/kill` reaches the GAME's and this pack's is stranded at `/a:kill`. That is
// not just three extra keystrokes — the audience for these commands holds a
// rank and NO operator, and vanilla's kill refuses them outright. So a name
// the game owns makes the command unreachable by the short path for exactly
// the people it was built for.
check("no codename is a name the game already owns",
    vanilla.filter(n => GAME_OWNED.has(n)), [])
check("so every one of the 54 got renamed, not just the long ones",
    COMMANDS.filter(c => !CODENAME.has(c.name)).map(c => c.name), [])

// The renames that had to happen, as opposed to the ones that were taste.
check("gamemode does not shadow our own /gm", codenameFor("gamemode"), "gmode")
check("testfor reads as what it does", codenameFor("testfor"), "count")
check("kill could not stay kill", codenameFor("kill"), "slay")
check("nor fill stay fill", codenameFor("fill"), "region")
check("music shortens rather than needing a synonym", codenameFor("music"), "mus")
// /a:tp is ours. Vanilla's `tp` used to be a passthrough here under the
// codename `port`; 2.1.23 dropped it — `teleport` carries the whole grammar —
// and `port` is a pack command now, the one that hands over the Ender Eye.
check("our own tp survives", ours.includes("tp"), true)
check("vanilla tp is no longer registered", COMMANDS.some(c => c.name === "tp"), false)
check("but the game still owns the name", GAME_OWNED.has("tp"), true)
check("and port is ours, not a codename", [...CODENAME.values()].includes("port"), false)
check("port is a pack command", ours.includes("port"), true)

console.log("\n— the tag has to be unique —")
// Two commands resolving at once must not pick up each other's entities.
const tags = new Set()
for (let i = 0; i < 500; i++) tags.add(tempTag())
check("500 tags, 500 distinct", tags.size, 500)
check("and none of them could be a player's own tag",
    [...tags].every(t => t.startsWith("apcmd_")), true)


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
    const src = readFileSync("Admin+ BP/scripts/features/vanillacmds.js", "utf8")
    check("selector parameters are renamed so the hint is on screen",
        src.includes("`${name}_or_me`"), true)
    check("/tp carries it too",
        readFileSync("Admin+ BP/scripts/main.js", "utf8").includes("target_or_me"), true)
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
            .filter(f => f.endsWith(".js") && f !== "vanillacmds.js")
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
    // The standing count. When this fails because it went DOWN, delete the name
    // from the list and lower the number; that is the fix landing.
    check("the rest are known, counted, and still to do",
        exposed.sort(),
        ["enderchest.js:1", "gamemode.js:2", "grant.js:1", "invsee.js:1",
         "modcommands.js:3", "nick.js:1", "privatechat.js:5", "reports.js:1",
         "staffmode.js:1", "sudo.js:1", "tpa.js:2", "troll.js:1", "vanish.js:1",
         "warn.js:2"])
}


console.log("\n— the pack's OWN names, checked against the ones the game owns —")
// The 54 passthroughs were renamed so their bare form reaches ours. The pack's
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
    check("nor does any passthrough codename claim one",
        ["port", "items"].filter(n => [...CODENAME.values()].includes(n)), [])
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
