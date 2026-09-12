import { ItemStack, system, __test } from "@minecraft/server"
import {
    TRIDENT_TAG, beginStorm, liveStorms, tickStorms, clearStorms,
    stormPoints, renderStorm, renderFlight, STORM_TICKS, tickTridents,
    GRIND_TICKS, FLOOR_HEALTH, drainTo, drainCurve, shatterArmour
} from "../Admin+ BP/scripts/core/trident.js"
import {
    FULL_CHARGE, chargesOf, spendCharge, mirrorHand, reflect,
    duringReflection, isReflecting
} from "../Admin+ BP/scripts/core/mirror.js"
import { setting, setSetting, resetSetting, DEFAULTS } from "../Admin+ BP/scripts/core/settings.js"
import { ITEMS, signItem, itemKey, knockback, coordinate, SIGIL, installAdminItems, mirrorTotem, isMirrorTotem,
         worldLabels, worldIndex, worldHeight, heightProblem } from "../Admin+ BP/scripts/features/adminitems.js"
import { armNuke } from "../Admin+ BP/scripts/core/orbital.js"
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
check("its blurb says you pick who to jump to",
    ITEMS.eye.lines.some(l => l.includes("pick who you jump to")), true)
check("and that looking somewhere still works",
    ITEMS.eye.lines.some(l => l.includes("looking at")), true)// The chest is TWO rows now, grouped by what the thing is: the everyday tools
// on one, the combat set on the other. Seven items in one nine-wide row had to
// sit shoulder to shoulder, and with half of them locked they bunched into a
// clump — which is what it looked like in the world.
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


console.log("\n— one rod, one strike —")
// The whole reason a thing this size can sit in an item slot: using it spends
// it. A rod that survived its own strike would be an artillery battery.
{
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

    __test.spawned.length = 0
    __test.runTimers()
    // TNT, not scripted blasts — the strike drops real primed TNT now, and the
    // rod firing means that TNT is in the sky.
    check("and the strike actually went out",
        __test.spawned.filter(e => e.typeId === "minecraft:tnt").length > 0, true)

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
    __test.spawned.length = 0
    __test.runTimers()
    check("nor does it fire",
        __test.spawned.filter(e => e.typeId === "minecraft:tnt").length, 0)

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

    // The one that changed. Both switches, and the section switch is the
    // owner's — so it is tested from both sides.
    // The combat set — what you throw, what you swing, and what you hold when
    // somebody throws theirs — share one gate. Splitting them would let a rank
    // hand out the attack but not the answer to it.
    for (const key of ["knockback", "trident", "mirror"]) {
        check(key + " wants troll tools", gateOf(key, ["admin.troll"]), true)
        check("and " + key + " refuses on staff mode alone",
            gateOf(key, ["admin.staffmode"]), false)
    }
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


console.log("\n— the Spectral Trident: thrown, tagged, and answered —")
// A trident because a trident IS the item. An arrow is ammunition: the bow
// picks a stack, consumes it, and spawns a generic arrow carrying none of the
// name or lore — you can neither tell which arrow went nor choose which one
// does. Here you throw the one in your hand.
//
// But the flying entity carries nothing either, so identity is TAGGED onto it
// in the air. Nothing about that chain depends on an event firing, and these
// drive the real loop to prove it.
{
    check("the trident is a trident", ITEMS.trident.typeId, "minecraft:trident")
    check("and it says it comes back",
        ITEMS.trident.lines.some(l => l.includes("comes back")), true)

    // Loyalty is applied when it is minted — the item's whole promise is that
    // you get it back, and one without it is a trident you throw off a cliff
    // once.
    const made = ITEMS.trident.make()
    const ench = made.getComponent("minecraft:enchantable")?.getEnchantments?.() ?? []
    check("it is minted with loyalty", ench.some(e => e.level === 3), true)

    // ---------------------------------------------------------------------
    // **The whole chain, driven a tick at a time.**
    //
    // The first version hung on two events firing — itemReleaseUse to notice
    // the throw, entitySpawn to catch the entity — and in a real world the
    // trident did NOTHING: no trail, no storm. That is one failure, not two.
    // An untagged trident is correctly ignored by everything downstream.
    //
    // The old test passed anyway, because it fired those events itself. It was
    // testing that the handlers worked, never that anything would call them.
    // This drives the real loop instead.
    const isOurs = stack => itemKey(stack) === "trident"
    const held = new Map()
    const thrower = {
        id: "trident-thrower", name: "Thrower", typeId: "minecraft:player",
        getTags: () => ["ap:rank:Owner"], commandPermissionLevel: 1,
        location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension,
        getComponent: id => id === "minecraft:equippable"
            ? { getEquipment: s => held.get(s), setEquipment: (s, v) => held.set(s, v) }
            : undefined,
        sendMessage: () => {}
    }
    setRanks(thrower.id, ["Admin"], thrower.name)
    __test.players.push(thrower)

    const flying = () => {
        const tags = new Set()
        return {
            typeId: "minecraft:thrown_trident",
            location: { x: 0, y: 64, z: 1 },
            dimension: __test.dimension,
            addTag: t => tags.has(t) ? false : (tags.add(t), true),
            hasTag: t => tags.has(t),
            isValid: true
        }
    }

    // Nobody is holding anything: a trident in the air is not ours.
    clearStorms()
    __test.spawned.length = 0
    const stranger = flying()
    __test.spawned.push(stranger)
    tickTridents(0, isOurs)
    check("a trident nobody threw is left alone", stranger.hasTag(TRIDENT_TAG), false)
    __test.spawned.length = 0

    // Now they hold ours. The poll notices — no event needed.
    held.set("mainhand", made)
    tickTridents(0, isOurs)          // tick 0 polls
    const inAir = flying()
    __test.spawned.push(inAir)
    tickTridents(1, isOurs)          // and the next tick adopts it
    check("a trident thrown by somebody holding ours is tagged",
        inAir.hasTag(TRIDENT_TAG), true)

    // One throw adopts ONE trident, not every trident in the sky.
    const second = flying()
    __test.spawned.push(second)
    tickTridents(2, isOurs)
    check("and only one — a claim is spent when it is used",
        second.hasTag(TRIDENT_TAG), false)
    __test.spawned.length = 0
    held.clear()

    // Landing in somebody starts the storm, and it is OURS that does it.
    clearStorms()
    const victim = { id: "hit-me", name: "Victim", isValid: true,
                     location: { x: 5, y: 64, z: 5 }, dimension: __test.dimension }
    // Landing is noticed through entityHurt now, not projectileHitEntity — it
    // did nothing to MOBS, and rather than guess a third time at which
    // projectile event a trident raises, it uses the one the content log proves
    // fires on this runtime.
    __test.emitEntityHurt(victim, thrower, stranger)
    check("an untagged trident starts nothing", liveStorms(), 0)
    __test.emitEntityHurt(victim, thrower, inAir)
    check("ours starts a storm", liveStorms(), 1)

    // A mob is a victim like any other. Nothing ever excluded them; the hit
    // was simply not arriving.
    clearStorms()
    const zombie = {
        id: "zom", typeId: "minecraft:zombie", isValid: true,
        location: { x: 9, y: 64, z: 9 }, dimension: __test.dimension,
        getComponent: () => undefined
    }
    const atMob = flying()
    atMob.addTag(TRIDENT_TAG)
    __test.emitEntityHurt(zombie, thrower, atMob)
    check("and it works on a mob", liveStorms(), 1)

    // A Loyalty trident comes back through what it hit. One strike per throw.
    clearStorms()
    const twice = flying()
    twice.addTag(TRIDENT_TAG)
    __test.emitEntityHurt(victim, thrower, twice)
    __test.emitEntityHurt(victim, thrower, twice)
    check("but only once per throw, however often it clips them", liveStorms(), 1)

    // **The ladder, at the moment it lands.** Holding the trident is not
    // permission to use it on somebody above you, and the throw is the only
    // other place this could be asked — by which point it is already in the
    // air. Stripping armour and pinning someone at half a heart is not banter,
    // so it is canActOn and not canTrollOn.
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/adminitems.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("' + chr(92) + 'n").filter(l => !l.trim().startsWith("//")).join("' + chr(92) + 'n")
    check("the hit asks the strict ladder",
        /!canActOn\(thrower, victim\)/.test(code), true)
    check("and refuses rather than half-doing it",
        /outranks you — the dust scatters/.test(src), true)
    check("the strike is logged", /record\(thrower, "admin.trident"/.test(code), true)

    // And it ends on its own rather than swirling forever.
    let ticks = 0
    for (let t = 1; t <= STORM_TICKS + 5; t++) { ticks = tickStorms((system.currentTick ?? 0) + t) }
    check("the storm finishes", liveStorms(), 0)

    clearStorms()
    __test.players.pop()
}

console.log("\n— ten swirls, each its own —")
// Each swirl gets its radius, speed and direction fixed when the storm starts
// rather than re-rolled per frame. Re-rolling every tick is a fog of unrelated
// dots; fixing them means ten things that visibly ORBIT, at odds with each
// other, which is what reads as erratic.
{
    let n = 0
    const fixed = () => { n += 0.07; return n % 1 }
    const points = stormPoints(fixed)
    check("there are ten of them", points.length, 10)
    check("every one has a real radius", points.every(p => p.radius > 0), true)
    check("and a real speed", points.every(p => p.speed > 0), true)
    check("they turn both ways", new Set(points.map(p => p.dir)).size, 2)
    check("and no two share a starting angle",
        new Set(points.map(p => p.offset)).size, 10)

    // The frame draws one particle per swirl — ten a tick, which is inside the
    // budget Soulbound's spiral works to (~14-28/tick at its peak).
    let drawn = 0
    const dim = { spawnParticle: () => { drawn++ } }
    renderStorm(dim, { x: 0, y: 64, z: 0 }, points, 5, 0.5)
    check("one particle per swirl per frame", drawn, 10)

    // The trail is cheaper still, because it runs on every trident in the air.
    let trail = 0
    renderFlight({ location: { x: 0, y: 64, z: 0 },
                   dimension: { spawnParticle: () => { trail++ } } }, 3)
    check("the trail is six a tick", trail, 6)
}


console.log("\n— three seconds, then the armour, then half a heart —")
// The whole sequence, driven tick by tick rather than described: it grinds them
// down for three seconds, breaks what they are wearing, pins them at half a
// heart, and only then collapses and goes back out as a ring.
{
    let hp = 20
    let pieces = 4
    const drawn = []
    const dimension = {
        spawnParticle: (id, at) => drawn.push(at),
        playSound: () => {}
    }
    const victim = {
        id: "storm-victim", typeId: "minecraft:player", isValid: true,
        location: { x: 0, y: 64, z: 0 }, dimension,
        getComponent: id =>
            id === "minecraft:health" ? { currentValue: hp, setCurrentValue: v => { hp = v } }
            : id === "minecraft:equippable"
                ? { getEquipment: () => pieces > 0 ? {} : undefined, setEquipment: () => { pieces-- } }
                : undefined
    }

    clearStorms()
    beginStorm(victim)
    const at = t => { for (let i = 1; i <= t; i++) tickStorms(i); return { hp, pieces } }

    // It takes the full three seconds. A weapon that stripped somebody
    // instantly would be a hit they read about afterwards rather than a thing
    // visibly happening to them.
    clearStorms(); hp = 20; pieces = 4; beginStorm(victim)
    tickStorms(1)
    check("it starts taking health immediately", hp < 20, true)
    check("but the armour is untouched at the start", pieces, 4)

    for (let t = 2; t < GRIND_TICKS; t++) tickStorms(t)
    check("armour survives the whole grind", pieces, 4)
    check("and they are nearly down by the end of it", hp < 2, true)
    check("without ever going below half a heart", hp >= FLOOR_HEALTH, true)

    tickStorms(GRIND_TICKS)
    check("then the armour goes, all of it", pieces, 0)
    check("and they sit at exactly half a heart", hp, FLOOR_HEALTH)

    // Never a kill. The floor is what the item promises, and a weapon
    // described as "drops them to half a heart" must not sometimes drop them
    // to nothing — which is why health is SET rather than damaged.
    for (let t = GRIND_TICKS + 1; t <= STORM_TICKS; t++) tickStorms(t)
    check("it never kills", hp, FLOOR_HEALTH)
    check("and the storm ends", liveStorms(), 0)
}
console.log("\n— it says what it broke, because nothing is invisible —")
// "Nothing happened" and "they were not wearing any" look identical from across
// a field. A mob with no armour is by far the commonest case, and it was
// indistinguishable from the armour phase being broken — which is how a
// playtest report of "armour breaking doesn't work on mobs" could mean either.
{
    let said
    let pieces = 0
    const dimension = { spawnParticle: () => {}, playSound: () => {} }
    const subject = () => ({
        id: "tell-me", typeId: "minecraft:zombie", isValid: true,
        location: { x: 0, y: 64, z: 0 }, dimension,
        getComponent: id =>
            id === "minecraft:health" ? { currentValue: 20, setCurrentValue: () => {} }
            : id === "minecraft:equippable"
                ? { getEquipment: () => pieces > 0 ? {} : undefined, setEquipment: () => { pieces-- } }
                : undefined
    })
    const run = () => { for (let t = 1; t <= GRIND_TICKS + 2; t++) tickStorms(t) }

    clearStorms(); pieces = 4; said = undefined
    beginStorm(subject(), n => { said = n })
    run()
    check("it counts what came off a mob", said, 4)

    clearStorms(); pieces = 0; said = undefined
    beginStorm(subject(), n => { said = n })
    run()
    check("and says zero rather than staying silent", said, 0)

    // Dying inside the three seconds is the OTHER reason nothing appears to
    // happen, and it reports differently so the two can be told apart.
    clearStorms(); pieces = 4; said = "untouched"
    const dies = subject()
    beginStorm(dies, n => { said = n })
    dies.isValid = false
    run()
    check("somebody who died mid-grind reports nothing broken", said, undefined)
    clearStorms()
}

console.log("\n— it only ever takes health away —")
{
    // Somebody already below the floor is left where they are, not healed up
    // to it. A weapon that topped players up would be a strange weapon.
    let hp = 0.5
    const weak = { getComponent: () => ({ currentValue: hp, setCurrentValue: v => { hp = v } }) }
    drainTo(weak, 10)
    check("somebody already under the floor is not healed", hp, 0.5)

    let full = 20
    const strong = { getComponent: () => ({ currentValue: full, setCurrentValue: v => { full = v } }) }
    drainTo(strong, 6)
    check("and the drain lands where it was told", full, 6)
    drainTo(strong, 0)
    check("clamped at half a heart, never through it", full, FLOOR_HEALTH)

    // The curve reaches the floor exactly at the end of the grind, not before.
    check("the curve starts where they are", drainCurve(20, 0), 20)
    check("and finishes at the floor", drainCurve(20, GRIND_TICKS), FLOOR_HEALTH)
    check("halfway is halfway", Math.round(drainCurve(20, GRIND_TICKS / 2) * 10) / 10, 10.5)
}

console.log("\n— a storm on a place harms nobody —")
{
    // The visual starts before we know what was struck, so a trident in the
    // dirt draws all three acts and hurts no one.
    clearStorms()
    let particles = 0
    const ground = {
        location: { x: 3, y: 64, z: 3 },
        dimension: { spawnParticle: () => { particles++ }, playSound: () => {} },
        isValid: false
    }
    check("it starts", beginStorm(ground), true)
    for (let t = 1; t <= STORM_TICKS; t++) tickStorms(t)
    check("and draws the whole thing", particles > 0, true)
    check("then finishes", liveStorms(), 0)
    clearStorms()
}


console.log("\n— the Mirror Totem: charges that ride on the item —")
// A totem is not a tool, so there is no damage component and no bar. The count
// lives in the LORE and the stack is re-minted, which means the charge travels
// with the ITEM — drop it, trade it, leave it in a chest, and it is the same
// totem with the same charges. A count kept against a player id in storage
// would be none of those, because an item has no identity to key on.
{
    check("a fresh one is an iron helmet's worth", FULL_CHARGE, 165)
    const fresh = ITEMS.mirror.make()
    check("it is a totem", fresh.typeId, "minecraft:totem_of_undying")
    check("and it carries its count", chargesOf(fresh), { left: 165, max: 165 })

    // Absent means NOT ONE OF OURS — never "full". A totem found in a chest
    // must not read as a fresh mirror.
    const plain = new ItemStack("minecraft:totem_of_undying", 1)
    check("a plain totem carries no count", chargesOf(plain), undefined)
    check("nor does nothing at all", chargesOf(undefined), undefined)

    // The serial and the count are separate lore lines on purpose: re-minting
    // changes the count without ever touching the thing that proves it is ours.
    check("it is still signed after a spend",
        itemKey(spendCharge(fresh, (l, m) => mirrorTotem(l, m)).stack), "mirror")
}

console.log("\n— spending, and what it becomes at zero —")
{
    const mint = (left, max) => mirrorTotem(left, max)
    let stack = ITEMS.mirror.make()
    const one = spendCharge(stack, mint)
    check("a hit costs one", one.left, FULL_CHARGE - 1)
    check("and it is still a mirror", chargesOf(one.stack)?.left, FULL_CHARGE - 1)

    // At zero it is no longer the same item — it becomes an ordinary totem of
    // undying, which still saves your life once and is a fine thing to be left
    // holding.
    let low = mint(1, FULL_CHARGE)
    const last = spendCharge(low, mint)
    check("the last charge spends it out", last.spent_out, true)
    check("and leaves a plain totem", last.stack.typeId, "minecraft:totem_of_undying")
    check("with no count on it", chargesOf(last.stack), undefined)
    check("so it stops being one of ours", itemKey(last.stack), undefined)

    // Something that was never ours cannot be spent.
    check("a plain totem has nothing to spend",
        spendCharge(new ItemStack("minecraft:totem_of_undying", 1), mint).spent, false)
}

console.log("\n— it reflects, and never volleys —")
{
    // Applying the reflected damage raises the same event again. If the
    // attacker is holding a mirror too, the two would bounce the hit between
    // them until something gave — and what gives is the server.
    let dealt = 0
    const attacker = { applyDamage: n => { dealt += n; return true } }
    check("the same number goes back", reflect(attacker, 7) && dealt, 7)
    check("a zero hit reflects nothing", reflect(attacker, 0), false)
    check("and nobody to hit is not an error", reflect(undefined, 5), false)

    check("normally it is not mid-reflection", isReflecting(), false)
    let sawInside
    duringReflection(() => { sawInside = isReflecting() })
    check("inside a reflection it says so", sawInside, true)
    check("and it clears afterwards", isReflecting(), false)
    // Even if the reflection throws, the flag must clear, or every later hit
    // is silently ignored for the rest of the session.
    try { duringReflection(() => { throw new Error("boom") }) } catch { /* expected */ }
    check("it clears even when the reflection throws", isReflecting(), false)
}

console.log("\n— which hand, and the two event paths —")
{
    // Totems work from either hand in vanilla, so this does too.
    const held = new Map()
    const holder = {
        getComponent: id => id === "minecraft:equippable"
            ? { getEquipment: s => held.get(s), setEquipment: (s, v) => held.set(s, v) }
            : undefined
    }
    const mine = ITEMS.mirror.make()
    check("nothing held is no mirror", mirrorHand(holder, isMirrorTotem), undefined)
    held.set("offhand", mine)
    check("the offhand counts", mirrorHand(holder, isMirrorTotem)?.slot, "offhand")
    held.clear()
    held.set("mainhand", mine)
    check("so does the main hand", mirrorHand(holder, isMirrorTotem)?.slot, "mainhand")

    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/adminitems.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")    // Sliced from each subscription rather than searched with a character
    // window. The first `event.cancel = true` in this file belongs to the
    // ENDER EYE, so a window anchored on the wrong side of it finds the wrong
    // cancel — or, as it did here, none at all.
    const beforeBlock = code.slice(code.indexOf("beforeEvents?.entityHurt"))
    check("it prefers refusing the damage outright",
        /event\.cancel = true/.test(beforeBlock.slice(0, 500)), true)
    // Anchored inside installMirror, not on the first entityHurt in the file —
    // the Spectral Trident subscribes to it too now, and it comes first. Same
    // trap as the eye's event.cancel: a window anchored on the wrong match.
    const mirrorBlock = code.slice(code.indexOf("function installMirror"))
    const afterBlock = mirrorBlock.slice(mirrorBlock.indexOf("afterEvents?.entityHurt"))
    check("and falls back to healing it back",
        /setCurrentValue/.test(afterBlock.slice(0, 900)), true)
    check("both paths refuse to run inside a reflection",
        (code.match(/if \(isReflecting\(\)\) return/g) ?? []).length, 2)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
