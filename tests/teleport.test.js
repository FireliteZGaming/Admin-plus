import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting, setting, flag } from "../Admin+ BP/scripts/core/settings.js"
import { cooldownLeft, markUsed, queueTeleport, isTeleporting, cancelTeleport } from "../Admin+ BP/scripts/core/teleport.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `t${nextId++}`, name, nameTag: name, inbox: [], commandPermissionLevel: 0,
        location: { x: 0, y: 64, z: 0 }, dimension: { id: "minecraft:overworld" },
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(m), teleport: () => {}
    }
    __test.players.push(p)
    return p
}

const member = fakePlayer("Member") ; onPlayerJoin(member)
const modder = fakePlayer("Modder") ; onPlayerJoin(modder) ; setRanks(modder.id, ["mod"], modder.name)

console.log("\n— the default cooldown applies when a rank sets none —")
saveRank("member", { meta: {} })                    // no tpCooldown of its own
setSetting("teleport.cooldown", "8")
check("nothing owed before the first teleport", cooldownLeft(member), 0)
markUsed(member)
check("then the default is owed", cooldownLeft(member), 8)

console.log("\n— a rank's own cooldown beats the default —")
saveRank("member", { meta: { tpCooldown: 20 } })
check("rank value wins", cooldownLeft(member), 20)
saveRank("member", { meta: {} })

console.log("\n— staff are exempt, and that is switchable —")
markUsed(modder)
check("staff wait nothing", cooldownLeft(modder), 0)
setSetting("staff.exemptCooldowns", "false")
check("turning the exemption off makes them wait", cooldownLeft(modder), 8)
setSetting("staff.exemptCooldowns", "true")
check("and back on again", cooldownLeft(modder), 0)

console.log("\n— cooldown blocks a queued teleport —")
let fired = 0
check("a member on cooldown is refused", queueTeleport(member, "spawn", () => fired++), false)
check("and nothing ran", fired, 0)
check("the refusal was explained", member.inbox.at(-1).includes("Wait"), true)

console.log("\n— zero warmup fires immediately —")
setSetting("teleport.cooldown", "0")
setSetting("teleport.warmup", "0")
check("accepted", queueTeleport(member, "spawn", () => fired++), true)
check("and ran on the spot", fired, 1)
check("nothing left pending", isTeleporting(member), false)

console.log("\n— warmup defers instead —")
setSetting("teleport.warmup", "3")
check("staff skip the warmup entirely", queueTeleport(modder, "spawn", () => fired++) && fired, 2)
resetSetting("teleport.warmup")
resetSetting("teleport.cooldown")
resetSetting("staff.exemptCooldowns")

console.log("\n— the tuning values read back —")
check("warmup default", setting("teleport.warmup"), "2")
check("cooldown default", setting("teleport.cooldown"), "3")
check("cancel-on-move default", flag("teleport.cancelOnMove"), true)
check("tpa expiry default", setting("tpa.expire"), "60")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
