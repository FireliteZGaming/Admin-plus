import { readFileSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import {
    onPlayerJoin, setRanks, applyPreset, CREATOR_GAMERTAG,
    developerGamertags, testerGamertags, __setTeamDevelopers
} from "../Admin+ BP/scripts/core/ranks.js"
import { canUseConsole } from "../Admin+ BP/scripts/features/console.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"

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
check("a world's own dev — Dev tag AND operator — can", canUseConsole(devOp), true)
check("a plain member CANNOT", canUseConsole(member), false)
check("nor can an Admin who is not the creator and has no Dev tag", canUseConsole(admin), false)

// BOTH locks. The tag on its own is something any staff member with /tag can
// hand out, so a tag-only gate would have let a moderator promote a member into
// a command line. It required only the tag until 2.1.1; this is that hole.
const devNoOp = fakePlayer("TaggedMember", { op: false, dev: true })
check("the Dev tag WITHOUT operator is refused", canUseConsole(devNoOp), false)
check("and operator without the tag is refused too",
    canUseConsole(fakePlayer("PlainOp", { op: true })), false)

console.log("\n— the Admin+ team —")
// [Admin+ Creator] and [Admin+ Dev] are the two badges that travel with the
// pack, and they are the only identities that reach the console without being
// anything in the world at all.
__setTeamDevelopers(["EmployedDev"])
const teamDev = fakePlayer("EmployedDev")
check("a team developer can, holding no rank and no op", canUseConsole(teamDev), true)
check("the match ignores case",
    canUseConsole(fakePlayer("employeddev")), true)
check("somebody merely NAMED like one cannot",
    canUseConsole(fakePlayer("EmployedDev2")), false)
check("and the owner's off switch still closes it for them", (() => {
    setSetting("creator.console", "false")
    const shut = canUseConsole(teamDev)
    resetSetting("creator.console")
    return shut
})(), false)
__setTeamDevelopers([])
check("taking them off the team takes the console with it", canUseConsole(teamDev), false)
// Testers wear a badge and nothing more.
check("a tester gets no console", canUseConsole(fakePlayer(testerGamertags()[0])), false)

// Vacuous while the shipped list is empty, and that is the point: it arms
// itself the day a real gamertag is added, so nobody ships a team member who
// silently does not work.
for (const tag of developerGamertags()) {
    check(`the shipped team member ${tag} really gets in`,
        canUseConsole(fakePlayer(tag)), true)
}

console.log("\n— the owner's off switch closes it for everyone —")
setSetting("creator.console", "false")
check("the Creator is shut out too", canUseConsole(creator), false)
check("and the Dev", canUseConsole(devOp), false)
setSetting("creator.console", "true")
check("and back on again", canUseConsole(creator), true)
resetSetting("creator.console")
check("the shipped default is ON", canUseConsole(creator), true)

console.log("\n— it runs Admin+ commands only —")
// Since 2.8.2 the console runs no vanilla command at all. It used to fall
// through to runAsServer and promise to stay inside the owner's whitelist, but
// that whitelist had stopped being checked, so in practice it reached any
// vanilla command short of /op. Admin+'s own commands each check the person's
// rank, so the console reaches nothing they could not have typed themselves.
// The source checks below pin that: no runAsServer, no runCommand.

console.log("\n— the three promises the badge rule makes, in the source —")
// These are asserted by reading the code because they are the fence, and a
// refactor that quietly dropped one would turn this back into a backdoor with
// nothing to catch it.
const src = readFileSync(new URL("../Admin+ BP/scripts/features/console.js", import.meta.url), "utf8")
check("it is gated on the opt-out setting", src.includes('flag("creator.console")'), true)
check("it runs no vanilla command: no runAsServer, no runCommand",
    !src.includes("runAsServer(") && !src.includes("runCommand("), true)
check("it runs Admin+ commands through the dispatcher", src.includes("runPackCommand(player, line)"), true)
check("it writes to the audit log", src.includes('record(player, "creator.console"'), true)
check("and it announces to online owners", src.includes("onlineOwners") && src.includes("owner.sendMessage"), true)

// The gate is re-checked inside the screen, not just when the button is drawn —
// the owner could revoke while it sits open.
check("the screen re-checks the gate on entry",
    src.includes("if (!canUseConsole(player))"), true)

// The team list lives in the source so that adding somebody is a release an
// owner can read in the changelog. A `let` plus a test hook is the only reason
// that could stop being true, so nothing in the pack may call the hook.
console.log("\n— nothing in the pack can rewrite the team list —")
const bp = new URL("../Admin+ BP/scripts/", import.meta.url)
function scripts(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir)
        if (entry.isDirectory()) scripts(child, out)
        else if (entry.name.endsWith(".js")) out.push([entry.name, readFileSync(child, "utf8")])
    }
    return out
}
const mentions = scripts(bp).filter(([, text]) => text.includes("__setTeamDevelopers"))
check("only the file that defines it mentions it at all",
    mentions.map(([name]) => name), ["ranks.js"])
check("and that file only defines it, never calls it",
    (mentions[0]?.[1].match(/__setTeamDevelopers/g) ?? []).length, 1)

console.log("\n— it never appears for a member in /menu —")
const menuSrc = readFileSync(new URL("../Admin+ BP/scripts/features/menu.js", import.meta.url), "utf8")
check("the button is behind canUseConsole", menuSrc.includes("if (canUseConsole(player))"), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
