import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setActiveChannel, saveChannel } from "../Admin+ BP/scripts/core/channels.js"
import { broadcastTo } from "../Admin+ BP/scripts/features/broadcast.js"

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
        id: `b${nextId++}`, name, nameTag: name, commandPermissionLevel: 0,
        heard: [],
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: (text) => p.heard.push(text),
        runCommand: () => ({ successCount: 1 })
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

const admin = fakePlayer("Admin")
const mod = fakePlayer("Mod")
const member = fakePlayer("Member")
setRanks(admin.id, ["admin"], admin.name)
setRanks(mod.id, ["mod"], mod.name)
setRanks(member.id, ["member"], member.name)

const clear = () => { for (const p of [admin, mod, member]) p.heard.length = 0 }

console.log("\n— broadcasting to everyone —")
clear()
const all = broadcastTo(admin, "all", "Server restarting in five minutes")
check("it goes out", all.ok, true)
check("everyone online is reached", all.reached, 3)
check("the member hears it", member.heard.length, 1)
check("the message is in there", /Server restarting in five minutes/.test(member.heard[0]), true)
check("wearing the broadcast format", /Broadcast/.test(member.heard[0]), true)
check("no channel, because it was not sent to one", all.channel, undefined)

console.log("\n— broadcasting to one chat —")
// Staff can read the staff channel; a member cannot, so a staff broadcast must
// not reach them. This is the whole point of targeting a channel rather than
// colouring a public message red.
clear()
setActiveChannel(admin, "staff")
setActiveChannel(mod, "staff")
setActiveChannel(member, "general")
const staff = broadcastTo(admin, "staff", "eyes on spawn")
check("it goes out", staff.ok, true)
check("it names the channel it went to", staff.channel.id, "staff")
check("the member does NOT hear it", member.heard.length, 0)
check("staff do", mod.heard.length, 1)
check("and it carries the message", /eyes on spawn/.test(mod.heard[0]), true)

console.log("\n— the audience is who can SEE the channel —")
clear()
setActiveChannel(mod, "general")
const general = broadcastTo(admin, "general", "hello")
check("a general broadcast reaches the member", member.heard.length, 1)
check("and the mod, who is reading general", mod.heard.length, 1)

console.log("\n— things that should not send —")
clear()
check("an unknown channel is refused", broadcastTo(admin, "nowhere", "hi").ok, false)
check("and says which ones exist", /general/.test(broadcastTo(admin, "nowhere", "hi").reason), true)
check("nobody heard the refused one", member.heard.length, 0)
check("an empty message is refused", broadcastTo(admin, "all", "   ").ok, false)
check("so is no message at all", broadcastTo(admin, "all", undefined).ok, false)

console.log("\n— the scope argument is forgiving —")
clear()
check("case does not matter", broadcastTo(admin, "ALL", "x").ok, true)
clear()
check("nor does whitespace", broadcastTo(admin, "  staff  ", "x").ok, true)
clear()
check("missing scope means everyone", broadcastTo(admin, undefined, "x").reached, 3)

console.log("\n— the format is configurable —")
clear()
setSetting("format.broadcast", "§c{NAME} says: {MSG} [{CHANNEL}]")
broadcastTo(admin, "all", "custom")
check("the sender's name is a token", /Admin says: custom/.test(member.heard[0]), true)
clear()
setActiveChannel(mod, "staff")            // moved to general further up
broadcastTo(admin, "staff", "scoped")
check("so is the channel", /\[§cStaff\]/.test(mod.heard[0]), true)
resetSetting("format.broadcast")

console.log("\n— a channel made after startup still works —")
// The tab-completion vocabulary is fixed at world load, but the SENDING path
// looks the channel up live, so a channel created this session is reachable the
// moment it exists.
clear()
saveChannel("events", { display: "§dEvents", node: "chat.general", open: true })
setActiveChannel(member, "events")
const events = broadcastTo(admin, "events", "starting now")
check("it resolves", events.ok, true)
check("and reaches whoever is reading it", member.heard.length, 1)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
