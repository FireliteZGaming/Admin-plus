import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, isStaff, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import {
    allChannels, getChannel, isChannelMuted, channelMute,
    muteChannel, unmuteChannel, mutedChannels, setAllChannelsMuted
} from "../Admin+ BP/scripts/core/channels.js"
import { setting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { mute, unmute, isMuted, hasMuteTag, syncMuteTag, MUTE_TAG } from "../Admin+ BP/scripts/core/moderation.js"
import { readFileSync } from "node:fs"

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

console.log("\n— the channels themselves are untouched —")
check("general still exists", !!getChannel("general"), true)
check("staff still exists", !!getChannel("staff"), true)
check("and neither is muted at the end", mutedChannels().length, 0)

console.log("\n— the mute tag mirrors the record —")
// The record is what blocks chat; the tag exists so the state is VISIBLE from
// inside the game. `/tag <player> list` now answers "am I actually muted?",
// which previously needed reading a dynamic property nobody can read in game.
const victim = fakePlayer("Victim")
check("nobody starts tagged", hasMuteTag(victim), false)
mute(victim, 0, "testing", mod)
check("muting records it", isMuted(victim), true)
check("and tags them", hasMuteTag(victim), true)
check("with the ap: prefix the rest of the pack uses", MUTE_TAG, "ap:muted")
check("unmute reports it did something", unmute(victim), true)
check("the record is gone", isMuted(victim), false)
check("and so is the tag", hasMuteTag(victim), false)
check("unmuting again reports nothing to do", unmute(victim), false)

console.log("\n— a mute that came apart can still be lifted —")
// The whole point of the mirror. Either half alone is enough to act on, so a
// player cannot be stuck talking-blocked with staff unable to see why.
victim.addTag(MUTE_TAG)                     // tag with no record: the stuck case
check("a leftover tag is visible", hasMuteTag(victim), true)
check("even though the record says they are free", isMuted(victim), false)
check("unmute still clears it", unmute(victim), true)
check("really gone", hasMuteTag(victim), false)

console.log("\n— and it heals itself where it shows up —")
// A timed mute expiring is the common drift: a record carries an expiry, a tag
// cannot, so the tag outlives it. syncMuteTag runs from the chat gate, which is
// exactly where somebody notices they still cannot talk.
victim.addTag(MUTE_TAG)
check("sync notices the disagreement", syncMuteTag(victim), true)
check("and drops the stale tag", hasMuteTag(victim), false)
check("a second sync has nothing to do", syncMuteTag(victim), false)
mute(victim, 0, "testing", mod)
victim.removeTag(MUTE_TAG)                  // record with no tag: the other way
check("it puts a missing tag back too", syncMuteTag(victim), true)
check("so the two agree again", [isMuted(victim), hasMuteTag(victim)], [true, true])
unmute(victim)

console.log("\n— muting is ranked; UNMUTING is not —")
// Read from source because a command handler is registered, not exported, so
// there is nothing to call. The invariant is worth pinning anyway: it was a
// real bug. /mute @a silenced every peer, and because lifting a mute ALSO
// required canActOn, none of them could unmute each other — a moderator could
// not free another moderator, so the only way out was the person who cast it.
//
// Muting stays ranked so a junior cannot silence a senior. Unmuting is
// restorative and deliberately unranked: the worst case is somebody speaks who
// should not, which any staff member can undo in one command.
const modSrc = readFileSync(
    new URL("../Admin+ BP/scripts/features/modcommands.js", import.meta.url), "utf8")
const between = (from, to) => modSrc.slice(modSrc.indexOf(from), modSrc.indexOf(to))
const muteBlock = between('name: "mute"', 'name: "unmute"')
const unmuteBlock = between('name: "unmute"', 'name: "unban"')

check("mute still refuses somebody who outranks you",
    /canActOn\(player, target\)/.test(muteBlock), true)
// Matches a CALL, not the word: the block explains in a comment why it no
// longer calls canActOn, and a bare-word match flagged its own explanation.
check("unmute does not check rank at all",
    /canActOn\s*\(/.test(unmuteBlock), false)
check("but it still needs the mute permission to reach",
    /perm: "admin\.mute"/.test(unmuteBlock), true)

// The panel has the same split: the Mute button needs the rank check, the
// Unmute button is offered whenever the target is actually muted.
const actionsSrc = readFileSync(
    new URL("../Admin+ BP/scripts/features/actions.js", import.meta.url), "utf8")
// Since 2.8.5 the two halves are one `muted` value, read once per screen.
check("muted means a mute record OR a leftover tag",
    actionsSrc.includes("const muted = isMuted(target) || hasMuteTag(target)"), true)
check("the panel offers Unmute even without rank over them",
    actionsSrc.includes('has(player, "admin.mute") && (allowed || muted)'), true)
// A leftover tag with no record has to read as Unmute, not Mute. With only
// isMuted() driving the label, somebody trying to free themselves was offered
// "Mute" and muted themselves instead — the reported symptom.
check("and a leftover tag reads as Unmute, not Mute",
    actionsSrc.includes('text: muted ? "§eUnmute" : "§eMute"'), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
