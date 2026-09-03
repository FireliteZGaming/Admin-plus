import { __test } from "@minecraft/server"
import {
    list, get, save, remove, removeAll, render, board, sync, count,
    HOLOGRAM_TYPE, HOLOGRAM_TAG
} from "../Admin+ BP/scripts/core/holograms.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const AT = { dimension: "minecraft:overworld", x: 10, y: 64, z: -20 }

console.log("\n— placing text —")
const made = save("rules", { kind: "text", text: "§6Welcome\\n§7Be nice", ...AT })
check("it saves", made.ok, true)
check("the id is kept", made.holo.id, "rules")
check("and it is findable", get("rules").text, "§6Welcome\\n§7Be nice")
check("\\n becomes a real line break when rendered", render(get("rules")).split("\n").length, 2)

console.log("\n— ids are cleaned, not trusted —")
check("case is folded", save("RULES2", { kind: "text", text: "x", ...AT }).holo.id, "rules2")
check("spaces and punctuation go", save("my rules!", { kind: "text", text: "x", ...AT }).holo.id, "myrules")
check("an id with nothing usable is refused", save("!!!", { kind: "text", text: "x" }).ok, false)
check("and says why", /usable/.test(save("!!!", {}).reason), true)

console.log("\n— tokens —")
check("{ONLINE} counts players", render({ kind: "text", text: "{ONLINE} online" }), "0 online")
__test.players.push({ id: "p1", name: "A" }, { id: "p2", name: "B" })
check("and follows the count", render({ kind: "text", text: "{ONLINE} online" }), "2 online")

console.log("\n— a leaderboard reads the objective —")
__test.objectives.set("kills", {
    id: "kills",
    getScores: () => [
        { participant: { displayName: "Nova" }, score: 12 },
        { participant: { displayName: "Steve" }, score: 40 },
        { participant: { displayName: "Alex" }, score: 3 },
        { participant: { displayName: "Ghost" }, score: undefined }
    ]
})
const lb = { kind: "board", objective: "kills", title: "§6Top", format: "{INDEX}. {NAME} — {SCORE}", max: 10, ascending: false, ...AT }
check("highest first by default", board(lb), ["1. Steve — 40", "2. Nova — 12", "3. Alex — 3"])
check("a participant with no score is left off, not shown as zero",
    board(lb).some(l => l.includes("Ghost")), false)
check("the heading sits above the rows", render(lb).split("\n")[0], "§6Top")
check("and the rows follow", render(lb).split("\n").length, 4)

const asc = { ...lb, ascending: true }
check("lowest first when asked", board(asc)[0], "1. Alex — 3")

check("max caps the rows", board({ ...lb, max: 2 }).length, 2)
check("max is clamped to something sane", board({ ...lb, max: 0 }).length, 3)

console.log("\n— a leaderboard pointed at nothing says so —")
check("it does not crash", board({ ...lb, objective: "nope" }).length, 1)
check("it names the missing objective", /nope/.test(board({ ...lb, objective: "nope" })[0]), true)

console.log("\n— an empty objective is not an error —")
__test.objectives.set("empty", { id: "empty", getScores: () => [] })
check("it says nobody is on it yet", board({ ...lb, objective: "empty" }), ["§8nobody on the board yet"])

console.log("\n— the entities follow the records —")
__test.spawned.length = 0
removeAll()
save("one", { kind: "text", text: "first", ...AT })
save("two", { kind: "text", text: "second", ...AT })
sync()
check("one entity per record", __test.spawned.length, 2)
check("of our own type", __test.spawned.every(e => e.typeId === HOLOGRAM_TYPE), true)
check("each tagged with its id",
    __test.spawned.map(e => e.getTags()[0]).sort(),
    [`${HOLOGRAM_TAG}:one`, `${HOLOGRAM_TAG}:two`])
check("wearing the text as its name",
    __test.spawned.map(e => e.nameTag).sort(), ["first", "second"])

console.log("\n— sync is idempotent —")
sync(); sync()
check("running it again spawns no duplicates", __test.spawned.length, 2)

console.log("\n— it repairs itself —")
__test.spawned.length = 0            // something killed them
sync()
check("they come back", __test.spawned.length, 2)

console.log("\n— editing does not respawn anything —")
save("one", { text: "edited" })
sync()
check("still two entities", __test.spawned.length, 2)
check("with the new text", __test.spawned.some(e => e.nameTag === "edited"), true)
check("and the position was kept", get("one").x, AT.x)

console.log("\n— removing —")
remove("one")
sync()
check("the record is gone", get("one"), undefined)
check("and so is its entity", __test.spawned.length, 1)
check("removing something absent is refused", remove("one").ok, false)

console.log("\n— an orphan entity is cleaned up —")
// A record deleted while the chunk was unloaded leaves an entity behind. sync
// has to notice, or holograms accumulate forever.
__test.spawned.push({
    typeId: HOLOGRAM_TYPE, nameTag: "ghost",
    getTags: () => [`${HOLOGRAM_TAG}:vanished`], hasTag: () => false,
    remove() { const i = __test.spawned.indexOf(this); if (i >= 0) __test.spawned.splice(i, 1) }
})
sync()
check("it is removed", __test.spawned.every(e => e.nameTag !== "ghost"), true)

console.log("\n— clearing everything —")
save("three", { kind: "text", text: "x", ...AT })
const cleared = removeAll()
check("it reports how many went", cleared >= 1, true)
check("nothing is left", count(), 0)
sync()
check("and no entities either", __test.spawned.length, 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
