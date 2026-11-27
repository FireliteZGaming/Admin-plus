import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import "../Admin+ BP/scripts/main.js"
import { onPlayerJoin, setRanks, applyPreset, has, topWeight, canActOn, canReplaceRankList, isDeveloper, CREATOR_GAMERTAG, __setTeamDevelopers } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting } from "../Admin+ BP/scripts/core/settings.js"
import { TERMS_VERSION, TERMS_LINES, adminplusDisabled, serverAccepted, setWorldTerms, __setWorldTermsRaw } from "../Admin+ BP/scripts/core/terms.js"
import { asksTerms, needsTerms, ownsServer, ensureTerms, termsGate, termsScreen, developerJoined, developerOps, acceptTerms, termsAnswer, __resetTerms } from "../Admin+ BP/scripts/features/terms.js"
import { onOwnerSpawn } from "../Admin+ BP/scripts/features/setup.js"
import { KEPT_BY_RESET } from "../Admin+ BP/scripts/features/reset.js"
import { applyByEvent } from "../Admin+ BP/scripts/features/scriptevents.js"
import { runClear } from "../Admin+ BP/scripts/features/cleanup.js"
import { setSpawn } from "../Admin+ BP/scripts/core/warps.js"
import { OMNI_TYPES } from "../Admin+ BP/scripts/features/worldtools.js"
import { recent } from "../Admin+ BP/scripts/core/logs.js"
import { NS } from "../Admin+ BP/scripts/config.js"
import { ban, unban, isBanned, checkJoin, setFrozen, isFrozen } from "../Admin+ BP/scripts/core/moderation.js"
import { turnAwayOnJoin } from "../Admin+ BP/scripts/features/allowlist.js"
import { setEnabled as setAllowlistOn, setMaintenance } from "../Admin+ BP/scripts/core/allowlist.js"

// The 3.1.6 stress test (2026-11-27). The terms, the off switch and the
// developers' grant were written by a fallback model in one sitting, and the
// user asked for them to be stress tested before anyone relies on them. Every
// block here tries to break one promise the terms make, through the real
// functions:
//   - nothing of the developers' grant applies until an owner ACCEPTS
//     (point 5), and a developer can't accept for a server they don't own;
//   - Admin+ makes developers operators, and a decline takes back exactly the
//     operator status Admin+ gave, never one the owner chose;
//   - a decline turns everything off for everyone, developers included, and
//     an update to the terms doesn't switch it back on;
//   - everything that acts by itself steps aside while it is off, and every
//     file that listens to the game either checks or says why it needn't.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)) }
const plain = s => String(s ?? "").replace(/§./g, "")
const titleOf = form => plain((form?.parts ?? []).find(p => p[0] === "title")?.[1])
const termsShown = () => __ui.shown.some(f => titleOf(f).includes("Admin+ terms"))
const press = selection => ({ canceled: false, selection })
const closed = { canceled: true, cancelationReason: "UserClosed" }
const ops = () => __test.commands.filter(c => /^(de)?op "/.test(c))
const fresh = () => { __resetTerms(); __test.commands.length = 0; __ui.shown.length = 0; __ui.answers.length = 0 }

__test.runStartup()
applyPreset("server")

function fakePlayer(id, name, level = 0) {
    const p = {
        id, name, nameTag: name, typeId: "minecraft:player", heard: [], commandPermissionLevel: level,
        isSneaking: false, location: { x: 0, y: 64, z: 0 }, dimension: __test.dimension,
        getTags: () => [], addTag: () => true, removeTag: () => true, hasTag: () => false,
        sendMessage: m => p.heard.push(plain(m))
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const owner = fakePlayer("t-owner", "Hostly", 1)
const member = fakePlayer("t-member", "Mia")
setRanks(member.id, ["member"], member.name)
const modly = fakePlayer("t-mod", "Modly")
setRanks(modly.id, ["mod"], modly.name)
__setTeamDevelopers(["VisitingDev", "TrustedDev"])
// A developer visiting a stranger's server: not an operator there.
const dev = fakePlayer("t-dev", "VisitingDev")

console.log("\n— a server that has never answered: no grant —")
{
    fresh()
    check("a fresh world is on, and has accepted nothing", [adminplusDisabled(), serverAccepted()], [false, false])
    check("so a developer holds nothing yet", [has(dev, "admin.ban"), has(dev, "ranks.manage"), topWeight(dev) === Infinity], [false, false, false])
    check("a Mod can act on them like on any player", canActOn(modly, dev), true)
    check("they are no owner of it, and can't answer for it", [ownsServer(dev), asksTerms(dev), canReplaceRankList(dev)], [false, false, false])
    developerJoined(dev)
    check("they are not made an operator", ops(), [])
    check("nor welcomed into setting the server up", onOwnerSpawn(dev), false)
    __test.invoke(`${NS}:menu`, dev)
    await settle()
    check("their commands run like any player's, and never show them the terms", [__ui.shown.length > 0, termsShown()], [true, false])
    __ui.shown.length = 0
    check("and ensureTerms says yes without the terms", [await ensureTerms(dev), termsShown()], [true, false])
}

console.log("\n— an owner accepts: the grant, and operator —")
{
    __ui.shown.length = 0; __ui.answers.length = 0
    __ui.answers.push(press(0))
    __test.invoke(`${NS}:menu`, owner)
    await settle()
    check("the owner's first command opens the terms, and Accept turns Admin+ on", [titleOf(__ui.shown[0]).includes("Admin+ terms"), serverAccepted()], [true, true])
    check("the developer online is made an operator at once", ops(), ['op "VisitingDev"'])
    check("and Admin+ notes that the op is its own", developerOps(), [dev.id])
    check("full control now", [has(dev, "admin.ban"), has(dev, "ranks.manage"), topWeight(dev)], [true, true, Infinity])
    check("a Mod can't act on them, and they can act on a Mod", [canActOn(modly, dev), canActOn(dev, modly)], [false, true])
    dev.commandPermissionLevel = 1 // the op took
    check("operator status Admin+ gave doesn't make them an owner of the server", [ownsServer(dev), asksTerms(dev), needsTerms(dev)], [false, false, false])
    check("so they still aren't welcomed into its setup", onOwnerSpawn(dev), false)
    __test.commands.length = 0
    developerJoined(dev)
    check("joining again in the same world load doesn't op them twice", ops(), [])
}

console.log("\n— a decline takes it all back —")
{
    __test.commands.length = 0; __ui.shown.length = 0
    __ui.answers.push(press(1))
    await termsScreen(owner)
    await settle()
    check("Decline turns Admin+ off", adminplusDisabled(), true)
    check("the developer Admin+ opped is deopped at once", ops(), ['deop "VisitingDev"'])
    check("and Admin+ forgets it gave it", developerOps(), [])
    dev.commandPermissionLevel = 0 // the deop took
    check("they hold nothing", [has(dev, "admin.ban"), topWeight(dev) === Infinity, canActOn(modly, dev)], [false, false, true])
    dev.heard.length = 0; __ui.shown.length = 0
    __test.invoke(`${NS}:menu`, dev)
    await settle()
    check("their commands are turned away like everyone's (the user: \"if they end up pressing decline, I won't have it\")",
        [__ui.shown.length, dev.heard.some(m => m.includes("Admin+ is turned off here"))], [0, true])
    check("and nothing offers them the terms to accept", [termsGate(dev), await ensureTerms(dev), __ui.shown.length], [false, false, 0])
    member.heard.length = 0
    for (const name of ["menu", "spawn"]) __test.invoke(`${NS}:${name}`, member)
    await settle()
    check("every player's command does nothing but say so", [__ui.shown.length, member.heard.filter(m => m.includes("Admin+ is turned off here")).length], [0, 2])
    // A command their rank can't use says that first, as it always has: the
    // permission check comes before the gate, and either way nothing runs.
    const refused = __test.invoke(`${NS}:admin`, member)
    await settle()
    check("one their rank can't use still says so first, and runs nothing", [__ui.shown.length, String(refused?.message ?? "").includes("don't have permission")], [0, true])
}

console.log("\n— an operator the owner chose is the owner's —")
{
    fresh()
    dev.commandPermissionLevel = 0
    // The owner made this developer an operator themselves (their own world).
    const trusted = fakePlayer("t-trusted", "TrustedDev", 1)
    check("a developer the owner made an operator is an owner like any operator", [ownsServer(trusted), asksTerms(trusted), needsTerms(trusted)], [true, true, true])
    __ui.answers.push(press(0))
    __test.invoke(`${NS}:menu`, trusted)
    await settle()
    check("so on their own world they see the terms and can accept them", [termsShown(), serverAccepted()], [true, true])
    check("nothing is given to someone already an operator, and nothing noted", [ops().includes('op "TrustedDev"'), developerOps().includes(trusted.id)], [false, false])
    check("the visiting developer is opped as before", ops().includes('op "VisitingDev"'), true)
    __test.commands.length = 0
    __ui.answers.push(press(1))
    await termsScreen(trusted)
    await settle()
    check("a decline never deops an operator the owner chose", ops().includes('deop "TrustedDev"'), false)
    check("but takes back the one Admin+ gave", ops().includes('deop "VisitingDev"'), true)
    __test.players.splice(__test.players.indexOf(trusted), 1)
}

console.log("\n— a developer who was away —")
{
    fresh()
    dev.commandPermissionLevel = 0
    acceptTerms(owner)
    developerJoined(dev)
    check("accepted, and the developer is opped when they join", [ops(), developerOps()], [['op "VisitingDev"'], [dev.id]])
    dev.commandPermissionLevel = 1
    __test.players.splice(__test.players.indexOf(dev), 1) // they leave
    __test.commands.length = 0
    __ui.answers.push(press(1))
    await termsScreen(owner)
    await settle()
    check("declined while they're away: nothing to run yet, and Admin+ remembers", [ops(), developerOps()], [[], [dev.id]])
    __test.players.push(dev)
    developerJoined(dev)
    check("the op is taken back as soon as they're in the world", [ops(), developerOps()], [['deop "VisitingDev"'], []])
    dev.commandPermissionLevel = 0
}

console.log("\n— new terms in an update —")
{
    fresh()
    __setWorldTermsRaw({ status: "declined", version: TERMS_VERSION - 1, by: "old", at: 1 })
    check("a decline of older terms keeps Admin+ off: an update must not switch it back on", adminplusDisabled(), true)
    check("and an owner is shown the new terms", needsTerms(owner), true)
    fresh()
    acceptTerms(owner)
    developerJoined(dev)
    __setWorldTermsRaw({ status: "accepted", version: TERMS_VERSION - 1, by: "old", at: 1 })
    check("older terms accepted: Admin+ stays on, but nobody has accepted these", [adminplusDisabled(), serverAccepted(), needsTerms(owner)], [false, false, true])
    check("so the grant waits for an owner", [has(dev, "admin.ban"), topWeight(dev) === Infinity], [false, false])
    __test.commands.length = 0
    developerJoined(dev)
    check("and the op Admin+ gave under the old terms is taken back", [ops(), developerOps()], [['deop "VisitingDev"'], []])
}

console.log("\n— closing the terms is not an answer —")
{
    fresh()
    owner.heard.length = 0
    __ui.answers.push(closed)
    __test.invoke(`${NS}:menu`, owner)
    await settle()
    check("closing the terms answers nothing and runs nothing", [termsAnswer(owner), serverAccepted(), adminplusDisabled(), __ui.shown.length], [undefined, false, false, 1])
    check("and says what is true: commands open the terms, and Admin+ is not off",
        [owner.heard.some(m => m.includes("Your Admin+ commands open the terms until an owner accepts them")), owner.heard.some(m => m.includes("Admin+ is off for this server"))], [true, false])
    check("the grant is still off", has(dev, "admin.ban"), false)
}

console.log("\n— two owners, and one screen each —")
{
    fresh()
    const owner2 = fakePlayer("t-owner2", "Coowner", 1)
    __ui.answers.push(press(1))
    await termsScreen(owner)
    __ui.answers.push(press(0))
    await termsScreen(owner2)
    await settle()
    check("one owner declines, another accepts: the last answer stands, and it is on", [adminplusDisabled(), serverAccepted()], [false, true])
    check("each owner's own answer is kept for the record", [termsAnswer(owner)?.answer, termsAnswer(owner2)?.answer], ["decline", "accept"])
    fresh()
    __ui.answers.push(press(0))
    const first = termsScreen(owner), second = termsScreen(owner)
    await first
    check("asking twice while it's open shows one screen", [first === second, __ui.shown.length], [true, 1])
    __test.players.splice(__test.players.indexOf(owner2), 1)
}

console.log("\n— nobody becomes a developer by their name above the head —")
{
    const lookalike = fakePlayer("t-look", "Steve")
    lookalike.nameTag = CREATOR_GAMERTAG
    check("only the gamertag counts", [isDeveloper(lookalike), isDeveloper({ name: CREATOR_GAMERTAG })], [false, true])
    __test.players.splice(__test.players.indexOf(lookalike), 1)
}

console.log("\n— what the terms say, and what is kept —")
{
    const text = plain(TERMS_LINES.join("\n"))
    check("the terms say developers are made operators", text.includes("Admin+ also makes them an operator here"), true)
    check("that none of it applies until an owner accepts", text.includes("None of this applies until an owner accepts"), true)
    check("and that a decline takes the operator status back", text.includes("the operator status Admin+ gave them as soon as they are in the world"), true)
    check("bans, the allowlist and freezes stop while off, and come back on an accept", text.includes("Bans, the allowlist and freezes stop too, and come back as they were when an owner accepts"), true)
    check("the version went up with the words", TERMS_VERSION, 3)
    check("a factory reset keeps who Admin+ made an operator", KEPT_BY_RESET.includes("devOps"), true)
}

console.log("\n— everything that acts by itself steps aside while off —")
{
    fresh()
    // Spawn protection against PvP (both ways of refusing a hit).
    setSetting("spawn.protect", "true")
    setSpawn(member)
    const health = { currentValue: 12, effectiveMax: 20, setCurrentValue(v) { this.currentValue = v; return true } }
    const victim = fakePlayer("t-victim", "Vic")
    setRanks(victim.id, ["member"], victim.name)
    victim.getComponent = id => id === "minecraft:health" ? health : undefined
    setWorldTerms("declined", "test")
    member.heard.length = 0
    __test.emitEntityHurt(victim, member, undefined, 4)
    __test.runTimers()
    check("off: a hit at spawn is left alone, no health back and no message", [health.currentValue, member.heard.some(m => m.includes("No fighting"))], [12, false])
    setWorldTerms("accepted", "test")
    __test.emitEntityHurt(victim, member, undefined, 4)
    __test.runTimers()
    check("on: spawn protection gives the health back (the check is real)", [health.currentValue, member.heard.some(m => m.includes("No fighting"))], [16, true])
    setSetting("spawn.protect", "false")
    __test.players.splice(__test.players.indexOf(victim), 1)

    // The Omnitool, a staff item like the others.
    setWorldTerms("declined", "test")
    __ui.shown.length = 0; __ui.answers.length = 0
    __test.emitItemUse(owner, { typeId: OMNI_TYPES[0] })
    __test.runTimers()
    await settle()
    check("off: the Omnitool does nothing", __ui.shown.length, 0)
    setWorldTerms("accepted", "test")
    __test.emitItemUse(owner, { typeId: OMNI_TYPES[0] })
    __test.runTimers()
    await settle()
    check("on: it opens its menu (the check is real)", __ui.shown.length, 1)

    // A lag clear counting down when Admin+ is turned off.
    const started = runClear({ seconds: 2 })
    setWorldTerms("declined", "test")
    __test.runTimers()
    setWorldTerms("accepted", "test")
    owner.heard.length = 0
    runClear({ by: owner, seconds: 0 })
    __test.runTimers()
    check("a lag clear counting down stops when Admin+ is turned off, and the next one can run",
        [started, owner.heard.some(m => m.includes("already running"))], [true, false])

    // "Admin+ is ready" for staff joining, which would be untrue while off.
    const main = readFileSync("Admin+ BP/scripts/main.js", "utf8")
    check("staff aren't told Admin+ is ready while it is off", /if \(!adminplusDisabled\(\) && has\(player, "admin\.panel"\)\)/.test(main), true)

    // A server preset through /scriptevent (last: it rewrites the ranks).
    setWorldTerms("declined", "test")
    owner.heard.length = 0
    const presetsApplied = () => recent(200).filter(e => e.action === "config.serverPreset").length
    const before = presetsApplied()
    applyByEvent(owner, "smp")
    check("off: a preset through /scriptevent does nothing but say so", [presetsApplied() - before, owner.heard.some(m => m.includes("Admin+ is turned off here"))], [0, true])
    setWorldTerms("accepted", "test")
    applyByEvent(owner, "smp")
    check("on: it applies (the check is real)", presetsApplied() - before, 1)
    applyPreset("server")
}

console.log("\n— bans, the allowlist and freezes step aside while off (3.1.7) —")
{
    // The user: "bans turn off - it causes a problem if your forced to accept
    // just to lift a ban". The same goes for anything else that holds a
    // player: the allowlist, maintenance and a freeze. Each record stays, and
    // applies again the moment an owner accepts.
    fresh()
    const banny = fakePlayer("t-banny", "Banny")
    await ban(banny, 0, "testing", owner)
    setWorldTerms("declined", "test")
    check("off: a banned player joins and stays", await checkJoin(banny), "joined")
    check("and the ban is still on the books", isBanned(banny), true)
    setWorldTerms("accepted", "test")
    check("on: the same ban removes them again (the check is real)", await checkJoin(banny), "banned")
    unban(banny)

    const stranger = fakePlayer("t-stranger", "Strangely")
    setAllowlistOn(true)
    setWorldTerms("declined", "test")
    check("off: the allowlist turns nobody away", turnAwayOnJoin(stranger), false)
    setWorldTerms("accepted", "test")
    check("on: it does (the check is real)", turnAwayOnJoin(stranger), true)
    setAllowlistOn(false)
    setMaintenance(true, "testing")
    setWorldTerms("declined", "test")
    check("off: maintenance turns nobody away", turnAwayOnJoin(stranger), false)
    setWorldTerms("accepted", "test")
    check("on: it does (the check is real)", turnAwayOnJoin(stranger), true)
    setMaintenance(false)

    const inputs = []
    const icy = fakePlayer("t-icy", "Icy")
    icy.inputPermissions = { setPermissionCategory: (category, enabled) => inputs.push(enabled) }
    setFrozen(icy, true)
    inputs.length = 0
    __ui.answers.push(press(1))
    await termsScreen(owner)
    await settle()
    check("a decline lets a frozen player move, and keeps the freeze on the books", [inputs.length > 0 && inputs.every(Boolean), isFrozen(icy)], [true, true])
    inputs.length = 0
    __ui.answers.push(press(0))
    await termsScreen(owner)
    await settle()
    check("an accept holds them again", inputs.length > 0 && inputs.every(on => on === false), true)
    setFrozen(icy, false)
    for (const p of [banny, stranger, icy]) __test.players.splice(__test.players.indexOf(p), 1)
}

console.log("\n— every file that listens to the game checks, or says why not —")
{
    // "Anything new that acts by itself checks adminplusDisabled() first"
    // (CLAUDE.md). A file that subscribes to an event or runs a timer must
    // either check it or be listed here with the reason it may keep going.
    const NEEDN_T = {
        "core/enderblock.js": "puts back blocks an old version placed",
        "core/enderview.js": "closes a staff view of an ender chest when someone leaves",
        "core/health.js": "warns that the game can't run Admin+ (Beta APIs off)",
        "core/hiding.js": "keeps a player hidden who already was (said in the 3.1.6 notes)",
        "core/holograms.js": "floating text already placed stays (said in the 3.1.6 notes)",
        "core/registry.js": "it is the command gate itself",
        "core/storage.js": "reads the world's saved data",
        "core/teleport.js": "finishes a teleport already counting down",
        "core/vanish.js": "keeps a vanished player vanished (said in the 3.1.6 notes)",
        "features/back.js": "notes where a player died, and does nothing to anyone",
        "features/chatcheck.js": "loads the chat model, and does nothing to anyone",
        "features/chatmod.js": "forgets a player's counts when they leave",
        "features/grant.js": "a timed grant ending gives things back",
        "features/nameanim.js": "goes through refreshNameTag, which steps aside",
        "features/privatechat.js": "says when a private chat invite runs out",
        "features/tpa.js": "lets a teleport request run out"
    }
    const root = "Admin+ BP/scripts"
    const files = []
    const walk = dir => {
        for (const name of readdirSync(join(root, dir))) {
            const rel = dir ? `${dir}/${name}` : name
            if (statSync(join(root, rel)).isDirectory()) walk(rel)
            else if (rel.endsWith(".js")) files.push(rel)
        }
    }
    walk("")
    const listens = /\.subscribe\s*\(|\.subscribe\?\.\(|runInterval\s*\(/
    const unchecked = files.filter(rel => {
        const src = readFileSync(join(root, rel), "utf8")
        return listens.test(src) && !src.includes("adminplusDisabled") && !NEEDN_T[rel]
    })
    check("no file acts on the game while off without saying why", unchecked, [])
    const stale = Object.keys(NEEDN_T).filter(rel => {
        try { return !listens.test(readFileSync(join(root, rel), "utf8")) } catch { return true }
    })
    check("and every reason on the list is still needed", stale, [])
}

__setTeamDevelopers([])
__resetTerms()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
