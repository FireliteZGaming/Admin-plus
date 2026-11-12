import { ItemStack, system, world, __test } from "@minecraft/server"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { ITEMS, signItem, itemKey, knockback, coordinate, SIGIL, installAdminItems,
         worldLabels, worldIndex, worldHeight, heightProblem } from "../Admin+ BP/scripts/features/adminitems.js"
import { setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { readFileSync } from "node:fs"

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
check("its blurb says you pick a player to jump to",
    ITEMS.eye.lines.some(l => l.includes("pick a player to jump to")), true)
check("and that looking somewhere still works",
    ITEMS.eye.lines.some(l => l.includes("looking at")), true)

// The chest is TWO rows, grouped by what the thing is: the everyday tools on
// one, the knockback stick on the other. Seven items in one nine-wide row once
// had to sit shoulder to shoulder, and with half of them locked they bunched
// into a clump, which is what it looked like in the world. Four are left since
// 2.8.2, when the Orbital Strike, Spectral Trident and Mirror Totem went.
//
// Written as the rule, so a new item fails here for a real reason: it landed
// outside a row, or it broke the spacing of the row it joined.
{
    const rowOf = slot => Math.floor(slot / 9)
    const byRow = new Map()
    for (const def of defs) {
        const row = rowOf(def.slot)
        byRow.set(row, [...(byRow.get(row) ?? []), def.slot])
    }

    check("the items live on two rows", byRow.size, 2)
    for (const [row, slots] of byRow) {
        const start = row * 9
        const sorted = [...slots].sort((a, b) => a - b)
        check(`row ${row + 1}: nothing spills out of it`,
            sorted.filter(s => s < start || s > start + 8), [])
        const gaps = sorted.slice(1).map((s, i) => s - sorted[i])
        check(`row ${row + 1}: evenly spaced`, new Set(gaps).size <= 1, true)
        // Spread out, not shoulder to shoulder — that was the complaint.
        check(`row ${row + 1}: with a gap between them`, gaps.every(g => g >= 2), true)
        check(`row ${row + 1}: centred, as near as the count allows`,
            Math.abs((sorted[0] - start) - (start + 8 - sorted.at(-1))) <= 1, true)
    }
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


console.log("\n— one gate per item, and it is the rank's answer —")
// Which node each item answers to, stated once. These are not decoration: the
// Knockback stick answered to admin.staffmode until 2.2.4, so every staff
// member got it whatever the ladder said about troll tools, and switching the
// whole troll section off did not take it away.
{
    const P = (perms, op = false) => ({
        id: `g-${perms.join("-")}-${op}`, name: "G",
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => []
    })
    const gateOf = (key, perms, op) => {
        const p = P(perms, op)
        setRanks(p.id, ["Member"], p.name)
        saveRank("gatetest", { display: "§7GateTest", perms })
        setRanks(p.id, ["gatetest"], p.name)
        return ITEMS[key].gate(p)
    }

    check("the hammer wants permanent-ban", gateOf("hammer", ["admin.banperm"]), true)
    check("and refuses without it", gateOf("hammer", ["admin.staffmode"]), false)

    check("the compass wants teleport", gateOf("teleport", ["admin.tp"]), true)
    check("and staff mode is not enough", gateOf("teleport", ["admin.staffmode"]), false)

    check("the eye wants teleport too", gateOf("eye", ["admin.tp"]), true)
    check("and staff mode is not enough for it either",
        gateOf("eye", ["admin.staffmode"]), false)

    // The one that changed: the knockback stick answers to the smite half of
    // the troll node, not to staff mode.
    check("knockback wants the smite half", gateOf("knockback", ["admin.smite"]), true)
    check("and knockback refuses on staff mode alone",
        gateOf("knockback", ["admin.staffmode"]), false)
    // There is no second switch any more. A world that wants no troll tools
    // gives the node to nobody — the same decision, made once, in the place
    // people already go to decide who may do what. The world-level
    // feature.troll made an operator pass one half and fail the other, so the
    // items read as missing rather than as switched off.
    check("the node is the only switch", gateOf("knockback", []), false)

    // Nothing allowed means /items refuses rather than opening empty — the
    // command has no perm of its own, so this filter IS the permission check.
    const nobody = P(["chat.staff"])
    setRanks(nobody.id, ["Member"], nobody.name)
    saveRank("noitems", { display: "§7NoItems", perms: ["chat.staff"] })
    setRanks(nobody.id, ["noitems"], nobody.name)
    check("a rank with no tool node is offered nothing",
        Object.values(ITEMS).filter(d => d.gate(nobody)).length, 0)
}


console.log("\n— the eye's menu: who, or where —")
// Two doors and a shortcut. The shape is pinned in source because the screens
// themselves need a form to open; what matters is that the four player actions
// exist, and that the three which MOVE somebody else ask the ladder while the
// one that moves only you does not.
{
    const eye = readFileSync(
        new URL("../Admin+ BP/scripts/features/adminitems.js", import.meta.url), "utf8")
    const code = eye.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    for (const label of ["§bPlayers", "§bLocation", "§dWhere I'm looking"]) {
        check(`the top level offers ${label.slice(2)}`, code.includes(label), true)
    }
    for (const action of ["Go to", "§eBring here", "§bTeleport", "§dSwap places"]) {
        check(`a player offers ${action.replace(/§./g, "")}`, code.includes(action), true)
    }

    // Going to somebody is not something done TO them — the Teleport compass
    // has always worked that way. Moving them is, and all three that do it
    // check, including inside the coordinate form where the check is repeated
    // after the box closes because a rank can change while somebody types.
    check("bringing somebody asks the ladder",
        /function bringHere[\s\S]*?canActOn\(player, live\)/.test(code), true)
    check("swapping asks the ladder",
        /function swapWith[\s\S]*?canActOn\(player, live\)/.test(code), true)
    check("and sending them to coordinates asks again after the form closes",
        /!self && !canActOn\(player, moving\)/.test(code), true)

    // Both ends of a swap are read before either moves. Teleporting one and
    // then asking where the other is sends the second to where the first no
    // longer stands.
    const swap = code.slice(code.indexOf("function swapWith"))
    const mineAt = swap.indexOf("const mine")
    const theirsAt = swap.indexOf("const theirs")
    const firstMove = swap.indexOf(".teleport(")
    check("a swap reads both positions before moving anybody",
        mineAt < firstMove && theirsAt < firstMove, true)
}


console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
