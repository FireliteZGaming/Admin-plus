import { readFileSync } from "node:fs"
import {
    noteChat, recentChat, chatBy, searchChat, chatLogSize, clearChatLog, __resetChatLog
} from "../Admin+ BP/scripts/core/chatlog.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const steve = { id: "p1", name: "Steve" }
const alex = { id: "p2", name: "Alex" }
const global = { display: "§7Global" }

__resetChatLog()

console.log("\n— it records what was said —")
noteChat(steve, "hello everyone", global)
noteChat(alex, "hi Steve", global)
check("both lines kept", chatLogSize(), 2)
check("newest first", recentChat().map(l => l.text), ["hi Steve", "hello everyone"])
check("with who said it", recentChat()[0].name, "Alex")
check("and which channel, stripped of colour", recentChat()[0].channel, "Global")

console.log("\n— it keeps the words, not the decoration —")
// The formatted line carries colour codes, a rank prefix and a channel label,
// none of which is what the person typed. A log showing the decoration is
// harder to read at exactly the moment somebody needs it.
noteChat(steve, "  spaced out  ", global)
check("trimmed", recentChat()[0].text, "spaced out")
check("an empty line is not a line", noteChat(steve, "   ", global), undefined)
check("so it was not stored", chatLogSize(), 3)

console.log("\n— whose line was it —")
check("everything Steve said", chatBy("p1").map(l => l.text), ["spaced out", "hello everyone"])
check("everything Alex said", chatBy("p2").map(l => l.text), ["hi Steve"])
check("somebody who never spoke", chatBy("nobody"), [])

console.log("\n— finding it again —")
check("by a word", searchChat("hello").map(l => l.text), ["hello everyone"])
check("case does not matter", searchChat("HELLO").length, 1)
check("by who said it", searchChat("alex").map(l => l.text), ["hi Steve"])
check("a search for nothing finds nothing", searchChat("   "), [])
check("and a miss is empty rather than everything", searchChat("zzzz"), [])

console.log("\n— the cap, because chat outruns everything else —")
setSetting("logs.chatCap", "5")
__resetChatLog()
for (let i = 1; i <= 8; i++) noteChat(steve, `line ${i}`, global)
check("it stops at the cap", chatLogSize(), 5)
check("and it is the OLDEST that fall off",
    recentChat().map(l => l.text), ["line 8", "line 7", "line 6", "line 5", "line 4"])
resetSetting("logs.chatCap")

console.log("\n— an owner can switch it off —")
__resetChatLog()
setSetting("logs.chat", "false")
check("nothing is recorded", noteChat(steve, "unheard", global), undefined)
check("so the log stays empty", chatLogSize(), 0)
setSetting("logs.chat", "true")
noteChat(steve, "heard", global)
check("and back on again", chatLogSize(), 1)
resetSetting("logs.chat")

clearChatLog()
check("clearing empties it", chatLogSize(), 0)

console.log("\n— private messages are never in here —")
// A boundary, not an oversight. This hangs off postToChannel, the CHANNEL
// funnel; /pm and private chat send straight to the players involved and never
// pass through it. Players can also switch those off in their own settings, and
// a log that kept them anyway would make that preference a lie.
const chatSrc = readFileSync(new URL("../Admin+ BP/scripts/features/chat.js", import.meta.url), "utf8")
const pmSrc = readFileSync(new URL("../Admin+ BP/scripts/features/privatechat.js", import.meta.url), "utf8")
// 3.1.4: with Chat Moderation's note for the line, when it acted.
check("the hook is on the channel funnel", chatSrc.includes("noteChat(sender, message, channel, note)"), true)
check("and private chat never calls it", pmSrc.includes("noteChat"), false)

// It is a SEPARATE table. Sharing the audit log's ring buffer would push every
// ban and mute out of Recent within minutes — chat would destroy the very
// record it is meant to support.
const logSrc = readFileSync(new URL("../Admin+ BP/scripts/core/chatlog.js", import.meta.url), "utf8")
check("it has a key of its own", logSrc.includes('const CHAT_KEY = "chatLog"'), true)
check("and a table of its own", logSrc.includes("new Table(CHAT_KEY"), true)
check("and a cap of its own", logSrc.includes('setting("logs.chatCap")'), true)

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
