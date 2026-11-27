import { readFileSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { onPlayerJoin, setRanks, applyPreset } from "../Admin+ BP/scripts/core/ranks.js"
import { CHAT_AUTOMOD_ON_HOLD, AUTOMOD_ON_HOLD } from "../Admin+ BP/scripts/core/hold.js"
import { commandSpecs } from "../Admin+ BP/scripts/core/registry.js"
import { screen } from "../Admin+ BP/scripts/core/chatfilter.js"
import { heldCount, clearHeld } from "../Admin+ BP/scripts/core/heldchat.js"
import { noteChat } from "../Admin+ BP/scripts/core/automod.js"
import { isMuted } from "../Admin+ BP/scripts/core/moderation.js"
import { COLOUR_CODE_TIP } from "../Admin+ BP/scripts/core/theme.js"
import { installChat } from "../Admin+ BP/scripts/features/chat.js"
import { installAutomod, automodScreen, shownChecks } from "../Admin+ BP/scripts/features/automod.js"
import { automodHubScreen } from "../Admin+ BP/scripts/features/automodUI.js"
import { infoScreen } from "../Admin+ BP/scripts/features/info.js"
import { createRankScreen } from "../Admin+ BP/scripts/features/ranksUI.js"

// 2.9.2. Three things the user asked for on 2026-11-12, each tested through
// the real code rather than by restating it:
//   1. "putting automod for chat in a complete hold, so disabling it and
//      graying out the button to inactive"
//   2. "in between the separator, the title text is too big"
//   3. colour codes explained "how essentials explained it with there rank
//      thing": an example in the box and a tooltip that ends in §.

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
        id: `h${nextId++}`, name, nameTag: name, inbox: [],
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        sendMessage: m => p.inbox.push(typeof m === "string" ? m : JSON.stringify(m)),
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const press = selection => ({ canceled: false, selection })
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const partsOf = (form, kind) => form.parts.filter(p => p[0] === kind)
const clean = s => String(s).replace(/§./g, "")

applyPreset("server")
const member = fakePlayer("Chatty")
const boss = fakePlayer("Boss", { op: true })
setRanks(boss.id, ["owner"], boss.name)

console.log("\n— chat automod is on hold —")
check("the hold is on", CHAT_AUTOMOD_ON_HOLD, true)
// 2.12.14, the user: "just put a hold on automod and /disguise since those aren't working".
check("all of automod is on hold too", AUTOMOD_ON_HOLD, true)
// 3.1.7, the user: "We also must remove /disguise". Gone, not held.
check("/disguise isn't a command in game", commandSpecs().some(spec => spec.name === "disguise"), false)
installChat()
installAutomod()

// The engines still work, so screening and the spam check can come back by
// changing one line. What the hold stops is the code that ACTS on them.
check("the screen itself still catches hostility", screen("just kys")?.category, "aggression")
const probe = fakePlayer("Probe")
let engineFlags = 0
for (let i = 0; i < 20; i++) if (noteChat(probe)) engineFlags++
check("and the spam engine still counts a flood", engineFlags > 0, true)

clearHeld()
__test.emitChat(member, "just kys")
check("but a hostile message sent in chat is not held", heldCount(), 0)

member.inbox.length = 0
for (let i = 0; i < 25; i++) __test.emitChat(member, "spam spam spam")
check("and a flood mutes nobody", isMuted(member), false)
check("nor tells them they are typing quickly",
    member.inbox.some(m => clean(m).includes("typing quickly")), false)

console.log("\n— Server ▸ Automod: two sections; the old screening stays on hold —")
{
    // 3.1.4: Chat Moderation took over from the old word-list screening and
    // chat flooding, whose own paths this hold still keeps shut (core/hold.js),
    // so the two can never both act. The user: "Bot Guard and Chat Moderation
    // should be the only 2 ... eventually we will have Anti-cheat".
    __ui.answers.length = 0
    __ui.shown.length = 0
    __ui.answers.push(press(1))   // Bot Guard, then Chat Moderation
    await automodHubScreen(boss, () => {})
    const hub = __ui.shown[0]
    const buttons = partsOf(hub, "button").map(p => clean(p[1]).split("\n")[0])
    check("no Chat screening or Ore alerts button any more",
        buttons.some(text => text.startsWith("Chat screening") || text.startsWith("Ore alerts")), false)
    check("the hub says Anti-cheat comes later", clean(partsOf(hub, "body")[0]?.[1] ?? "").includes("Anti-cheat comes later"), true)
    const page = __ui.shown[1]
    check("Chat Moderation opens its own page: Settings, Test a message, Held messages",
        partsOf(page, "button").map(p => clean(p[1]).split("\n")[0].replace(/ \(\d+\)$/, "")), ["Settings", "Test a message", "Held messages", "< Back"])
}
{
    __ui.answers.length = 0
    __ui.shown.length = 0
    await automodScreen(boss, () => {})
    const toggles = partsOf(lastForm(), "toggle").map(p => clean(p[1]))
    check("Checks shows two switches", toggles.length, 2)
    check("and no Chat flooding switch", toggles.some(t => t.startsWith("Chat flooding")), false)
    check("the list behind it agrees", shownChecks().map(c => c.id), ["ores", "breaks"])
}

console.log("\n— /info says nothing about spam mutes while on hold —")
{
    __ui.answers.length = 0
    __ui.shown.length = 0
    __ui.answers.push(press(2))
    await infoScreen(member)
    const chat = clean(partsOf(lastForm(), "body")[0]?.[1] ?? "")
    check("the Chat page opened", chat.includes("Private messages"), true)
    check("it says chat rooms", chat.includes("Chat rooms"), true)
    check("not channels", chat.includes("Channels"), false)
    check("and promises no automatic mute", chat.includes("Spamming"), false)
}
{
    __ui.answers.length = 0
    __ui.shown.length = 0
    __ui.answers.push(press(3))
    await infoScreen(boss)
    const staff = clean(partsOf(lastForm(), "body")[0]?.[1] ?? "")
    check("Staff tools points to where Kick really is",
        staff.includes("/admin ▸ Players ▸ a player ▸ Actions ▸ Kick"), true)
    check("and no longer says to type /kick, which Admin+ doesn't have", staff.includes("/kick"), false)
}

console.log("\n— section titles are text-sized, not headers —")
const bp = new URL("../Admin+ BP/scripts/", import.meta.url)
function scripts(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir)
        if (entry.isDirectory()) out.push(...scripts(url))
        else if (entry.name.endsWith(".js")) out.push([entry.name, readFileSync(url, "utf8")])
    }
    return out
}
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n")
const all = scripts(bp).map(([name, text]) => [name, code(text)])
const usingHeaders = all.filter(([name, text]) => name !== "ui.js" && /\{\s*header:/.test(text)).map(([name]) => name)
check("no screen uses a header", usingHeaders, [])

console.log("\n— colour codes, the Essentials way —")
check("the tooltip ends in the sign itself", COLOUR_CODE_TIP.endsWith("§"), true)
check("and has no other sign to swallow a letter", COLOUR_CODE_TIP.split("§").length - 1, 1)
{
    __ui.answers.length = 0
    __ui.shown.length = 0
    await createRankScreen(boss, () => {})
    const name = partsOf(lastForm(), "text").find(p => String(p[1]).startsWith("Name"))
    check("a new rank's Name box has the tooltip", name?.[3]?.tooltip, COLOUR_CODE_TIP)
    check("and an example in the box", String(name?.[2] ?? "").startsWith("Example: §"), true)
}
const sayingSectionSign = all.filter(([, text]) => /section sign/i.test(text)).map(([name]) => name)
check("no line players read says 'the section sign' any more", sayingSectionSign, [])
const untipped = all.flatMap(([name, text]) => text.split("\n")
    .filter(line => /colour codes allowed/.test(line) && !/tooltip: COLOUR_CODE_TIP/.test(line))
    .map(() => name))
check("every 'colour codes allowed' box has the tooltip", untipped, [])

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
