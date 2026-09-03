import { __test } from "@minecraft/server"
import { load, save, drop, Table, cleanId } from "../Admin+ BP/scripts/core/storage.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— round trips —")
save("small", { a: 1, b: "two" })
check("object survives", load("small"), { a: 1, b: "two" })
check("missing key returns the fallback", load("nope", "fallback"), "fallback")

console.log("\n— chunking, the part that silently corrupts —")
const big = { blob: "x".repeat(25000), tail: "END" }
save("big", big)
check("a value larger than one chunk survives", load("big"), big)
const props = [...__test.props.keys()].filter(k => k.startsWith("ap:big"))
check("it really was split across chunks", props.length > 2, true)

// Shrinking must clear the chunks it no longer uses, or stale tail data is
// concatenated onto the next read and the JSON no longer parses.
save("big", { blob: "small again" })
check("shrinking does not leave stale chunks behind", load("big"), { blob: "small again" })
check("leftover chunk properties were cleared",
    [...__test.props.keys()].filter(k => k.startsWith("ap:big#")).length, 1)

console.log("\n— deletion —")
drop("big")
check("dropped value is gone", load("big", null), null)
check("its chunks are gone too", [...__test.props.keys()].filter(k => k.startsWith("ap:big")).length, 0)

console.log("\n— tables —")
const t = new Table("demoTable", { seeded: true })
check("seeds when empty", t.data, { seeded: true })
t.set("x", 5)
check("writes through", new Table("demoTable").data, { seeded: true, x: 5 })
t.delete("seeded")
check("deletes through", new Table("demoTable").data, { x: 5 })
t.replace({ only: "this" })
check("replace swaps the whole table", new Table("demoTable").data, { only: "this" })

console.log("\n— id sanitising —")
check("keeps ordinary names", cleanId(" Spawn Point "), "Spawn Point")
check("strips markup and punctuation", cleanId("§chome!<>"), "chome")
check("caps the length", cleanId("y".repeat(80)).length, 24)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
