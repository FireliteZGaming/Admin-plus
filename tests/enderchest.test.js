import { readFileSync } from "node:fs"
import {
    slotLabel, snapshot, enderSnapshot, itemAt, deposit, transfer, confiscate
} from "../Admin+ BP/scripts/core/inventory.js"
import { ChestForm, sizeSentinels, BIG, bigSlotFor, isBigDivider } from "../Admin+ BP/scripts/core/chestUI.js"
import { signature, reconcile } from "../Admin+ BP/scripts/core/enderview.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

function item(typeId, amount = 1) {
    return { typeId, amount, getLore: () => [], getComponent: () => undefined }
}

/** A player with both containers, so a ref can go to the wrong one and be caught. */
function fakePlayer({ pack = {}, ender = {}, enderSize = 27, noEnder = false, enderFull = false } = {}) {
    const carried = { ...pack }
    const chest = { ...ender }
    const container = (store, size, full) => ({
        size,
        getItem: i => store[i],
        setItem: (i, v) => { if (v === undefined) delete store[i]; else store[i] = v },
        addItem: stack => {
            if (full) return stack                      // nothing fitted
            const free = [...Array(size).keys()].find(i => store[i] === undefined)
            if (free === undefined) return stack
            store[free] = stack
            return undefined
        }
    })
    return {
        id: "p1", name: "Steve",
        __pack: carried, __ender: chest,
        getComponent: id => {
            if (id === "minecraft:inventory") return { container: container(carried, 36, false) }
            if (id === "minecraft:ender_inventory") {
                return noEnder ? undefined : { container: container(chest, enderSize, enderFull) }
            }
            return undefined
        }
    }
}

console.log("\n— the ender chest is just another container —")
const p = fakePlayer({ ender: { 0: item("minecraft:diamond", 12), 26: item("minecraft:bedrock") } })
const snap = enderSnapshot(p)
check("it reads", snap.readable, true)
check("27 slots", snap.size, 27)
check("two stacks found", snap.stacks, 2)
check("counted properly", snap.items, 13)
check("refs say which container they came from", snap.slots.map(s => s.ref.kind), ["ender", "ender"])
check("and which slot", snap.slots.map(s => s.ref.index), [0, 26])
check("named for a person to read", slotLabel({ kind: "ender", index: 0 }), "Ender 1")

// The distinction the whole moderation half rests on.
const blind = fakePlayer({ noEnder: true })
check("no component is NOT an empty chest", enderSnapshot(blind).readable, false)
check("and reports nothing rather than zero items", enderSnapshot(blind).stacks, 0)

console.log("\n— a ref reaches the right container —")
const both = fakePlayer({ pack: { 0: item("minecraft:stone") }, ender: { 0: item("minecraft:diamond") } })
check("slot 0 of the pack", itemAt(both, { kind: "slot", index: 0 })?.typeId, "minecraft:stone")
check("slot 0 of the ender chest", itemAt(both, { kind: "ender", index: 0 })?.typeId, "minecraft:diamond")

console.log("\n— taking out, putting in —")
const mine = fakePlayer({ pack: { 3: item("minecraft:emerald", 5) }, ender: { 1: item("minecraft:netherite_ingot") } })
const stored = deposit(mine, { kind: "slot", index: 3 })
check("depositing succeeds", stored.ok, true)
check("it left the pack", mine.__pack[3], undefined)
check("and landed in the chest", Object.values(mine.__ender).some(s => s.typeId === "minecraft:emerald"), true)

const took = transfer(mine, mine, { kind: "ender", index: 1 })
check("withdrawing succeeds", took.ok, true)
check("it left the chest", mine.__ender[1], undefined)
check("and landed in the pack", Object.values(mine.__pack).some(s => s.typeId === "minecraft:netherite_ingot"), true)

console.log("\n— a full chest costs you nothing —")
// The ordering rule this file already keeps for transfer(): it must land
// before the original is cleared, or a full chest eats the stack.
const full = fakePlayer({ pack: { 0: item("minecraft:diamond_block", 64) }, enderFull: true })
const refused = deposit(full, { kind: "slot", index: 0 })
check("it refuses", refused.ok, false)
check("and says why", refused.reason.includes("full"), true)
check("THE ITEM IS STILL THERE", full.__pack[0]?.typeId, "minecraft:diamond_block")

check("depositing an empty slot refuses", deposit(mine, { kind: "slot", index: 30 }).ok, false)
check("with no ender chest it refuses", deposit(fakePlayer({ pack: { 0: item("minecraft:stone") }, noEnder: true }), { kind: "slot", index: 0 }).ok, false)

console.log("\n— staff can clear an ender slot —")
const suspect = fakePlayer({ ender: { 5: item("minecraft:command_block") } })
const gone = confiscate(suspect, { kind: "ender", index: 5 })
check("it destroys", gone.ok, true)
check("the slot is empty", suspect.__ender[5], undefined)

console.log("\n— the big grid is laid out like a real chest screen —")
check("72 buttons", BIG.total, 72)
check("chest half starts at the top", BIG.container, 0)
check("the break is the fourth row", [BIG.divider, BIG.pack], [27, 36])
check("hotbar is the last nine", [BIG.hotbar, BIG.total - BIG.hotbar], [63, 9])
check("the break is exactly one row", BIG.pack - BIG.divider, 9)

// The hotbar was briefly lifted OUT of the grid so its gap could be six pixels
// rather than a whole row. `collection_index` does not exist in this JSON-UI
// version — the content log said so nine times, once per orphaned cell — and
// nothing else addresses a collection by index. So every cell is in the one
// grid, which spaces rows equally: a break is a whole row or it is nothing.
check("every cell belongs to the one grid", BIG.total % 9, 0)
check("which makes it eight uniform rows", BIG.total / 9, 8)

// Hotbar is 0..8 in the container but the BOTTOM row on screen — get this
// backwards and every item is drawn three rows from where it lives.
check("hotbar slot 0 draws bottom-left", bigSlotFor(0), 63)
check("hotbar slot 8 draws bottom-right", bigSlotFor(8), 71)
check("the pack starts under the gap", bigSlotFor(9), 36)
check("and ends above the hotbar", bigSlotFor(35), 62)
check("nothing outside a real inventory", [bigSlotFor(-1), bigSlotFor(36)], [undefined, undefined])
// Every slot lands somewhere, and no two land together.
const drawn = [...Array(36).keys()].map(bigSlotFor)
check("all 36 map to distinct cells", new Set(drawn).size, 36)
check("none of them lands in either break", drawn.some(isBigDivider), false)
check("the break is the only run of cells nothing can reach",
    [...Array(BIG.total).keys()].filter(isBigDivider).length, 9)

console.log("\n— the sentinels cannot be confused for one another —")
// The JSON-UI picks a layout with a SUBSTRING test, so one sentinel containing
// another draws two chests stacked on top of each other.
const sizes = sizeSentinels()
for (const [a, { sentinel: sa }] of sizes) {
    for (const [b, { sentinel: sb }] of sizes) {
        if (a === b) continue
        check(`${a} is not inside ${b}`, sb.includes(sa), false)
    }
}
check("big announces itself", new ChestForm("big").preview().title.startsWith("§b§i§g§c§h§e§s§t§r"), true)
check("and is 72 slots", new ChestForm("big").size, 72)

console.log("\n— the resource pack draws what the script sends —")
// Same drift hazard as the multiline sentinel: these live in two files in two
// languages and disagreeing does not throw, it just draws the wrong chest.
const ui = JSON.parse(readFileSync(new URL("../Admin+ RP/ui/adminplus_ui.json", import.meta.url), "utf8"))
const panels = ui.chest_panel.controls.map(c => Object.values(c)[0])

const HEADER = 21, ROW = 18, FOOTER = 6
function pngSize(path) {
    const buf = readFileSync(new URL(path, import.meta.url))
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

for (const [name, { sentinel, count }] of sizes) {
    const panel = panels.find(c => {
        const flag = Object.entries(c).find(([k]) => k.endsWith("_chest_flag"))?.[1]
        return typeof flag === "string" && sentinel.startsWith(flag)
    })
    check(`${name} has a panel in the resource pack`, !!panel, true)
    if (!panel) continue

    const kids = panel.controls.map(c => [Object.keys(c)[0], Object.values(c)[0]])
    const grid = kids.map(([, c]) => c).find(c => c?.type === "grid")
    // FIXED dimensions again since 3.1.8. 3.1.7 swapped them for a grid that
    // counts its cells from `#form_button_contents` (as `#maximum_grid_items`),
    // and in the game that built no cells at all: /items showed an empty chest
    // (the user, 2026-11-27: "items is actually completely broken now - no
    // items will appear"). The stall it was meant to fix stayed, too. A fixed
    // grid is the shape every chest drew items in up to 3.1.6.
    const [cols, rows] = grid?.grid_dimensions ?? []
    check(`${name} has fixed dimensions, not a count it reads from the form`,
        [Array.isArray(grid?.grid_dimensions), grid?.grid_rescaling_type, (grid?.bindings ?? []).some(b => b.binding_name_override === "#maximum_grid_items")],
        [true, undefined, false])
    check(`${name} is nine wide`, cols, 9)

    check(`${name} draws ${count} cells`, cols * rows, count)

    // EVERY cell must come from the grid. A row was once placed by hand, cell by
    // cell, with `collection_index` — so its gap could be six pixels instead of
    // a whole row. That property does not exist in this JSON-UI version: the
    // content log answered with `Unknown property [collection_index]`, nine
    // times, one per orphaned cell, and those cells bound to nothing.
    //
    // Nothing else can address a collection by index, so this stays pinned. A
    // loose control here draws no item and reports no error the game surfaces.
    const loose = kids.filter(([, c]) => c && "collection_index" in c)
    check(`${name} places no cell outside the grid`, loose.length, 0)

    const bottom = HEADER + rows * ROW

    // The panel image has to be tall enough for everything in it, or the last
    // row hangs off the frame.
    const png = pngSize(`../Admin+ RP/${panel.texture}.png`)
    check(`${name}'s background is tall enough`, panel.size[1], bottom + FOOTER)
    check(`${name}'s texture matches the size it is drawn at`, [png.width, png.height], panel.size)
}

console.log("\n— the drag view reconciles instead of mirroring —")
// A real container screen onto an ender chest holds a COPY, and writing that
// copy back every tick duplicates items. These are the cases that prove it
// does not.
function box(items = {}, size = 27) {
    const store = { ...items }
    return {
        size,
        getItem: i => store[i],
        setItem: (i, v) => { if (v === undefined) delete store[i]; else store[i] = v }
    }
}
const contents = c => [...Array(c.size).keys()].map(i => c.getItem(i)?.typeId ?? null)

check("a signature notices a stack appearing",
    signature(box({ 0: item("minecraft:diamond") })) === signature(box()), false)
check("and a count changing",
    signature(box({ 0: item("minecraft:diamond", 1) })) === signature(box({ 0: item("minecraft:diamond", 2) })), false)
check("but not a container being read twice",
    signature(box({ 0: item("minecraft:diamond") })), signature(box({ 0: item("minecraft:diamond") })))

// THE DUPE. The player is at their own ender chest while an admin looks in.
// They drag the diamond into their pack, so the chest empties. A blind write
// would put it back and they would have two.
{
    const chest = box({ 0: item("minecraft:diamond") })
    const seen = box({ 0: item("minecraft:diamond") })
    const view = { chestSig: signature(chest), viewSig: signature(seen) }

    chest.setItem(0, undefined)
    check("the real chest wins", reconcile(view, chest, seen), "chest-wins")
    check("THE DIAMOND IS NOT PUT BACK", contents(chest)[0], null)
    check("and the admin watches it leave, live", contents(seen)[0], null)
    check("nothing is left disagreeing", signature(chest), signature(seen))
}

// The other direction: the admin takes something, the player sees it go.
{
    const chest = box({ 0: item("minecraft:netherite_ingot") })
    const seen = box({ 0: item("minecraft:netherite_ingot") })
    const view = { chestSig: signature(chest), viewSig: signature(seen) }

    seen.setItem(0, undefined)
    check("the view wins when only it moved", reconcile(view, chest, seen), "view-wins")
    check("and the chest loses the stack", contents(chest)[0], null)
}

// Both at once is the dangerous one, and the owner still wins.
{
    const chest = box({ 0: item("minecraft:diamond") })
    const seen = box({ 0: item("minecraft:diamond") })
    const view = { chestSig: signature(chest), viewSig: signature(seen) }

    chest.setItem(0, undefined)
    seen.setItem(5, item("minecraft:dirt"))
    check("the owner wins a tie", reconcile(view, chest, seen), "chest-wins")
    check("so nothing the owner removed comes back", contents(chest)[0], null)
    check("and the admin's edit is discarded rather than duplicated", contents(chest)[5], null)
}

{
    const chest = box({ 0: item("minecraft:stone") })
    const seen = box({ 0: item("minecraft:stone") })
    const view = { chestSig: signature(chest), viewSig: signature(seen) }
    check("an untouched view does nothing at all", reconcile(view, chest, seen), "idle")
}

// Putting something in has to survive the round trip too.
{
    const chest = box()
    const seen = box()
    const view = { chestSig: signature(chest), viewSig: signature(seen) }
    seen.setItem(3, item("minecraft:emerald", 7))
    reconcile(view, chest, seen)
    check("an item dragged in reaches the real chest", contents(chest)[3], "minecraft:emerald")
    check("with its count", chest.getItem(3).amount, 7)
    check("and the next tick is quiet", reconcile(view, chest, seen), "idle")
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
