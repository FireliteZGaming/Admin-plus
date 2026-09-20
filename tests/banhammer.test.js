import { ItemStack, __test } from "@minecraft/server"
import {
    HAMMER_ITEM, HAMMER_NAME, worldToken, loreFor, isBanHammer, makeBanHammer
} from "../Admin+ BP/scripts/core/banhammer.js"
import { swing } from "../Admin+ BP/scripts/features/banhammer.js"
import { applyPreset, setRanks } from "../Admin+ BP/scripts/core/ranks.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

console.log("\n— what it is —")
const hammer = makeBanHammer()
check("a real vanilla mace, not a custom item", hammer.typeId, "minecraft:mace")
check("minecraft:mace specifically", HAMMER_ITEM, "minecraft:mace")
check("named in dark red and deep purple", hammer.nameTag, HAMMER_NAME)
check("which is what was asked for", HAMMER_NAME, "§4Ban §5Hammer")
check("one hammer, not a stack", hammer.amount, 1)
check("it carries the signature", isBanHammer(hammer), true)

console.log("\n— the shimmer —")
const enchants = hammer.getComponent("minecraft:enchantable").getEnchantments()
check("exactly one enchantment", enchants.length, 1)
check("and it is Curse of Vanishing", enchants[0].type.id, "vanishing")
check("at level one", enchants[0].level, 1)

console.log("\n— a renamed mace is just a mace —")
// The whole point. Anyone can type the name into an anvil; nobody can write
// lore, because Bedrock gives players no way to do it.
const forged = new ItemStack("minecraft:mace", 1)
forged.nameTag = HAMMER_NAME
check("right item, right name, no lore", isBanHammer(forged), false)

forged.setLore(["§8Issued by Admin+"])
check("even lore without the serial fails", isBanHammer(forged), false)

forged.setLore(["§8Issued by Admin+ · #000000"])
check("a wrong serial fails", isBanHammer(forged), false)

forged.setLore(loreFor())
check("the real serial is what makes it real", isBanHammer(forged), true)

console.log("\n— everything else is refused —")
const wrongItem = new ItemStack("minecraft:netherite_sword", 1)
wrongItem.nameTag = HAMMER_NAME
wrongItem.setLore(loreFor())
check("a sword with the right name and lore is not it", isBanHammer(wrongItem), false)

const wrongName = new ItemStack("minecraft:mace", 1)
wrongName.nameTag = "Ban Hammer"          // no colour codes
wrongName.setLore(loreFor())
check("the name has to match exactly, colours included", isBanHammer(wrongName), false)

const plain = new ItemStack("minecraft:mace", 1)
check("a plain mace is not it", isBanHammer(plain), false)
check("nothing at all is not it", isBanHammer(undefined), false)
check("null is not it", isBanHammer(null), false)

console.log("\n— an item that will not answer does not crash the check —")
const hostile = {
    typeId: "minecraft:mace",
    nameTag: HAMMER_NAME,
    getLore: () => { throw new Error("nope") }
}
check("it is simply not the hammer", isBanHammer(hostile), false)

console.log("\n— the serial —")
const token = worldToken()
check("it is six hex characters", /^[0-9a-f]{6}$/.test(token), true)
check("and stable across calls", worldToken(), token)
check("the lore carries it", loreFor()[0].includes(`#${token}`), true)
check("and explains itself in the tooltip", loreFor().length, 2)
check("two hammers from the same world match",
    isBanHammer(makeBanHammer()) && isBanHammer(makeBanHammer()), true)


console.log("\n— an operator is never a valid target —")
// Asked for 2026-09-20: "ops should not be able to use ban hammer on each
// other, op is exempt from ban hammer."
//
// The LADDER cannot express this, which is why it is a separate gate.
// canActOn is equal-or-below, so two operators on the same rank could hammer
// each other; and an operator holding NO rank is below everybody, which makes
// the person who owns the world the easiest target in it.
{
    applyPreset("server")
    const make = (id, rank, op) => {
        const p = {
            id, name: id, nameTag: id,
            commandPermissionLevel: op ? 1 : 0,
            getTags: () => [], addTag: () => true, removeTag: () => false,
            sendMessage: () => {},
            getComponent: () => ({ getEquipment: () => makeBanHammer() })
        }
        __test.players.push(p)
        if (rank) setRanks(p.id, [rank], p.name)
        return p
    }

    const owner   = make("HammerOwner", "owner", false)
    const opPeer  = make("HammerOpPeer", "owner", true)
    const opBare  = make("HammerOpBare", null, true)
    const victim  = make("HammerTarget", "member", false)

    const r1 = await swing(owner, opPeer)
    check("an owner cannot hammer an operator on the same rank", r1.ok, false)
    check("and it says why", r1.reason, "operator")

    // The case the ladder gets exactly backwards.
    const r2 = await swing(owner, opBare)
    check("nor one holding no rank at all", r2.ok, false)
    check("which the ladder would have allowed", r2.reason, "operator")

    // An operator SWINGING is unaffected - the exemption is about being hit.
    const r3 = await swing(opPeer, victim)
    check("but an operator can still swing at somebody who is not one",
        r3.reason !== "operator", true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
