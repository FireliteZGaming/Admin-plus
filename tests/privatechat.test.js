import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES, canSeeActionsOf } from "../Admin+ BP/scripts/core/ranks.js"
import { readFileSync } from "node:fs"
import {
    setReplyTarget, replyTarget, rememberExchange, clearReplyTarget,
    isSpying, setSpying, toggleSpying, spyIds,
    pairedWith, inPair, startPair, endPair,
    invite, inviteFrom, pendingInvites, takeInvite, clearInvites, forgetPlayer, INVITE_SECONDS
} from "../Admin+ BP/scripts/core/privatechat.js"
import { setting } from "../Admin+ BP/scripts/core/settings.js"

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
        id: `pc${n++}`, name, nameTag: name, commandPermissionLevel: 0,
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
const alex = fakePlayer("Alex"); setRanks(alex.id, ["member"], alex.name)
const sam = fakePlayer("Sam"); setRanks(sam.id, ["member"], sam.name)

console.log("\n— /r knows who to answer —")
check("nobody, to begin with", replyTarget(alex), undefined)
rememberExchange(alex, sam)
check("the receiver can answer the sender", replyTarget(sam), alex.id)
check("and the sender can answer back without retyping the name",
    replyTarget(alex), sam.id)
setReplyTarget(alex, mod)
check("the newest exchange wins", replyTarget(alex), mod.id)
clearReplyTarget(alex)
check("and it can be forgotten", replyTarget(alex), undefined)

console.log("\n— social spy —")
check("off by default", isSpying(mod), false)
check("toggling reports the new state", toggleSpying(mod), true)
check("and it sticks", isSpying(mod), true)
check("the watcher is listed", spyIds().includes(mod.id), true)
check("toggling again turns it off", toggleSpying(mod), false)
check("leaving nobody watching", spyIds().includes(mod.id), false)
setSpying(mod, true)
check("it can be set outright", isSpying(mod), true)
setSpying(mod, false)

console.log("\n— the node it needs —")
// Reading other people's private messages goes with reading the audit log,
// not with wearing a staff tag.
check("chat.spy is declared", Object.values(PERMISSION_NODES).flat().includes("chat.spy"), true)
check("and sits with chat", PERMISSION_NODES.Chat.includes("chat.spy"), true)
check("a Mod may spy", has(mod, "chat.spy"), true)
check("a member may not", has(alex, "chat.spy"), false)

console.log("\n— /prchat pairs two people —")
check("nobody is paired", inPair(alex), false)
check("opening works", startPair(alex, sam), true)
check("and is symmetric — either end knows", pairedWith(alex), sam.id)
check("from both sides", pairedWith(sam), alex.id)
check("you cannot pair with yourself", startPair(alex, alex), false)

console.log("\n— and either end can leave —")
check("leaving returns who was left behind", endPair(sam), alex.id)
check("the leaver is out", inPair(sam), false)
check("and so is the other one — no half-open session", inPair(alex), false)
check("leaving twice is not an error", endPair(sam), undefined)

console.log("\n— opening a second session closes the first —")
startPair(alex, sam)
startPair(alex, mod)
check("the new partner is set", pairedWith(alex), mod.id)
check("and the abandoned one is genuinely free", inPair(sam), false)
endPair(alex)

console.log("\n— invites —")
check("inviting works", invite(alex, sam), true)
check("the invited player has one standing", pendingInvites(sam)[0].from, alex.id)
check("with the sender's name, for the picker", pendingInvites(sam)[0].fromName, "Alex")
check("pointing back at the inviter is how you accept",
    !!inviteFrom(sam, alex), true)
check("an invite from someone else does not match",
    inviteFrom(sam, mod), undefined)
check("you cannot invite yourself", invite(alex, alex), false)

// Two people asking at once. Held one-per-player, the second silently replaced
// the first: the sender was told it went, the invited player never saw it, and
// nobody could tell. The same fault the teleport requests had.
check("a second asker does not erase the first", invite(mod, sam), true)
check("both are waiting", pendingInvites(sam).length, 2)
check("newest first", pendingInvites(sam).map(i => i.fromName), ["Mod", "Alex"])
check("asking twice does not stack duplicates",
    invite(mod, sam) && pendingInvites(sam).length, 2)

check("one can be taken", takeInvite(sam, alex).from, alex.id)
check("leaving the other", pendingInvites(sam).map(i => i.fromName), ["Mod"])
check("taking it twice returns nothing", takeInvite(sam, alex), undefined)

check("clearing hands back what went", clearInvites(sam).length, 1)
check("and leaves none", pendingInvites(sam).length, 0)
check("clearing an empty list is harmless", clearInvites(sam).length, 0)
check("and the window is a real number", INVITE_SECONDS > 0, true)

console.log("\n— leaving the world tidies up —")
startPair(alex, sam)
invite(mod, alex)
check("forgetting returns the stranded partner", forgetPlayer(alex), sam.id)
check("the partner is released", inPair(sam), false)
check("their reply target is gone", replyTarget(alex), undefined)
check("and invites addressed to them go too", pendingInvites(alex).length, 0)

console.log("\n— the formats —")
check("private messages ship on", setting("feature.pm"), "true")
// The three name-carrying formats accept EITHER token: {NAME} is the gamertag,
// {NICKNAME} is what they call themselves, and every site fills both so the
// template chooses. The shipped ones ask for {NICKNAME}. {FROM} is the spy
// line's own token and is unrelated.
for (const [key, token] of [
    ["format.pmOut", /\{NICKNAME\}|\{NAME\}/], ["format.pmIn", /\{NICKNAME\}|\{NAME\}/],
    ["format.prchat", /\{NICKNAME\}|\{NAME\}/], ["format.spy", /\{FROM\}/]
]) {
    check(`${key} names somebody`, token.test(setting(key)), true)
    check(`${key} carries the message`, setting(key).includes("{MSG}"), true)
}
check("the spy line says which kind it was", setting("format.spy").includes("{KIND}"), true)
check("and names both ends", setting("format.spy").includes("{TO}"), true)

// A session line has to say WHOSE conversation it is, the way a channel line
// carries its channel — otherwise two private chats scrolling past each other
// are indistinguishable.
check("the session line names both people", setting("format.prchat").includes("{PAIR}"), true)
check("and carries the speaker's rank tag", setting("format.prchat").includes("{TAG}"), true)


console.log("\n— watching a private conversation never looks upward —")
// chat.spy used to be the whole test, so a moderator holding it read an
// OWNER's private messages and /prchat sessions. Same leak the staff notices
// had, except carrying actual conversation instead of a notification.
//
// A conversation has two ends and BOTH have to be visible: an owner messaging
// a member is not readable by a moderator just because the member is beneath
// them, because the line contains what the OWNER said.
{
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/privatechat.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    check("the node alone no longer decides who sees a PM",
        /canSeeActionsOf\(viewer, from\)/.test(code), true)
    check("and BOTH ends are checked, not just the sender",
        /canSeeActionsOf\(viewer, to\)/.test(code), true)
    // The rule itself, exercised rather than described.
    const owner = { id: "spy-own", name: "Own", getTags: () => [], commandPermissionLevel: 1 }
    const mod = { id: "spy-mod", name: "Mod", getTags: () => [], commandPermissionLevel: 0 }
    setRanks(mod.id, ["Member"], mod.name)
    check("a moderator cannot see an operator's side", canSeeActionsOf(mod, owner), false)
    check("but an operator sees theirs", canSeeActionsOf(owner, mod), true)
}

console.log("\n— and the chat log only gives back rooms you could enter —")
// Channels are not all public: core/channels.js says a channel made later
// gates on its own node, "which is what lets a manager run a room most staff
// cannot read". Those lines went into the log all the same, and the log asked
// only for admin.logs — so a moderator read back a room they cannot enter,
// off a screen captioned "Public chat only".
{
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/logsUI.js", import.meta.url), "utf8")
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    // Three doors reach the stored chat, and every one of them has to filter —
    // Recent, Search, and the per-player screen. One unfiltered door is the
    // whole leak.
    // Counted by the SOURCE each door reads from rather than by the helper's
    // name — the definition is readableChat(player, entries) and would
    // otherwise count itself as a fourth door.
    check("every door into the chat log filters",
        (code.match(/readableChat\(player, (recentChat|searchChat|chatBy)/g) ?? []).length, 3)
    check("recent is filtered", /readableChat\(player, recentChat/.test(code), true)
    check("search is filtered", /readableChat\(player, searchChat/.test(code), true)
    check("and so is one person's own history",
        /readableChat\(player, chatBy/.test(code), true)
    check("an unknown room is treated as restricted, not as readable",
        /if \(!found\) return has\(player, "chat.viewall"\)/.test(code), true)
    check("the caption no longer claims public chat only",
        code.includes("Public chat only"), false)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
