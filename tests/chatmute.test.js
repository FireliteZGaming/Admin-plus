import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, isStaff, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import {
    allChannels, getChannel, isChannelMuted, channelMute,
    muteChannel, unmuteChannel, mutedChannels, setAllChannelsMuted
} from "../Admin+ BP/scripts/core/channels.js"
import { setting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let n = 0
function fakePlayer(name) {
    const tags = new Set()
    const p = {
        id: `c${n++}`, name, nameTag: name, commandPermissionLevel: 0,
        heard: [],
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: text => p.heard.push(text)
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}

applyPreset("server")
const mod = fakePlayer("Mod"); setRanks(mod.id, ["mod"], mod.name)
const member = fakePlayer("Member"); setRanks(member.id, ["member"], member.name)

console.log("\n— muting one channel —")
check("nothing is muted to begin with", mutedChannels().length, 0)
muteChannel("general", mod)
check("general is muted", isChannelMuted("general"), true)
check("staff is not", isChannelMuted("staff"), false)
check("which is the entire point of doing it per channel",
    mutedChannels().map(c => c.id), ["general"])

console.log("\n— it records who —")
// The one action in the pack announced to everyone by name. If chat goes quiet
// with no explanation, players think the server is broken.
check("the muter is kept", channelMute("general").by, "Mod")
check("with an id to go with it", channelMute("general").byId, mod.id)
check("and a time", typeof channelMute("general").at, "number")

console.log("\n— unmuting —")
check("it reports having done something", unmuteChannel("general"), true)
check("and it is open again", isChannelMuted("general"), false)
check("unmuting an open channel changes nothing", unmuteChannel("general"), false)
check("a channel that does not exist cannot be muted", muteChannel("nope", mod), undefined)

console.log("\n— all —")
const total = allChannels().length
check("mutes everything", setAllChannelsMuted(true, mod), total)
check("so every channel is shut", mutedChannels().length, total)
check("doing it twice changes nothing", setAllChannelsMuted(true, mod), 0)
check("and opens everything back up", setAllChannelsMuted(false, mod), total)
check("leaving nothing muted", mutedChannels().length, 0)

console.log("\n— who talks through a mute —")
// Staff keep talking on purpose: chat is usually muted SO staff can be heard.
muteChannel("general", mod)
check("a mod is staff", isStaff(mod), true)
check("a member is not", isStaff(member), false)
check("so the member is the one it stops",
    isChannelMuted("general") && !isStaff(member), true)
check("and the mod is not", isChannelMuted("general") && !isStaff(mod), false)
unmuteChannel("general")

console.log("\n— the emote settings —")
check("emotes ship on", setting("feature.emote"), "true")
check("the line names the player", setting("format.emote").includes("{NAME}"), true)
check("and carries what they did", setting("format.emote").includes("{MSG}"), true)
check("it does not pretend to be normal chat",
    setting("format.emote").includes("*"), true)
resetSetting("format.emote")

console.log("\n— the channels themselves are untouched —")
check("general still exists", !!getChannel("general"), true)
check("staff still exists", !!getChannel("staff"), true)
check("and neither is muted at the end", mutedChannels().length, 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
