import { readFileSync, existsSync } from "node:fs"
import { __test } from "@minecraft/server"
import { isBeta, adminMenus, menusName } from "../Admin+ BP/scripts/core/channel.js"

// The pack settings slider. Default and Beta from 2.10.1; since 2.12.10 it
// picks the menus, Admin+'s own or Minecraft's (the user: Beta "should become
// the default look yes, but we have to add a switch that can switch it to
// normal"). It is the behaviour pack's subpacks, which the game shows as a
// slider in the pack's settings; each adds a hidden marker item, which is how
// scripts tell them apart.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const bp = new URL("../Admin+ BP/", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("manifest.json", bp), "utf8"))

console.log("\n— the slider —")
const subpacks = manifest.subpacks ?? []
// The game picks a new world's subpack by memory_performance_tier, which needs
// manifest version 3, so ours tie, and Microsoft's docs: "In the case of a tie,
// the system selects the last subpack listed of that tier."
check("two subpacks, with Admin+ menus last, so new worlds start on it", subpacks.map(s => s.name), ["Minecraft menus", "Admin+ menus"])
check("the folders keep their old names, so a world keeps its menus", subpacks.map(s => s.folder_name), ["default", "beta"])
check("on the same tier, so they tie and the game starts on the last one",
    subpacks.map(s => s.memory_tier), [0, 0])
check("no tier the game could rank them by instead",
    subpacks.some(s => "memory_performance_tier" in s), false)
check("and the manifest stays version 2", manifest.format_version, 2)
for (const s of subpacks) {
    const marker = new URL(`subpacks/${s.folder_name}/items/channel_${s.folder_name}.json`, bp)
    check(`${s.name}'s folder holds its marker item`, existsSync(marker), true)
    if (existsSync(marker)) {
        const item = JSON.parse(readFileSync(marker, "utf8"))["minecraft:item"]
        check(`and it never shows in the creative menu`, item.description.menu_category?.category, "none")
        check(`with the id scripts look for`, item.description.identifier, `adminplus:channel_${s.folder_name}`)
    }
}

console.log("\n— scripts can tell which one is on —")
check("with no marker, Minecraft's menus", [adminMenus(), menusName()], [false, "Minecraft menus"])
__test.itemTypes.push({ id: "adminplus:channel_beta" })
check("with the marker, Admin+ menus", [adminMenus(), menusName()], [true, "Admin+ menus"])
__test.itemTypes.splice(__test.itemTypes.findIndex(t => t.id === "adminplus:channel_beta"), 1)
check("and back", adminMenus(), false)
check("no feature is Beta-only since 2.12.10", isBeta(), false)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
