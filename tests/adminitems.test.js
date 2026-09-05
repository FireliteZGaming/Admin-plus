import { ItemStack } from "@minecraft/server"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { ITEMS, signItem, itemKey, knockback, SIGIL } from "../Admin+ BP/scripts/features/adminitems.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— the catalogue is well formed —")
const defs = Object.values(ITEMS)
check("no two items share a slot", new Set(defs.map(d => d.slot)).size, defs.length)
check("no two items share an item type", new Set(defs.map(d => d.typeId)).size, defs.length)
check("every item has a gate", defs.every(d => typeof d.gate === "function"), true)
check("every item can be made", defs.every(d => typeof d.make === "function"), true)

console.log("\n— items are signed against forgery —")
const compass = signItem("minecraft:compass", "§b§lTeleport", "§7jump")
check("a minted item is recognised", itemKey(compass), "teleport")

const renamed = new ItemStack("minecraft:compass", 1)
renamed.nameTag = "§b§lTeleport"
check("the same item renamed by hand is not", itemKey(renamed), undefined)

const wrongSerial = new ItemStack("minecraft:compass", 1)
wrongSerial.nameTag = "§b§lTeleport"
wrongSerial.setLore(["§7jump", `${SIGIL} · #000000`])
check("nor one carrying the wrong serial", itemKey(wrongSerial), undefined)

check("a plain item is not one of ours", itemKey(new ItemStack("minecraft:stick", 1)), undefined)
check("nor is nothing at all", itemKey(undefined), undefined)

// The sigil must differ from the staff-mode tools', or /mm compasses would
// fire /items handlers and vice versa.
check("the /items sigil is not the staff-tool sigil", SIGIL.includes("staff tool"), false)

console.log("\n— knockback picks a working signature and normalises direction —")
// New signature first: applyKnockback(VectorXZ, vertical).
{
    const calls = []
    const attacker = { getViewDirection: () => ({ x: 3, y: 0, z: 4 }) } // length 5
    const victim = { applyKnockback: (h, v) => calls.push(["new", h, v]) }
    check("it reports success", knockback(attacker, victim), true)
    check("it used the new VectorXZ form", calls[0][0], "new")
    // 3-4-5 triangle: normalised to x=0.6, z=0.8, then scaled by the configured
    // force. Read that from config rather than pinning the number here — it is
    // tunable now, and a test that hardcodes it only ever proves it was not
    // changed.
    const force = Number(setting("items.knockback"))
    check("horizontal is normalised then scaled",
        [calls[0][1].x, calls[0][1].z], [0.6 * force, 0.8 * force])
    check("direction is a unit vector before scaling",
        Math.round(Math.hypot(calls[0][1].x, calls[0][1].z) * 1e6) / 1e6, force)
    check("with a vertical lift", calls[0][2] > 0, true)
    check("and the lift is the configured one", calls[0][2], Number(setting("items.knockbackLift")))
}

// Tunable means tunable: change the setting, the throw changes. Full scale was
// the 2.0.0 playtest's call after feeling 4 in the world, but the number is the
// owner's now, so what is pinned here is that config REACHES it.
{
    const shove = (force) => {
        setSetting("items.knockback", String(force))
        const calls = []
        knockback({ getViewDirection: () => ({ x: 1, y: 0, z: 0 }) },
                  { applyKnockback: (h) => calls.push(h) })
        return calls[0].x
    }
    check("a small force throws gently", shove(2), 2)
    check("a large one throws hard", shove(40), 40)
    check("the shipped default is full scale, not the old cautious 4",
        Number(DEFAULTS["items.knockback"].value) > 4, true)
    setSetting("items.knockback", "not a number")
    check("nonsense falls back to the shipped value rather than NaN",
        shove(DEFAULTS["items.knockback"].value) > 0, true)
    resetSetting("items.knockback")
    resetSetting("items.knockbackLift")
}

// Old four-argument form, when the new one throws.
{
    const calls = []
    const attacker = { getViewDirection: () => ({ x: 1, y: 0, z: 0 }) }
    const victim = {
        applyKnockback: (a, b, c, d) => {
            if (typeof a === "object") throw new Error("no VectorXZ on this runtime")
            calls.push(["old", a, b, c, d])
        }
    }
    check("it falls through to the four-arg form", knockback(attacker, victim), true)
    check("which got four numbers", calls[0].length, 5)
    check("direction x is 1, z is 0", [calls[0][1], calls[0][2]], [1, 0])
}

// applyImpulse as the last resort.
{
    const calls = []
    const attacker = { getViewDirection: () => ({ x: 0, y: 0, z: 1 }) }
    const victim = {
        applyKnockback: () => { throw new Error("gone") },
        applyImpulse: (v) => calls.push(v)
    }
    check("it falls all the way to applyImpulse", knockback(attacker, victim), true)
    check("with a 3D vector carrying the lift on y", calls[0].y > 0, true)
    check("and the facing on z", calls[0].z > 0, true)
}

// Nothing to apply with: reported, not thrown.
{
    const attacker = { getViewDirection: () => ({ x: 1, y: 0, z: 0 }) }
    const victim = {}
    check("a victim with no knockback method fails cleanly", knockback(attacker, victim), false)
}

// A zero look direction must not divide by zero into NaN.
{
    const calls = []
    const attacker = { getViewDirection: () => ({ x: 0, y: 1, z: 0 }) }
    const victim = { applyKnockback: (h) => calls.push(h) }
    knockback(attacker, victim)
    check("a straight-up look does not produce NaN", Number.isFinite(calls[0].x) && Number.isFinite(calls[0].z), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
