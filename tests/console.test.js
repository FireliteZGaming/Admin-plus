import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, applyPreset, CREATOR_GAMERTAG } from "../Admin+ BP/scripts/core/ranks.js"
import { canUseConsole } from "../Admin+ BP/scripts/features/console.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { checkCommand } from "../Admin+ BP/scripts/core/execute.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name, { op = false, dev = false } = {}) {
    const tags = dev ? ["Dev"] : []
    const p = {
        id: `c${n++}`, name, nameTag: name,
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { if (!tags.includes(t)) tags.push(t); return true },
        removeTag: t => { const i = tags.indexOf(t); if (i >= 0) tags.splice(i, 1); return true },
        sendMessage: () => {},
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")

const creator = fakePlayer(CREATOR_GAMERTAG)
const devOp = fakePlayer("DevOp", { op: true, dev: true })
const member = fakePlayer("Member")
setRanks(member.id, ["member"], member.name)
const admin = fakePlayer("Admin")
setRanks(admin.id, ["admin"], admin.name)

console.log("\n— who can open the console —")
// The whole safety of this feature is here. A regular member reaching it turns
// a bounded creator convenience into a backdoor for everyone.
check("the Creator can", canUseConsole(creator), true)
check("somebody with the Dev tag can", canUseConsole(devOp), true)
check("a plain member CANNOT", canUseConsole(member), false)
check("nor can an Admin who is not the creator and has no Dev tag", canUseConsole(admin), false)

console.log("\n— the owner's off switch closes it for everyone —")
setSetting("creator.console", "false")
check("the Creator is shut out too", canUseConsole(creator), false)
check("and the Dev", canUseConsole(devOp), false)
setSetting("creator.console", "true")
check("and back on again", canUseConsole(creator), true)
resetSetting("creator.console")
check("the shipped default is ON", canUseConsole(creator), true)

console.log("\n— it can only run the owner's own whitelist —")
// The console runs through runAsServer -> checkCommand, the SAME gate /cmd
// uses, so it grants nothing the owner has not already exposed and cannot /op.
check("a whitelisted command passes", checkCommand("kill @e[type=cow]").ok, true)
check("op does NOT — it is never on the list", checkCommand("op Steve").ok, false)
check("nor deop", checkCommand("deop Steve").ok, false)
check("nor a command that runs another command", checkCommand("execute as @a run op @s").ok, false)

// If the owner narrows their whitelist, the console narrows with it — proof it
// is bounded by the owner's choice, not by anything hardcoded here.
setSetting("commands.allowed", "kill")
check("console can run what the owner allows", checkCommand("kill @e").ok, true)
check("and cannot run what they removed", checkCommand("give @s stone").ok, false)
setSetting("commands.allowed", "")
check("an empty whitelist means the console does nothing", checkCommand("kill @e").ok, false)
resetSetting("commands.allowed")

console.log("\n— the three promises the badge rule makes, in the source —")
// These are asserted by reading the code because they are the fence, and a
// refactor that quietly dropped one would turn this back into a backdoor with
// nothing to catch it.
const src = readFileSync(new URL("../Admin+ BP/scripts/features/console.js", import.meta.url), "utf8")
check("it is gated on the opt-out setting", src.includes('flag("creator.console")'), true)
check("it runs through the whitelist, not raw", src.includes("runAsServer") && !src.includes("dimension.runCommand"), true)
check("it writes to the audit log", src.includes('record(player, "creator.console"'), true)
check("and it announces to online owners", src.includes("onlineOwners") && src.includes("owner.sendMessage"), true)

// The gate is re-checked inside the screen, not just when the button is drawn —
// the owner could revoke while it sits open.
check("the screen re-checks the gate on entry",
    src.includes("if (!canUseConsole(player))"), true)

console.log("\n— it never appears for a member in /menu —")
const menuSrc = readFileSync(new URL("../Admin+ BP/scripts/features/menu.js", import.meta.url), "utf8")
check("the button is behind canUseConsole", menuSrc.includes("if (canUseConsole(player))"), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
