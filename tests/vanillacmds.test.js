import { CustomCommandParamType } from "@minecraft/server"
import { COMMANDS, ENUMS, SELECTOR_TYPES } from "../Admin+ BP/scripts/core/vanillaparams.js"
import { buildLine, tempTag } from "../Admin+ BP/scripts/features/vanillacmds.js"
import { DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { readFileSync, readdirSync } from "node:fs"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const P = CustomCommandParamType
const shipped = String(DEFAULTS["commands.allowed"].value)
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)

console.log("\n— every allowed command has a typed registration —")
// The allowlist and the table are two lists of the same thing, and they drift
// silently: a command on the allowlist with no row cannot be typed at all, and
// a row that is not allowlisted registers a command that always refuses. Both
// look like "it just doesn't work" from inside the game.
const names = COMMANDS.map(c => c.name)
check("a row for every allowed command", shipped.filter(c => !names.includes(c)), [])
check("and nothing registered that is not allowed", names.filter(n => !shipped.includes(n)), [])
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

// A selector arrives RESOLVED, as Entity[], so the text that was typed is gone.
// Each entity is tagged instead and the line targets that tag — which also
// means the set is fixed at the moment the game resolved it.
{
    const tagged = []
    const entity = { addTag: t => tagged.push(t), removeTag: () => {} }
    const clean = []
    check("a selector becomes a tag lookup",
        buildLine(spec, [[entity]], "T1", clean), "kill @e[tag=T1]")
    check("and the entity really was tagged", tagged, ["T1"])
    check("so it can be untagged afterwards", clean.length, 1)
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
    const player = { addTag: () => {}, removeTag: () => {} }
    check("an item type is written by id, and a count follows",
        buildLine(s, [[player], { id: "minecraft:diamond" }, 5], "T", []),
        "give @e[tag=T] minecraft:diamond 5")
}

{
    const s = { name: "daylock", params: [["locked", P.Boolean, true]] }
    check("a boolean is written as a word", buildLine(s, [true], "T", []), "daylock true")
    check("including false, which is not the same as absent",
        buildLine(s, [false], "T", []), "daylock false")
}

{
    const s = { name: "say", params: [["message", P.String], ["more", P.String, true]] }
    check("a plain word needs no quoting", buildLine(s, ["hello"], "T", []), "say hello")
    check("but a value with spaces is quoted, or it becomes two arguments",
        buildLine(s, ["hello there"], "T", []), 'say "hello there"')
}

// Optional parameters are positional, so a gap cannot legitimately happen —
// stopping at the first absent one is what keeps a malformed line from being
// assembled if that ever changed.
{
    const s = { name: "effect", params: [["targets", P.EntitySelector], ["effect", P.Enum, false, "effect"],
                                         ["seconds", P.Integer, true], ["amplifier", P.Integer, true]] }
    const e = { addTag: () => {}, removeTag: () => {} }
    check("building stops at the first absent argument",
        buildLine(s, [[e], "speed", undefined, 3], "T", []), "effect @e[tag=T] speed")
}

console.log("\n— one namespace, so the grouping is in the name —")
// A pack gets exactly ONE command namespace. Registering these under `cmd:` was
// tried and refused twice: registerEnum would not take a second namespace, and
// commands carrying no enums at all were refused with the same error. So all 56
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
const vanilla = COMMANDS.map(c => `z${c.name}`)
check("our own commands were found", ours.length > 30, true)
check("every one is z-prefixed", vanilla.filter(n => !n.startsWith("z")), [])
check("and the bare vanilla name is what actually runs",
    vanilla.includes("zkill") && !vanilla.includes("kill"), true)

// The whole point of the z: our commands must all sort ABOVE them.
const lastOfOurs = [...ours].sort().pop()
check("every vanilla command sorts after every one of ours",
    vanilla.filter(n => n <= lastOfOurs), [])
check("nothing collides with a command we already own",
    vanilla.filter(n => ours.includes(n)), [])
// /a:tp is ours; vanilla has a tp too, and the prefix is what keeps them apart.
check("our own tp survives", ours.includes("tp"), true)
check("and vanilla's is ztp", vanilla.includes("ztp"), true)

console.log("\n— the tag has to be unique —")
// Two commands resolving at once must not pick up each other's entities.
const tags = new Set()
for (let i = 0; i < 500; i++) tags.add(tempTag())
check("500 tags, 500 distinct", tags.size, 500)
check("and none of them could be a player's own tag",
    [...tags].every(t => t.startsWith("apcmd_")), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
