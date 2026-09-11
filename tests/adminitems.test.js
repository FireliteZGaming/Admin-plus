import { ItemStack, __test } from "@minecraft/server"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { ITEMS, signItem, itemKey, knockback, coordinate, SIGIL, installAdminItems,
         worldLabels, worldIndex, worldHeight, heightProblem } from "../Admin+ BP/scripts/features/adminitems.js"
import { armNuke } from "../Admin+ BP/scripts/core/orbital.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— the catalogue is well formed —")
const defs = Object.values(ITEMS)
check("no two items share a slot", new Set(defs.map(d => d.slot)).size, defs.length)
check("nor a type and name pair, which is how itemKey tells them apart",
    new Set(defs.map(d => `${d.typeId}|${d.name}`)).size, defs.length)

// The Ender Eye. It exists because every other teleport needs a TARGET, and a
// target means a selector — and a custom command's selector parameter is
// expanded by the engine at a permission level these commands cannot have, so
// `@p` is refused before any of this pack's code runs. An item has no arguments
// to refuse, which also means nobody has to know `@p` exists: the destination
// is PICKED from a list of names instead of typed.
check("the eye is an ender eye", ITEMS.eye.typeId, "minecraft:ender_eye")
check("and answers to the teleport node, not staff mode",
    ITEMS.eye.gate({ getTags: () => [], commandPermissionLevel: 0,
                     name: "T", id: "t" }), false)
check("its blurb says you pick who to jump to",
    ITEMS.eye.lines.some(l => l.includes("pick who you jump to")), true)
check("and that looking somewhere still works",
    ITEMS.eye.lines.some(l => l.includes("looking at")), true)
// Row two of a large chest is slots 9-17; these want to be spread across it
// rather than bunched, because they are picked by eye. Written as the RULE
// rather than as the current list, so adding a sixth item fails here for the
// real reason — it no longer fits evenly — instead of failing on a number.
{
    const slots = defs.map(d => d.slot).sort((a, b) => a - b)
    check("every item is in row two of a large chest",
        slots.filter(s => s < 9 || s > 17), [])
    const gaps = slots.slice(1).map((s, i) => s - slots[i])
    check("and they are evenly spaced across it", new Set(gaps).size <= 1, true)
    check("the row is centred — the same gap at each end",
        slots[0] - 9, 17 - slots.at(-1))
}
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


console.log("\n— using the eye must never throw it —")
// A vanilla ender eye that is merely HANDLED is still thrown: it flies off
// toward a stronghold and is gone, taking the admin's teleport with it. The
// only thing that stops that is `cancel` on the BEFORE event — and a cancelled
// before-event means the after-event never fires, so the eye cannot be handled
// in both places. This fires a real use through the stub and reads the flag,
// rather than asserting that the source contains the word "cancel".
{
    installAdminItems()
    const holder = {
        id: "eye-holder", name: "Holder",
        getTags: () => ["ap:rank:Owner"],
        commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 },
        dimension: { id: "minecraft:overworld" },
        getRotation: () => ({ x: 0, y: 0 }),
        getBlockFromViewDirection: () => undefined,
        sendMessage: () => {},
        teleport: () => {}
    }

    const eye = ITEMS.eye.make()
    check("using the eye is cancelled, so it is never thrown",
        __test.emitItemUse(holder, eye).cancel, true)

    // Everything else must still go through untouched, or using a sword would
    // start being swallowed by the item system.
    const stick = new ItemStack("minecraft:stick", 1)
    check("using anything else is left alone",
        __test.emitItemUse(holder, stick).cancel, false)

    // A hand-made ender eye is not ours — no serial in the lore — so a player
    // who crafts one can still use it as an ender eye.
    const crafted = new ItemStack("minecraft:ender_eye", 1)
    crafted.nameTag = "§d§lEnder Eye"
    check("a forged copy is not cancelled either",
        __test.emitItemUse(holder, crafted).cancel, false)
}


console.log("\n— coordinates read the way the game reads them —")
// `~` is what people already type, so the eye takes it. The important half is
// the refusal: a field that cannot be read comes back undefined and is named in
// an error, never silently treated as 0 — a typo'd Y that reads as zero drops
// you into bedrock, and it would look like the eye simply misbehaved.
check("a plain number is absolute", coordinate("100", 7), 100)
check("a negative one too", coordinate("-12.5", 7), -12.5)
check("a bare tilde is where you already are", coordinate("~", 64), 64)
check("a tilde with an offset moves from there", coordinate("~10", 64), 74)
check("and a negative offset goes the other way", coordinate("~-10", 64), 54)
check("surrounding spaces are ignored", coordinate("  ~5  ", 64), 69)

check("an empty field is refused, not read as zero", coordinate("", 64), undefined)
check("so is whitespace alone", coordinate("   ", 64), undefined)
check("so is a word", coordinate("here", 64), undefined)
check("so is a tilde with nonsense after it", coordinate("~up", 64), undefined)
check("and so is nothing at all", coordinate(undefined, 64), undefined)
// Number("Infinity") is finite-looking until you check; a teleport there throws.
check("infinity is refused", coordinate("Infinity", 64), undefined)
check("as is a tilde offset of infinity", coordinate("~Infinity", 64), undefined)


console.log("\n— one rod, one strike —")
// The whole reason a thing this size can sit in an item slot: using it spends
// it. A rod that survived its own strike would be an artillery battery.
{
    setSetting("feature.troll", "true")
    armNuke(true)

    const slots = new Map()
    const container = {
        size: 36,
        getItem: (i) => slots.get(i),
        setItem: (i, stack) => { if (stack) slots.set(i, stack); else slots.delete(i) },
        addItem: () => undefined
    }
    const gunner = {
        id: "gunner", name: "Gunner",
        getTags: () => ["Dev", "ap:rank:Admin"],
        commandPermissionLevel: 1,
        selectedSlotIndex: 0,
        location: { x: 0, y: 64, z: 0 },
        dimension: __test.dimension,
        getComponent: (id) => id === "minecraft:inventory" ? { container } : undefined,
        getHeadLocation: () => ({ x: 0, y: 65.62, z: 0 }),
        getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
        getBlockFromViewDirection: () => ({ block: { location: { x: 0, y: 64, z: 30 } } }),
        addEffect: () => {}, removeEffect: () => {}, sendMessage: () => {}
    }

    // Two in the stack. Spending the WHOLE stack because one was used is the
    // bug this is here to catch — `clear <player> fishing_rod` would do exactly
    // that, which is why the code works by slot.
    const stack = ITEMS.orbital.make()
    stack.amount = 2
    slots.set(0, stack)

    __test.timers.length = 0
    __test.explosions.length = 0
    const event = __test.emitItemUse(gunner, slots.get(0))
    check("using it is cancelled, so no bobber is ever cast", event.cancel, true)
    check("one was spent", slots.get(0)?.amount, 1)
    check("and the rest of the stack survives", !!slots.get(0), true)

    __test.runTimers()
    check("and the strike actually went out", __test.explosions.length > 0, true)

    // The last one leaves the slot empty rather than sitting there at zero.
    __test.timers.length = 0
    __test.emitItemUse(gunner, slots.get(0))
    check("spending the last one empties the slot", slots.get(0), undefined)

    // Disarmed at the console: every rod already handed out goes inert, which
    // is what a switch has to mean or it is decoration.
    slots.set(0, ITEMS.orbital.make())
    armNuke(false)
    __test.timers.length = 0
    __test.explosions.length = 0
    __test.emitItemUse(gunner, slots.get(0))
    check("a disarmed rod is not spent", slots.get(0)?.amount, 1)
    __test.runTimers()
    check("nor does it fire", __test.explosions.length, 0)

    resetSetting("feature.troll")
}


console.log("\n— the Location screen names a world as well as a place —")
// Coordinates alone were only ever half the question. The dropdown opens on the
// world you are standing in, so a jump within it needs nothing but a number.
check("three worlds, in the order people say them",
    worldLabels(), ["Overworld", "Nether", "The End"])
check("it opens on the world you are in", worldIndex("minecraft:nether"), 1)
check("the end too", worldIndex("minecraft:the_end"), 2)
check("and an unknown one falls back to the Overworld rather than throwing",
    worldIndex("minecraft:some_mod_world"), 0)
check("as does no dimension at all", worldIndex(undefined), 0)

console.log("\n— choosing a world is what makes the height dangerous —")
// This is the whole reason the dropdown needed a guard. `~` in the Y box means
// where you are NOW: standing at 200 in the Overworld and picking the Nether
// puts you inside the bedrock roof, which is not somewhere you walk out of.
// Named and REFUSED, never clamped — silently moving somebody 73 blocks from
// where they asked is worse than telling them the number was wrong.
check("200 is fine in the Overworld", heightProblem(200, 0), undefined)
check("but not in the Nether", heightProblem(200, 1) === undefined, false)
check("and the refusal names the world and the limit",
    heightProblem(200, 1).includes("Nether") && heightProblem(200, 1).includes("127"), true)

check("the Nether's own ceiling is out too — that IS the bedrock",
    heightProblem(128, 1) === undefined, false)
check("one below it is where you can stand", heightProblem(127, 1), undefined)
check("its floor is fine", heightProblem(0, 1), undefined)
check("below the floor is not", heightProblem(-1, 1) === undefined, false)

check("the Overworld reaches below zero, which the others do not",
    heightProblem(-60, 0), undefined)
check("the End does not", heightProblem(-60, 2) === undefined, false)

// The engine is asked first — the Overworld's floor has moved once already, in
// 1.18, and a hardcoded table that disagreed with the game would refuse real
// heights. The stub reports ranges, so this proves the reading path runs.
check("heights come from the engine where it will say",
    worldHeight(1), { id: "minecraft:nether", label: "Nether", min: 0, max: 128 })
check("and an index out of range is the Overworld, not a crash",
    worldHeight(99).label, "Overworld")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
