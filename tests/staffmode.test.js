import { __test, ItemStack } from "@minecraft/server"
import {
    enter, exit, inStaffMode, needsRebuild, staffModeList,
    serializeStack, buildStack, snapshotOf, countItems, liveInventory,
    containerOf, __forgetLive, markVanished, vanishedByStaffMode
} from "../Admin+ BP/scripts/core/staffmode.js"
import {
    TOOLS, makeTool, toolFor, toolBar, HAMMER_SLOT, HAMMER_NAME
} from "../Admin+ BP/scripts/features/staffmode.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// A player whose inventory behaves like the real one: a fixed-size container
// that hands back the SAME object you put in, which is what makes the
// lossless-restore test meaningful.
let nextId = 1
function fakePlayer(name, { readable = true } = {}) {
    const slots = new Array(36).fill(undefined)
    const worn = {}
    const player = {
        id: `p${nextId++}`, name, inbox: [],
        sendMessage: m => player.inbox.push(m),
        getComponent(id) {
            if (!readable) throw new Error("inventory unavailable")
            if (id === "minecraft:inventory") {
                return {
                    container: {
                        size: 36,
                        getItem: i => slots[i],
                        setItem: (i, stack) => { slots[i] = stack }
                    }
                }
            }
            if (id === "minecraft:equippable") {
                return {
                    getEquipment: slot => worn[slot],
                    setEquipment: (slot, stack) => { worn[slot] = stack }
                }
            }
            return undefined
        }
    }
    player._slots = slots
    player._worn = worn
    __test.players.push(player)
    return player
}

function stack(typeId, amount = 1, name, lore) {
    const s = new ItemStack(typeId, amount)
    if (name) s.nameTag = name
    if (lore) s.setLore(lore)
    return s
}

console.log("\n— serialising one item —")
const fancy = stack("minecraft:diamond_sword", 1, "§bSting", ["a gift"])
fancy.getComponent("minecraft:enchantable").addEnchantment({ type: { id: "sharpness" }, level: 5 })
const flat = serializeStack(fancy)
check("type and count survive", [flat.id, flat.n], ["minecraft:diamond_sword", 1])
check("the name survives", flat.name, "§bSting")
check("the lore survives", flat.lore, ["a gift"])
check("enchantments survive", flat.ench, [{ id: "sharpness", lvl: 5 }])
check("an empty slot serialises to null", serializeStack(undefined), null)

const rebuilt = buildStack(flat)
check("it rebuilds as the same item", [rebuilt.typeId, rebuilt.amount], ["minecraft:diamond_sword", 1])
check("with its name", rebuilt.nameTag, "§bSting")
check("with its lore", rebuilt.getLore(), ["a gift"])
check("nothing rebuilds from nothing", buildStack(null), undefined)

console.log("\n— entering staff mode —")
const mod = fakePlayer("Mod")
mod._slots[0] = stack("minecraft:diamond", 64)
mod._slots[5] = stack("minecraft:elytra")
mod._slots[35] = stack("minecraft:totem_of_undying")
mod._worn.head = stack("minecraft:diamond_helmet")
const originals = [mod._slots[0], mod._slots[5], mod._slots[35], mod._worn.head]

const before = snapshotOf(mod)
check("the snapshot counts every stack, worn ones included", countItems(before), 4)

const tools = TOOLS.map(def => ({ slot: def.slot, stack: makeTool(def) }))
const started = enter(mod, tools)
check("entering succeeds", started.ok, true)
check("and says how much it stowed", started.stowed, 4)
check("they are in staff mode", inStaffMode(mod), true)
check("their own items are gone from the container", [mod._slots[5], mod._slots[35]], [undefined, undefined])
check("worn items are off too", mod._worn.head, undefined)
check("the tools are in place", TOOLS.map(t => mod._slots[t.slot]?.typeId), TOOLS.map(t => t.id))

console.log("\n— entering twice does nothing —")
const again = enter(mod, tools)
check("the second attempt is refused", again.ok, false)
check("and the tools are still the only thing held", mod._slots[0].typeId, TOOLS[0].id)

console.log("\n— leaving gives back the ORIGINAL objects —")
const stopped = exit(mod)
check("leaving succeeds", stopped.ok, true)
check("it was lossless", stopped.lossless, true)
check("the same diamond stack object came back", mod._slots[0] === originals[0], true)
check("so did the elytra", mod._slots[5] === originals[1], true)
check("and the last slot", mod._slots[35] === originals[2], true)
check("and the helmet", mod._worn.head === originals[3], true)
check("no tool was left behind", mod._slots[8], undefined)
check("they are out of staff mode", inStaffMode(mod), false)
check("leaving twice is refused", exit(mod).ok, false)

console.log("\n— a world reload while in staff mode —")
const away = fakePlayer("Away")
away._slots[0] = stack("minecraft:netherite_pickaxe", 1, "§dDigger", ["earned"])
away._slots[0].getComponent("minecraft:enchantable").addEnchantment({ type: { id: "efficiency" }, level: 5 })
away._worn.chest = stack("minecraft:elytra")
enter(away, tools)

// This is exactly what a reload does: the flag is in world storage and lives,
// the real ItemStack objects were only ever in memory and do not.
__forgetLive(away)
check("the flag survived the reload", inStaffMode(away), true)
check("and it knows the originals are gone", needsRebuild(away), true)

const recovered = exit(away)
check("it still gives everything back", recovered.ok, true)
check("but says it was NOT lossless", recovered.lossless, false)
check("the pickaxe is back", away._slots[0]?.typeId, "minecraft:netherite_pickaxe")
check("with its name", away._slots[0]?.nameTag, "§dDigger")
check("with its lore", away._slots[0]?.getLore(), ["earned"])
check("worn gear is back too", away._worn.chest?.typeId, "minecraft:elytra")
check("and the flag is cleared", inStaffMode(away), false)

console.log("\n— an unreadable inventory changes nothing —")
const broken = fakePlayer("Broken", { readable: false })
check("the inventory really is unreadable", containerOf(broken), undefined)
check("liveInventory says so rather than saying empty", liveInventory(broken), undefined)
const refused = enter(broken, tools)
check("entering is refused", refused.ok, false)
check("and they are NOT flagged, so nothing is stranded", inStaffMode(broken), false)

console.log("\n— the staff mode list —")
const listed = fakePlayer("Listed")
listed._slots[0] = stack("minecraft:dirt", 1)
enter(listed, tools)
check("it names who is in staff mode", staffModeList().map(r => r.name), ["Listed"])
exit(listed)
check("and empties when they leave", staffModeList().length, 0)

console.log("\n— the tools are signed —")
const realTool = makeTool(TOOLS[0])
check("a minted tool is recognised", toolFor(realTool)?.key, TOOLS[0].key)
const forged = new ItemStack(TOOLS[0].id, 1)
forged.nameTag = TOOLS[0].name
check("the same item renamed by hand is not", toolFor(forged), undefined)
const wrongSerial = new ItemStack(TOOLS[0].id, 1)
wrongSerial.nameTag = TOOLS[0].name
wrongSerial.setLore(["blurb", "§8Admin+ staff tool · #000000"])
check("nor is one with the wrong serial", toolFor(wrongSerial), undefined)
check("nor is a plain item", toolFor(new ItemStack("minecraft:stick", 1)), undefined)
check("nor is nothing at all", toolFor(undefined), undefined)

console.log("\n— every tool is distinct —")
check("no two tools share a hotbar slot",
    new Set(TOOLS.map(t => t.slot)).size, TOOLS.length)
check("no two tools share an item type",
    new Set(TOOLS.map(t => t.id)).size, TOOLS.length)
check("every tool declares what it aims at",
    TOOLS.every(t => ["player", "block", "none"].includes(t.aim)), true)
check("every tool sits in the hotbar",
    TOOLS.every(t => t.slot >= 0 && t.slot < 9), true)

console.log("\n— the Ban Hammer rides in the bar, for some people —")
const plainBar = toolBar(false)
const armedBar = toolBar(true)
check("without permanent-ban permission the bar is just the tools",
    plainBar.length, TOOLS.length)
check("and holds no mace",
    plainBar.some(entry => entry.stack.typeId === "minecraft:mace"), false)
check("with it, one more thing is in the bar", armedBar.length, TOOLS.length + 1)
const hammerEntry = armedBar.find(entry => entry.slot === HAMMER_SLOT)
check("and that thing is the hammer", hammerEntry?.stack?.typeId, "minecraft:mace")
check("named as the hammer", hammerEntry?.stack?.nameTag, HAMMER_NAME)
check("the hammer's slot does not collide with a tool",
    TOOLS.some(t => t.slot === HAMMER_SLOT), false)
check("every bar entry sits in the hotbar",
    armedBar.every(entry => entry.slot >= 0 && entry.slot < 9), true)
// The hammer is not an itemUse tool and must never be mistaken for one, or a
// right-click would run a tool action while holding the thing that bans people.
check("the hammer is not recognised as an itemUse tool",
    toolFor(hammerEntry.stack), undefined)

console.log("\n— who vanished you, remembered across a reload —")
// Found by playtest, 2.0.0: reload the world while in staff mode and you came
// back with infinite invisibility, night vision, and still flagged vanished.
// The "staff mode is what vanished them" fact was a Set in memory, so the
// reload emptied it and the restore never un-vanished anybody. Only /vanish
// twice got you out. The fix is that it rides in the stored record instead —
// the same record the inventory snapshot already uses, for the same reason.
const ghost = fakePlayer("Ghost")
ghost._slots[0] = stack("minecraft:bread", 3)
enter(ghost, tools)

check("nothing claims to have vanished them yet", vanishedByStaffMode(ghost), false)
check("marking works once the record exists", markVanished(ghost, true), true)
check("and it reads back", vanishedByStaffMode(ghost), true)

__forgetLive(ghost)                       // the reload: memory goes, storage stays
check("the reload does NOT forget who vanished them", vanishedByStaffMode(ghost), true)

exit(ghost)
check("leaving staff mode clears it with the record", vanishedByStaffMode(ghost), false)

// Somebody already vanished when they entered is never marked, so they stay
// vanished on the way out — the behaviour the old Set was there to protect.
const own = fakePlayer("OwnVanish")
enter(own, tools)
check("an unmarked session leaves vanish alone", vanishedByStaffMode(own), false)
exit(own)

// Marking cannot invent a record for somebody who is not in staff mode.
const nobody = fakePlayer("Nobody")
check("marking somebody who never entered fails", markVanished(nobody, true), false)
check("and asking about them is false, not a throw", vanishedByStaffMode(nobody), false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
