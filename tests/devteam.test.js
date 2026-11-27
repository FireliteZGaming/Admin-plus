import { readFileSync } from "node:fs"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setWorldTerms } from "../Admin+ BP/scripts/core/terms.js"
import {
    onPlayerJoin, setRanks, grantRank, revokeRank, applyPreset, saveRank,
    displayRanks, primaryRank, hiddenRanks, CREATOR_GAMERTAG, __setTeamDevelopers
} from "../Admin+ BP/scripts/core/ranks.js"
import { DEV_PREFS, devPref, setDevPref } from "../Admin+ BP/scripts/core/prefs.js"
import { hide, unhide } from "../Admin+ BP/scripts/core/hiding.js"
import { ranksScreen, developerScreen } from "../Admin+ BP/scripts/features/ranksUI.js"

// 3.1.9, the user, 2026-11-27: "for the developer tag, i want to actually
// appear in a section called 'Dev Team' in ranks, of course this section only
// appears if the dev is actually in the game ... it'll be like how cosmetic
// and default/staff have their own section, but this section appears at the
// top of ranks only when a developer joins, and you can click the developer
// tag, and it will give you information about developer rank, developer rank
// also can't be replaced by any other role either, unless the developer
// themselves goes into the developer rank (which they can edit themselves)
// and toggles the perminant toggle off".
//
// Every check goes through the real Ranks screens and the real rank code.

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
        id: `d${nextId++}`, name, nameTag: name, inbox: [],
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t),
        hasTag: t => tags.has(t),
        getEffect: () => undefined,
        addEffect: () => true,
        removeEffect: () => true,
        sendMessage: m => p.inbox.push(typeof m === "string" ? m : JSON.stringify(m)),
        dimension: { id: "minecraft:overworld", runCommand: () => ({ successCount: 1 }) }
    }
    __test.players.push(p)
    onPlayerJoin(p)
    return p
}
const leave = p => { const at = __test.players.indexOf(p); if (at >= 0) __test.players.splice(at, 1) }
const press = selection => ({ canceled: false, selection })
const submit = formValues => ({ canceled: false, formValues })
const clean = s => String(s ?? "").replace(/§./g, "")
// A badge is one private-use character and a space in front of a name.
const unbadged = s => s.replace(/^[-] /, "")
const partsOf = (form, kind) => form.parts.filter(p => p[0] === kind)
const labelsOf = form => partsOf(form, "label").map(p => clean(p[1]))
const buttonsOf = form => partsOf(form, "button").map(p => unbadged(clean(p[1])))
const bodyOf = form => clean(partsOf(form, "body")[0]?.[1])
const titleOf = form => clean(partsOf(form, "title")[0]?.[1])

/** Open a screen with these answers queued; every form it showed, in order. */
async function open(screen, answers = []) {
    __ui.answers.length = 0
    __ui.shown.length = 0
    __ui.answers.push(...answers)
    await screen()
    return [...__ui.shown]
}

applyPreset("server")
const boss = fakePlayer("Boss", { op: true })
setRanks(boss.id, ["owner"], boss.name)

console.log("\n— no developer here: Ranks is as it was —")
{
    const [list] = await open(() => ranksScreen(boss, () => {}))
    check("no Dev Team section", labelsOf(list).includes("Dev Team"), false)
    check("the list opens on In the order", labelsOf(list)[0], "In the order")
}

console.log("\n— a developer joins: Dev Team at the top —")
const dev = fakePlayer(CREATOR_GAMERTAG)
{
    const [list] = await open(() => ranksScreen(boss, () => {}))
    check("Dev Team is the first section", labelsOf(list)[0], "Dev Team")
    check("and says what it is", labelsOf(list)[1], "The people who make Admin+. Shown while one of them is here.")
    check("In the order still follows", labelsOf(list)[2], "In the order")
    check("its button is the Developer rank, with who is here", buttonsOf(list)[0], "Developer\nthe Admin+ team · 1 here")
    check("the first rank in the order is still next", buttonsOf(list)[1].includes("Owner"), true)
}

console.log("\n— tapping it, as staff: information only —")
{
    const [, page] = await open(() => ranksScreen(boss, () => {}), [press(0)])
    check("it opens the Developer page", titleOf(page).includes("Developer"), true)
    check("it says who wears it", bodyOf(page).includes("the people who make Admin+, named by gamertag in Admin+'s own code"), true)
    check("that nobody can be given it", bodyOf(page).includes("Nobody can be given this rank or have it taken away."), true)
    check("who is here now", bodyOf(page).includes(`Here now: ${CREATOR_GAMERTAG}`), true)
    check("what Permanent means", bodyOf(page).includes("no rank from this server replaces a permanent Developer tag"), true)
    check("a staff member can only read it: just Back", buttonsOf(page), ["< Back"])
    check("and is told why", bodyOf(page).includes("Only a developer can change their own tag."), true)
}

console.log("\n— what it can do, as it is on this server —")
{
    const read = async () => bodyOf((await open(() => developerScreen(boss, () => {})))[0])
    check("before an owner accepts the terms: nothing extra yet", (await read()).includes("nothing extra yet"), true)
    setWorldTerms("accepted", "test")
    check("accepted: full control and operator status", (await read()).includes("full control of Admin+, and operator status"), true)
    setWorldTerms("declined", "test")
    check("declined: nothing, because Admin+ is off", (await read()).includes("This server declined Admin+'s terms"), true)
    setWorldTerms("accepted", "test")
}

console.log("\n— Permanent: no other rank replaces it —")
saveRank("sparkle", { display: "§eSparkle", type: "cosmetic", staff: false, perms: [], inherits: [] })
{
    check("Permanent starts on", devPref(dev, "dev.permanent"), true)
    grantRank(dev.id, "admin", dev.name)
    check("a rank from this server doesn't replace the tag", primaryRank(dev).id, "adminplus_dev")
    check("the rank is still theirs, listed as not shown", hiddenRanks(dev).some(rank => rank.id === "admin"), true)
    grantRank(dev.id, "sparkle", dev.name)
    check("a cosmetic rank follows it, as it follows anyone's main tag", displayRanks(dev).map(rank => rank.id), ["adminplus_dev", "sparkle"])
    revokeRank(dev.id, "sparkle")
}

console.log("\n— the developer turns it off, from the Developer page —")
{
    // Ranks ▸ Dev Team ▸ Developer ▸ Permanent, switch off, Save. The
    // developer can open Ranks because the server accepted the terms.
    dev.inbox.length = 0
    const shown = await open(() => ranksScreen(dev, () => {}), [press(0), press(0), submit([undefined, false])])
    check("a developer gets their own Permanent button", buttonsOf(shown[1])[0].startsWith("Permanent\non"), true)
    check("behind it, one switch", partsOf(shown[2], "toggle").map(p => clean(p[1])), ["Permanent"])
    check("Permanent is off now", devPref(dev, "dev.permanent"), false)
    check("so the server's rank shows instead", primaryRank(dev).id, "admin")
    check("and the Developer tag is gone from their tags", displayRanks(dev).some(rank => rank.id === "adminplus_dev"), false)
    check("they're told what changed", dev.inbox.some(m => clean(m).includes("isn't permanent")), true)
    revokeRank(dev.id, "admin")
    check("off, it still stands in for the starting rank, as before 3.1.9", primaryRank(dev).id, "adminplus_dev")
    grantRank(dev.id, "admin", dev.name)
}
{
    await open(() => developerScreen(dev, () => {}), [press(0), submit([undefined, true])])
    check("switched back on, Developer shows over the server's rank again", primaryRank(dev).id, "adminplus_dev")
    revokeRank(dev.id, "admin")
}

console.log("\n— each developer decides for themselves —")
__setTeamDevelopers(["HiredDev"])
const hired = fakePlayer("HiredDev")
{
    check("both start permanent", [devPref(dev, "dev.permanent"), devPref(hired, "dev.permanent")], [true, true])
    setDevPref(hired, "dev.permanent", false)
    check("one turning it off leaves the other's alone", [devPref(dev, "dev.permanent"), devPref(hired, "dev.permanent")], [true, false])
    const [list] = await open(() => ranksScreen(boss, () => {}))
    check("two here", buttonsOf(list)[0], "Developer\nthe Admin+ team · 2 here")
    const [page] = await open(() => developerScreen(boss, () => {}))
    check("the page says whose tag isn't permanent", bodyOf(page).includes("HiredDev (not permanent)"), true)
    check("only a developer key is stored", setDevPref(boss, "made.up", true), false)
}
leave(hired)
__setTeamDevelopers([])

console.log("\n— a hidden developer isn't here to anyone else —")
{
    hide(dev, "vanish")
    const [forStaff] = await open(() => ranksScreen(boss, () => {}))
    check("staff see no Dev Team while they're hidden", labelsOf(forStaff).includes("Dev Team"), false)
    const [forThem] = await open(() => ranksScreen(dev, () => {}))
    check("the developer still sees it, to reach their own switch", labelsOf(forThem)[0], "Dev Team")
    unhide(dev, "vanish")
}

console.log("\n— the developer leaves —")
leave(dev)
{
    const [list] = await open(() => ranksScreen(boss, () => {}))
    check("Dev Team goes with them", labelsOf(list).includes("Dev Team"), false)
}

console.log("\n— every developer switch is read by the file it names —")
for (const [key, spec] of Object.entries(DEV_PREFS)) {
    const src = readFileSync(new URL(`../Admin+ BP/scripts/${spec.readBy}`, import.meta.url), "utf8")
    check(`${key} is actually read by ${spec.readBy}`, src.includes(`"${key}"`), true)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
