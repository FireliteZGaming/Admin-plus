import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { judge, tally, describeTally, removableTypes, activeGroups, warnSeconds, valuables } from "../Admin+ BP/scripts/core/cleanup.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// Minimal stand-ins for entities.
const drop = (itemId, extra = {}) => ({
    typeId: "minecraft:item",
    getTags: () => extra.tags ?? [],
    nameTag: extra.nameTag,
    getComponent: () => ({ itemStack: { typeId: `minecraft:${itemId}`, nameTag: extra.itemName } })
})
const entity = (typeId, extra = {}) => ({
    typeId, nameTag: extra.nameTag, getTags: () => extra.tags ?? [], getComponent: () => undefined
})

console.log("\n— clutter goes —")
check("a dropped cobblestone", judge(drop("cobblestone")).remove, true)
check("an xp orb", judge(entity("minecraft:xp_orb")).remove, true)
check("a spent arrow", judge(entity("minecraft:arrow")).remove, true)

console.log("\n— the whitelist is the whole point: unknown types are safe —")
for (const type of [
    "minecraft:villager_v2", "minecraft:wolf", "minecraft:armor_stand", "minecraft:item_frame",
    "minecraft:boat", "minecraft:chest_minecart", "minecraft:horse", "minecraft:allay",
    "minecraft:ender_dragon", "soulbound:magic_circle", "someaddon:custom_thing"
]) {
    check(`${type.replace("minecraft:", "")} is left alone`, judge(entity(type)).remove, false)
}

console.log("\n— things people would be upset to lose —")
check("a named mob", judge(entity("minecraft:item", { nameTag: "Bessie" })).remove, false)
check("a renamed item", judge(drop("stone", { itemName: "Founder's Rock" })).remove, false)
check("a dropped shulker box", judge(drop("purple_shulker_box")).remove, false)
check("an elytra", judge(drop("elytra")).remove, false)
check("a totem", judge(drop("totem_of_undying")).remove, false)
check("netherite anything", judge(drop("netherite_sword")).remove, false)
check("a dropped trident", judge(drop("trident")).remove, false)
check("but plain dirt still goes", judge(drop("dirt")).remove, true)

console.log("\n— tags let a server protect its own things —")
for (const tag of ["keep", "persist", "admin:keep", "nolagclear", "KEEP"]) {
    check(`tagged ${tag}`, judge(drop("stone", { tags: [tag] })).remove, false)
}
check("an unrelated tag does not protect", judge(drop("stone", { tags: ["shop"] })).remove, true)

console.log("\n— groups can be switched off —")
setSetting("cleanup.items", "false")
check("items off means dropped items survive", judge(drop("dirt")).remove, false)
check("but orbs still go", judge(entity("minecraft:xp_orb")).remove, true)
setSetting("cleanup.items", "true")
check("back on", judge(drop("dirt")).remove, true)

check("falling blocks are OFF by default", judge(entity("minecraft:falling_block")).remove, false)
setSetting("cleanup.fallingBlocks", "true")
check("and only removable when asked for", judge(entity("minecraft:falling_block")).remove, true)
resetSetting("cleanup.fallingBlocks")

console.log("\n— everything off removes nothing —")
for (const k of ["cleanup.items", "cleanup.xp", "cleanup.projectiles"]) setSetting(k, "false")
check("no groups active", activeGroups().length, 0)
check("no removable types", removableTypes().length, 0)
check("so nothing is judged removable", judge(drop("dirt")).remove, false)
for (const k of ["cleanup.items", "cleanup.xp", "cleanup.projectiles"]) resetSetting(k)

console.log("\n— custom protected list —")
setSetting("cleanup.keep", "diamond, my_custom_item")
check("custom list replaces the defaults", judge(drop("diamond")).remove, false)
check("and the built-ins are no longer implied", judge(drop("elytra")).remove, true)
resetSetting("cleanup.keep")
check("blank restores the built-ins", judge(drop("elytra")).remove, false)

console.log("\n— counting for diagnosis —")
const rows = tally([
    entity("minecraft:chicken"), entity("minecraft:chicken"), entity("minecraft:chicken"),
    drop("dirt"), drop("dirt"), entity("minecraft:xp_orb")
])
check("sorted by how many", rows.map(r => r.type), ["chicken", "item", "xp_orb"])
check("worded", describeTally(rows), "3 chicken, 2 item, 1 xp orb")
check("empty reads sensibly", describeTally([]), "nothing worth mentioning")

console.log("\n— warning delay —")
check("defaults to 5s", warnSeconds(), 5)
setSetting("cleanup.warn", "0")
check("0 means clear at once", warnSeconds(), 0)
setSetting("cleanup.warn", "banana")
check("nonsense falls back", warnSeconds(), 5)
resetSetting("cleanup.warn")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
