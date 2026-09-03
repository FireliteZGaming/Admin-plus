import { ChestForm, chestUIAvailable, measureCustomItems } from "../Admin+ BP/scripts/core/chestUI.js"
import { ITEM_TEXTURES, textureFor } from "../Admin+ BP/scripts/core/itemTextures.js"
import { typeIdToID, typeIdToDataId } from "../Admin+ BP/scripts/core/typeIds.js"
import { WORN_SLOT } from "../Admin+ BP/scripts/features/invsee.js"
import { EquipmentSlot } from "@minecraft/server"
import { setting, setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— the id table loaded —")
check("it is available", chestUIAvailable(), true)
check("thousands of vanilla ids", typeIdToID.size > 1000, true)
check("a common item resolves", typeIdToID.get("minecraft:diamond_sword") !== undefined, true)
check("so does a recent one", typeIdToID.get("minecraft:mace") !== undefined, true)

console.log("\n— the sentinel title, which the resource pack matches on —")
// These exact strings are the wire format. A refactor that "tidies" them turns
// the chest into a list of gibberish, and nothing else would catch it.
const form = new ChestForm("large").title("Steve's inventory")
const built = form.preview()
check("it opens with the 54-slot sentinel", built.title.startsWith("\u00a7s\u00a7h\u00a7o\u00a7p\u00a7c\u00a7h\u00a7e\u00a7s\u00a7t\u00a7r"), true)
check("the real title follows the split marker", built.title.includes("\u00a7m\u00a7c\u00a7e\u00a7rSteve's inventory"), true)
check("small has its own sentinel",
    new ChestForm("small").preview().title.startsWith("\u00a7c\u00a7h\u00a7e\u00a7s\u00a7t\u00a7s\u00a7m\u00a7a\u00a7l\u00a7l\u00a7r"), true)
check("large is 54 slots", form.size, 54)
check("small is 27", new ChestForm("small").size, 27)
check("an unknown size falls back to large", new ChestForm("nonsense").size, 54)

console.log("\n— the numeric encoding, which blocks still use —")
// (id * 65536), plus 32768 when enchanted. Only BLOCKS come down this path now,
// so the arithmetic is exercised with one.
const stoneId = typeIdToDataId.get("minecraft:stone") ?? typeIdToID.get("minecraft:stone")
check("a block has a numeric id", typeof stoneId, "number")

const plain = new ChestForm("large")
    .button(0, "Stone", ["grey"], "minecraft:stone", 1, false)
    .preview().buttons[0]
check("the icon is the encoded number", plain.icon, stoneId * 65536)
check("the name is in the button text", plain.text.includes("Stone"), true)
check("and so is the tooltip line", plain.text.includes("grey"), true)

const shiny = new ChestForm("large")
    .button(0, "Stone", [], "minecraft:stone", 1, true)
    .preview().buttons[0]
check("enchanted adds exactly 32768", shiny.icon - plain.icon, 32768)

const stacked = new ChestForm("large")
    .button(3, "Cooked Beef", [], "minecraft:cooked_beef", 7)
    .preview().buttons[3]
check("the stack count is zero-padded to two digits", stacked.text.startsWith("stack#07"), true)
check("the durability field is there even at zero", stacked.text.includes("dur#00"), true)
check("a stack over 99 is clamped",
    new ChestForm("large").button(0, "x", [], "minecraft:stone", 400).preview().buttons[0].text.startsWith("stack#99"), true)
check("a nonsense stack still renders as one",
    new ChestForm("large").button(0, "x", [], "minecraft:stone", 0).preview().buttons[0].text.startsWith("stack#01"), true)

check("empty slots carry no icon at all",
    new ChestForm("large").preview().buttons[7].icon, undefined)

console.log("\n— items are drawn from a texture PATH, not a registry index —")
// The whole point of the rewrite. A path means the same thing on every build;
// a registry index does not, which is how a 1.21.130 table drew an acacia boat
// as pink dye on a 1.26.45 client, with the error GROWING as the id rose so no
// offset could correct it. itemTextures.js is generated from the installed
// game and every path in it was checked against a real PNG.
check("the map is populated", ITEM_TEXTURES.size > 400, true)
check("the boat that started this", textureFor("minecraft:acacia_boat"), "textures/items/boat_acacia")
check("and the shovel", textureFor("minecraft:copper_shovel"), "textures/items/copper_shovel")
check("the dye it was drawing instead", textureFor("minecraft:pink_dye"), "textures/items/dye_powder_pink")
check("every value is a real texture path",
    [...ITEM_TEXTURES.values()].every(p => p.startsWith("textures/")), true)
check("and every key is a namespaced id",
    [...ITEM_TEXTURES.keys()].every(k => k.startsWith("minecraft:")), true)

const iconOf = (id) => new ChestForm("large").button(0, "x", [], id).preview().buttons[0].icon
check("an item sends the path", iconOf("minecraft:acacia_boat"), "textures/items/boat_acacia")
check("which the pack renders because it starts with textures",
    String(iconOf("minecraft:acacia_boat")).startsWith("textures"), true)

// BLOCKS keep the numeric route: their icon is a 3D render of the model, which
// a flat texture cannot stand in for. They were never affected by the drift.
check("a block has no path", textureFor("minecraft:stone"), undefined)
check("so it falls back to a number", typeof iconOf("minecraft:stone"), "number")

// The offset only touches what still goes down the numeric route.
check("the offset ships at zero", setting("invsee.iconOffset"), "0")
setSetting("invsee.iconOffset", "25")
check("and cannot disturb an item drawn from a path",
    iconOf("minecraft:acacia_boat"), "textures/items/boat_acacia")
resetSetting("invsee.iconOffset")

check("an unknown id still falls back rather than throwing",
    iconOf("minecraft:not_a_real_item"), "minecraft:not_a_real_item")

console.log("\n— slots —")
check("a slot outside the grid is ignored",
    new ChestForm("large").button(99, "x", [], "minecraft:stone").size, 54)
check("a negative slot too",
    new ChestForm("large").button(-1, "x", [], "minecraft:stone").size, 54)

console.log("\n— where worn pieces sit in the grid —")
// Bottom two rows, the way every chest-UI addon lays armour out.
check("head", WORN_SLOT[EquipmentSlot.Head], 36)
check("chest", WORN_SLOT[EquipmentSlot.Chest], 37)
check("legs", WORN_SLOT[EquipmentSlot.Legs], 38)
check("feet", WORN_SLOT[EquipmentSlot.Feet], 39)
check("offhand sits at the end of the last row", WORN_SLOT[EquipmentSlot.Offhand], 44)
check("none of them collide with the 36 inventory slots",
    Object.values(WORN_SLOT).every(s => s >= 36 && s < 54), true)
check("and none collide with each other",
    new Set(Object.values(WORN_SLOT)).size, Object.keys(WORN_SLOT).length)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
