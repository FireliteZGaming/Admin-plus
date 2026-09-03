import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, has, applyPreset, PERMISSION_NODES } from "../Admin+ BP/scripts/core/ranks.js"
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
for (const [key, token] of [
    ["format.pmOut", "{NAME}"], ["format.pmIn", "{NAME}"],
    ["format.prchat", "{NAME}"], ["format.spy", "{FROM}"]
]) {
    check(`${key} names somebody`, setting(key).includes(token), true)
    check(`${key} carries the message`, setting(key).includes("{MSG}"), true)
}
check("the spy line says which kind it was", setting("format.spy").includes("{KIND}"), true)
check("and names both ends", setting("format.spy").includes("{TO}"), true)

// A session line has to say WHOSE conversation it is, the way a channel line
// carries its channel — otherwise two private chats scrolling past each other
// are indistinguishable.
check("the session line names both people", setting("format.prchat").includes("{PAIR}"), true)
check("and carries the speaker's rank tag", setting("format.prchat").includes("{TAG}"), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
