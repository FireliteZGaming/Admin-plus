import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, saveRank, getRank } from "../Admin+ BP/scripts/core/ranks.js"
import {
    allChannels, getChannel, saveChannel, deleteChannel, moveChannel,
    availableTo, visibleTo, audienceFor, activeChannel, setActiveChannel, viewsAll, canUse
} from "../Admin+ BP/scripts/core/channels.js"
import { formatChatLine, postToChannel, installChat } from "../Admin+ BP/scripts/features/chat.js"
import { CONFIG } from "../Admin+ BP/scripts/config.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name, { op = false } = {}) {
    const tags = new Set()
    const p = {
        id: `p${nextId++}`, name, nameTag: name, inbox: [],
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(m)
    }
    __test.players.push(p)
    return p
}
const clean = s => String(s).replace(/§./g, "")

// Cast: a member, a mod (staff chat, no view-all), an admin (chat.* so both).
const nova = fakePlayer("Nova");      onPlayerJoin(nova)
const vchris = fakePlayer("Vchris");  onPlayerJoin(vchris);  setRanks(vchris.id, ["mod"], vchris.name)
const firelite = fakePlayer("Firelite"); onPlayerJoin(firelite); setRanks(firelite.id, ["admin"], firelite.name)

console.log("\n— who can reach which channel —")
check("shipped channels", allChannels().map(c => c.id), ["general", "staff"])
check("member gets General only", availableTo(nova).map(c => c.id), ["general"])
check("mod reaches Staff", availableTo(vchris).map(c => c.id), ["general", "staff"])
check("admin reaches Staff", availableTo(firelite).map(c => c.id), ["general", "staff"])
check("member cannot use Staff", canUse(nova, getChannel("staff")), false)

console.log("\n— view all is a rank toggle, not a free-for-all —")
check("member does not view all", viewsAll(nova), false)
check("mod does not view all", viewsAll(vchris), false)
check("admin views all (chat.*)", viewsAll(firelite), true)
check("member sees only General", visibleTo(nova).map(c => c.id), ["general"])
check("mod sees only where they type", visibleTo(vchris).map(c => c.id), ["general"])
check("admin sees both at once", visibleTo(firelite).map(c => c.id), ["general", "staff"])

console.log("\n— switching focus actually narrows what you read —")
setActiveChannel(vchris, "staff")
check("mod is now typing in Staff", activeChannel(vchris).id, "staff")
check("mod stopped receiving General", visibleTo(vchris).map(c => c.id), ["staff"])
check("admin is unaffected by mod's switch", visibleTo(firelite).map(c => c.id), ["general", "staff"])
check("a member cannot switch to Staff", setActiveChannel(nova, "staff"), undefined)
check("and stays in General", activeChannel(nova).id, "general")

console.log("\n— nothing leaks —")
check("General audience is everyone", audienceFor(getChannel("general")).map(p => p.name).sort(), ["Firelite", "Nova"])
check("Staff audience excludes the member", audienceFor(getChannel("staff")).map(p => p.name).sort(), ["Firelite", "Vchris"])

for (const p of __test.players) p.inbox.length = 0
postToChannel(vchris, "look at this member", getChannel("staff"))
check("member received nothing from Staff", nova.inbox.length, 0)
check("admin received the staff line", firelite.inbox.length, 1)
check("mod saw their own message", vchris.inbox.length, 1)

console.log("\n— the label only appears when it means something —")
check("single-channel reader gets no channel prefix",
    clean(formatChatLine(nova, "hi", getChannel("general"), false)).startsWith("General"), false)
check("single-channel reader still gets rank and name",
    clean(formatChatLine(nova, "hi", getChannel("general"), false)), "[Member] Nova » hi")
check("multi-channel reader gets the channel prefix",
    clean(formatChatLine(vchris, "hi", getChannel("staff"), true)).startsWith("Staff |"), true)
check("admin's copy of the staff line is labelled", clean(firelite.inbox[0]).startsWith("Staff |"), true)
check("mod's own copy is not, since they read one chat", clean(vchris.inbox[0]).startsWith("Staff |"), false)

// Nova with view-all granted still must not see Staff — the toggle widens to
// channels you already hold, never past them.
console.log("\n— view all never reaches past your access —")
saveRank("member", { perms: [...getRank("member").perms, "chat.viewall"] })
check("member now views all", viewsAll(nova), true)
check("but still only has General", visibleTo(nova).map(c => c.id), ["general"])
for (const p of __test.players) p.inbox.length = 0
postToChannel(firelite, "secret", getChannel("staff"))
check("still receives nothing from Staff", nova.inbox.length, 0)
saveRank("member", { perms: getRank("member").perms.filter(p => p !== "chat.viewall") })

console.log("\n— channel management —")
saveChannel("builders", { display: "§9Builders", node: "chat.builders", open: false })
check("created at the bottom", allChannels().map(c => c.id), ["general", "staff", "builders"])
// A new chat.<id> channel falls INSIDE the chat.* wildcard, so anyone holding
// chat.* reaches it the moment it exists. That is wildcard semantics working as
// intended, and it is why a channel meant to be hidden from admins needs a node
// outside the chat. branch.
check("a chat.* holder reaches a new chat.* channel immediately",
    availableTo(firelite).map(c => c.id), ["general", "staff", "builders"])
check("a member still cannot", availableTo(nova).map(c => c.id), ["general"])
saveChannel("builders", { node: "private.builders" })
check("moving the node out of chat.* hides it from chat.* holders",
    availableTo(firelite).map(c => c.id), ["general", "staff"])
saveRank("admin", { perms: [...getRank("admin").perms, "private.builders"] })
check("granting the exact node opens it again",
    availableTo(firelite).map(c => c.id), ["general", "staff", "builders"])
moveChannel("builders", -1)
check("reordering works", allChannels().map(c => c.id), ["general", "builders", "staff"])

setActiveChannel(firelite, "builders")
check("parked in Builders", activeChannel(firelite).id, "builders")
deleteChannel("builders")
check("deleting drops it", allChannels().map(c => c.id), ["general", "staff"])
check("and its occupant falls back rather than stranding", activeChannel(firelite).id, "general")

console.log("\n— losing access mid-session —")
setActiveChannel(vchris, "staff")
check("mod in Staff", activeChannel(vchris).id, "staff")
setRanks(vchris.id, ["member"], vchris.name)   // demoted
check("demotion moves them out of Staff", activeChannel(vchris).id, "general")
check("and they no longer receive it", audienceFor(getChannel("staff")).map(p => p.name), ["Firelite"])

console.log("\n— the event itself: routing is never skipped —")
check("chat hooks up on this runtime", installChat(), true)

// Vchris back to mod, parked in Staff, so a leak would be visible.
setRanks(vchris.id, ["mod"], vchris.name)
setActiveChannel(vchris, "staff")
for (const p of __test.players) p.inbox.length = 0
let ev = __test.emitChat(vchris, "staff only please")
check("the vanilla message is cancelled", ev.cancel, true)
check("member got nothing", nova.inbox.length, 0)
check("admin got it", firelite.inbox.length, 1)

// The regression: turning rank tags off must NOT hand chat back to vanilla,
// which would broadcast a Staff line to the whole server.
CONFIG.ranks.showInChat = false
for (const p of __test.players) p.inbox.length = 0
ev = __test.emitChat(vchris, "still staff only")
check("still cancelled with tags disabled", ev.cancel, true)
check("member STILL got nothing", nova.inbox.length, 0)
check("admin still got it", firelite.inbox.length, 1)
check("but the line carries no rank tag", clean(firelite.inbox[0]).includes("[Admin]"), false)
CONFIG.ranks.showInChat = true

// A member talking in General still reaches everyone.
for (const p of __test.players) p.inbox.length = 0
__test.emitChat(nova, "hi")
check("General still reaches the member", nova.inbox.length, 1)
check("and the view-all admin", firelite.inbox.length, 1)
check("but not the mod sitting in Staff", vchris.inbox.length, 0)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
