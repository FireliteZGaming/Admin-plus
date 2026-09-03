import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
import { OP_BLOCKS, getOpBlock, opBlockNames, giveOpBlock } from "../Admin+ BP/scripts/core/opblocks.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name, { full = false } = {}) {
    const slots = []
    const p = {
        id: `ob${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [], addTag: () => true, removeTag: () => true,
        sendMessage: () => { },
        getComponent: id => id === "minecraft:inventory"
            ? {
                container: {
                    addItem: stack => {
                        // full inventories hand the whole stack straight back
                        if (full) return stack
                        slots.push(stack)
                        return undefined
                    }
                }
            }
            : undefined,
        _slots: slots
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const admin = fakePlayer("Admin"); setRanks(admin.id, ["admin"], admin.name)
const mod = fakePlayer("Mod"); setRanks(mod.id, ["mod"], mod.name)
const member = fakePlayer("Member"); setRanks(member.id, ["member"], member.name)

console.log("\n— the catalogue —")
check("barrier is offered", !!getOpBlock("barrier"), true)
check("so is deny", !!getOpBlock("deny"), true)
check("and allow", !!getOpBlock("allow"), true)
check("ids are fully qualified", getOpBlock("barrier").id, "minecraft:barrier")
check("a namespaced id resolves too", getOpBlock("minecraft:deny").id, "minecraft:deny")
check("so does the label", getOpBlock("Border").id, "minecraft:border_block")
check("nonsense resolves to nothing", getOpBlock("cheese"), undefined)
check("every entry explains itself", OP_BLOCKS.every(b => b.what.length > 20), true)

// Command blocks, structure blocks and jigsaws are excluded on purpose: their
// whole point is the UI you get on tapping them, and the GAME gates that UI on
// operator status. Handing one to a non-op gives them a block they cannot open.
console.log("\n— what is deliberately not offered —")
for (const id of ["command_block", "structure_block", "jigsaw", "chain_command_block"]) {
    check(`${id} is not handed out`, getOpBlock(id), undefined)
}

console.log("\n— the vocabulary the command tab-completes —")
check("names are short, not namespaced",
    opBlockNames().every(n => !n.includes(":")), true)
check("and there is one per block", opBlockNames().length, OP_BLOCKS.length)

console.log("\n— handing them out —")
const given = giveOpBlock(admin, "barrier", 16)
check("it works", given.ok, true)
check("and reports how many", given.given, 16)
check("the stack really went in", admin._slots[0].typeId, "minecraft:barrier")
check("with the right count", admin._slots[0].amount, 16)

console.log("\n— what it refuses —")
check("an unknown block", giveOpBlock(admin, "cheese").ok, false)
check("with a reason worth printing", giveOpBlock(admin, "cheese").reason.includes("cheese"), true)
check("a count is clamped up", giveOpBlock(admin, "deny", 0).given, 1)
check("and clamped down", giveOpBlock(admin, "deny", 9999).given, 64)
const stuck = fakePlayer("Stuck", { full: true })
check("a full inventory is reported, not silently dropped",
    giveOpBlock(stuck, "barrier", 4), { ok: false, reason: "Your inventory is full." })

console.log("\n— the node —")
// The whole point: these need operator in vanilla, and a rank covers them here.
const nodes = Object.values(PERMISSION_NODES).flat()
check("admin.opblocks is declared", nodes.includes("admin.opblocks"), true)
check("and sits with the staff tools",
    PERMISSION_NODES["Staff tools"].includes("admin.opblocks"), true)
check("it is listed exactly once", nodes.filter(x => x === "admin.opblocks").length, 1)
check("an Admin may take them", has(admin, "admin.opblocks"), true)
check("a Mod may not — it is a spawn-protection job", has(mod, "admin.opblocks"), false)
check("and a member certainly may not", has(member, "admin.opblocks"), false)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
