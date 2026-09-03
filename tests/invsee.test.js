import { EquipmentSlot } from "@minecraft/server"
import {
    prettyName, describeItem, slotLabel, snapshot, itemAt,
    confiscate, transfer, itemLine, EQUIPMENT
} from "../Admin+ BP/scripts/core/inventory.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// A stand-in ItemStack: only the surface core/inventory.js actually reads.
function item(typeId, amount = 1, extra = {}) {
    const { nameTag, lore = [], enchants, durability } = extra
    return {
        typeId, amount, nameTag,
        getLore: () => lore,
        getComponent: (id) => {
            if (id === "minecraft:enchantable" && enchants) {
                return { getEnchantments: () => enchants }
            }
            if (id === "minecraft:durability" && durability) return durability
            return undefined
        }
    }
}

/** A player carrying `slots` and wearing `worn`. */
function fakePlayer(slots = {}, worn = {}, { size = 36, noInventory = false } = {}) {
    const contents = { ...slots }
    const equipment = { ...worn }
    return {
        id: "p1", name: "Steve",
        getComponent: (id) => {
            if (id === "minecraft:inventory") {
                if (noInventory) return undefined
                return {
                    container: {
                        size,
                        getItem: (i) => contents[i],
                        setItem: (i, v) => { if (v === undefined) delete contents[i]; else contents[i] = v },
                        addItem: (stack) => { contents[99] = stack; return undefined }
                    }
                }
            }
            if (id === "minecraft:equippable") {
                return {
                    getEquipment: (slot) => equipment[slot],
                    setEquipment: (slot, v) => { if (v === undefined) delete equipment[slot]; else equipment[slot] = v }
                }
            }
            return undefined
        },
        __contents: contents,
        __equipment: equipment
    }
}

console.log("\n— naming things the way a player would —")
check("namespace dropped, words capitalised", prettyName("minecraft:diamond_pickaxe"), "Diamond Pickaxe")
check("no namespace is fine", prettyName("stone"), "Stone")
check("nothing readable still says something", prettyName(""), "Unknown item")
check("undefined does not throw", prettyName(undefined), "Unknown item")

console.log("\n— describing one item —")
const pick = describeItem(item("minecraft:diamond_pickaxe", 1, {
    nameTag: "§bVein Ripper",
    lore: ["Not from around here"],
    enchants: [{ type: { id: "minecraft:fortune" }, level: 3 }],
    durability: { damage: 1461, maxDurability: 1561 }
}), { kind: "slot", index: 0 })

check("a custom name wins over the type name", pick.label, "§bVein Ripper")
check("and is flagged as renamed", pick.renamed, true)
check("enchantments are read and prettified", pick.enchants, [{ id: "Fortune", level: 3 }])
check("lore comes through", pick.lore, ["Not from around here"])
check("durability is what is LEFT, not the damage", pick.durability.left, 100)
check("as a percentage too", pick.durability.percent, 6)

const plain = describeItem(item("minecraft:dirt", 64), { kind: "slot", index: 1 })
check("a plain item is not marked renamed", plain.renamed, false)
check("no enchantments reads as none, not undefined", plain.enchants, [])
check("no durability component means no durability line", plain.durability, undefined)
check("an empty slot describes as nothing", describeItem(undefined, { kind: "slot", index: 2 }), undefined)

console.log("\n— an item that refuses to answer is still listed —")
const hostile = {
    typeId: "minecraft:beacon", amount: 1,
    getLore: () => { throw new Error("nope") },
    getComponent: () => { throw new Error("nope") }
}
const survived = describeItem(hostile, { kind: "slot", index: 3 })
check("it still describes", survived.label, "Beacon")
check("with empty lore rather than a crash", survived.lore, [])
check("and no enchantments", survived.enchants, [])

console.log("\n— where a slot is —")
check("slot 0 is the first hotbar slot", slotLabel({ kind: "slot", index: 0 }), "Hotbar 1")
check("slot 8 is the last one", slotLabel({ kind: "slot", index: 8 }), "Hotbar 9")
check("slot 9 has left the hotbar", slotLabel({ kind: "slot", index: 9 }), "Slot 10")
check("equipment is named, not numbered", slotLabel({ kind: "equipment", slot: EquipmentSlot.Head }), "Head")

console.log("\n— the whole inventory —")
const carrying = fakePlayer(
    { 0: item("minecraft:diamond_sword"), 4: item("minecraft:cooked_beef", 32), 20: item("minecraft:dirt", 64) },
    { [EquipmentSlot.Chest]: item("minecraft:elytra"), [EquipmentSlot.Head]: item("minecraft:diamond_helmet") }
)
const snap = snapshot(carrying)
check("readable", snap.readable, true)
check("empty slots are skipped, not listed as blanks", snap.stacks, 3)
check("amounts are totalled, not stack-counted", snap.items, 1 + 32 + 64)
check("worn pieces counted", snap.worn, 2)
check("every equipment slot is represented, worn or not", snap.equipment.length, EQUIPMENT.length)
check("an empty equipment slot holds no item", snap.equipment.find(e => e.slot === EquipmentSlot.Feet).item, undefined)
check("slots keep their position", snap.slots.map(s => s.ref.index), [0, 4, 20])

console.log("\n— an unreadable inventory is not an empty one —")
const gone = snapshot(fakePlayer({}, {}, { noInventory: true }))
check("readable is false", gone.readable, false)
check("rather than quietly reading as empty", gone.stacks, 0)

console.log("\n— taking an item —")
const victim = fakePlayer({ 0: item("minecraft:netherite_sword") })
const staff = fakePlayer({})
const took = transfer(staff, victim, { kind: "slot", index: 0 })
check("it works", took.ok, true)
check("it says what was taken", took.item.label, "Netherite Sword")
check("it left their inventory", itemAt(victim, { kind: "slot", index: 0 }), undefined)
check("and arrived in yours", !!staff.__contents[99], true)
check("taking from an empty slot is refused", transfer(staff, victim, { kind: "slot", index: 0 }).ok, false)

console.log("\n— a full inventory must not eat the item —")
const fullStaff = fakePlayer({})
fullStaff.getComponent = ((original) => (id) => {
    const component = original(id)
    if (id === "minecraft:inventory") {
        // addItem returns the leftover when it could not fit — the real API's
        // way of saying "no room".
        return { container: { ...component.container, addItem: (stack) => stack } }
    }
    return component
})(fullStaff.getComponent)

const holder = fakePlayer({ 0: item("minecraft:totem_of_undying") })
const refused = transfer(fullStaff, holder, { kind: "slot", index: 0 })
check("the transfer is refused", refused.ok, false)
check("and says why", /full/.test(refused.reason), true)
check("crucially, they still have it", itemAt(holder, { kind: "slot", index: 0 })?.typeId, "minecraft:totem_of_undying")

console.log("\n— destroying an item —")
const doomed = fakePlayer({ 3: item("minecraft:tnt", 12) }, { [EquipmentSlot.Head]: item("minecraft:carved_pumpkin") })
const blown = confiscate(doomed, { kind: "slot", index: 3 })
check("it works", blown.ok, true)
check("it reports the stack it destroyed", blown.item.amount, 12)
check("the slot is empty", itemAt(doomed, { kind: "slot", index: 3 }), undefined)

const unhatted = confiscate(doomed, { kind: "equipment", slot: EquipmentSlot.Head })
check("worn items can be destroyed too", unhatted.ok, true)
check("and come off", itemAt(doomed, { kind: "equipment", slot: EquipmentSlot.Head }), undefined)
check("destroying an empty slot is refused", confiscate(doomed, { kind: "slot", index: 3 }).ok, false)

console.log("\n— the one-line summary —")
check("plain item", itemLine(describeItem(item("minecraft:stone"), {})), "Stone")
check("a stack says how many", itemLine(describeItem(item("minecraft:stone", 64), {})), "Stone x64")
check("the tells are named", itemLine(pick), "§bVein Ripper, 1 enchant, renamed")
check("nothing is nothing", itemLine(undefined), "nothing")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
