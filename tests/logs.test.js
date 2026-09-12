import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, heldRankIds, grantRank } from "../Admin+ BP/scripts/core/ranks.js"
import { applyUndo, dayLabel, clockOf, readLine } from "../Admin+ BP/scripts/features/logsUI.js"
import { ban, isBanned, mute, isMuted } from "../Admin+ BP/scripts/core/moderation.js"
import { setNickname, getNickname } from "../Admin+ BP/scripts/core/identity.js"
import { setSetting, setting, overrides, replaceOverrides } from "../Admin+ BP/scripts/core/settings.js"
import {
    record, recent, about, by, branch, search, people, getEntry,
    canUndo, markUndone, clear, size
} from "../Admin+ BP/scripts/core/logs.js"

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
        id: `g${nextId++}`, name, nameTag: name, commandPermissionLevel: 0,
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: () => {}
    }
    __test.players.push(p)
    return p
}

const firelite = fakePlayer("Firelite") ; onPlayerJoin(firelite) ; setRanks(firelite.id, ["admin"], firelite.name)
const modder = fakePlayer("Modder")     ; onPlayerJoin(modder)   ; setRanks(modder.id, ["mod"], modder.name)
const nova = fakePlayer("Nova")         ; onPlayerJoin(nova)

clear()

console.log("\n— recording —")
const banEntry = record(firelite, "mod.ban", nova, "grief · 7d", { kind: "ban" })
record(modder, "mod.mute", nova, "caps · permanent", { kind: "mute" })
record(firelite, "rank.grant", modder, "mod", { kind: "ranks", ranks: ["member"] })
record(firelite, "config.edit", undefined, "2 values", { kind: "config", overrides: {} })
check("four entries", size(), 4)
check("newest first", recent(1)[0].action, "config.edit")
check("both sides are recorded", [banEntry.actor.name, banEntry.target.name], ["Firelite", "Nova"])

console.log("\n— indexed by BOTH sides, which is the whole point —")
check("what was done TO Nova", about(nova.id).map(e => e.action), ["mod.mute", "mod.ban"])
check("Nova did nothing", by(nova.id).length, 0)
check("what Modder DID", by(modder.id).map(e => e.action), ["mod.mute"])
check("and what was done TO Modder", about(modder.id).map(e => e.action), ["rank.grant"])
check("an actor with no target still files", by(firelite.id).length, 3)

console.log("\n— branch filtering —")
check("mod branch", branch("mod").length, 2)
check("rank branch", branch("rank").length, 1)
check("config branch", branch("config").length, 1)
check("a branch matches its own prefix, not a lookalike", branch("mo").length, 0)

console.log("\n— search —")
check("by target name", search("nova").length, 2)
check("by detail text", search("grief").map(e => e.action), ["mod.ban"])
check("by action", search("rank.grant").length, 1)
check("empty search finds nothing", search("   ").length, 0)

console.log("\n— people —")
check("everyone the log has touched", people().map(p => p.name).sort(), ["Firelite", "Modder", "Nova"])

console.log("\n— undo state —")
check("an entry with prior state can be undone", canUndo(getEntry(banEntry.id)), true)
check("a bare entry cannot", canUndo(record(firelite, "mod.kick", nova, "afk")), false)
check("the undo payload holds PRIOR state, not a reverse action",
    getEntry(recent(20).find(e => e.action === "rank.grant").id).undo, { kind: "ranks", ranks: ["member"] })
markUndone(getEntry(banEntry.id), modder)
check("marked undone by whom", getEntry(banEntry.id).undone.by, "Modder")
check("and cannot be undone twice", canUndo(getEntry(banEntry.id)), false)

console.log("\n— undo restores PRIOR state, not a reverse action —")

// The case that separates the two: demote, then something else changes, then
// undo. "Re-add what was removed" would be wrong; "restore what they held" is
// right.
setRanks(nova.id, ["member"], nova.name)
const priorRanks = heldRankIds(nova.id)
grantRank(nova.id, "mod", nova.name)
const rankEntry = record(firelite, "rank.grant", nova, "mod", { kind: "ranks", ranks: priorRanks })
grantRank(nova.id, "admin", nova.name)          // something else happens after
// Ranks stack, so they now hold both — which is precisely why undo has to
// restore what they HELD rather than reverse the one action it recorded.
check("they hold both before the undo", heldRankIds(nova.id).sort(), ["admin", "mod"])
check("undo applies", applyUndo(rankEntry), true)
check("and lands on exactly what they held", heldRankIds(nova.id), priorRanks)

console.log("\n— undo across the other kinds —")
ban(nova, 0, "grief", firelite)
const banEntry2 = record(firelite, "mod.ban", nova, "grief", { kind: "ban" })
check("banned", isBanned(nova), true)
check("undo lifts it", applyUndo(banEntry2) && isBanned(nova), false)

mute(nova, 0, "caps", firelite)
const muteEntry = record(firelite, "mod.mute", nova, "caps", { kind: "mute" })
check("muted", isMuted(nova), true)
check("undo lifts it", applyUndo(muteEntry) && isMuted(nova), false)

setNickname(nova, "OldName")
const before = getNickname(nova)
setNickname(nova, "NewName")
const nickEntry = record(firelite, "name.set", nova, "NewName", { kind: "nickname", previous: before })
check("nickname changed", getNickname(nova), "NewName")
check("undo puts the old one back", applyUndo(nickEntry) && getNickname(nova), "OldName")
setNickname(nova, "")

replaceOverrides({})
setSetting("bracket.open", "<<")
const priorConfig = overrides()
setSetting("bracket.close", ">>")
const cfgEntry = record(firelite, "config.edit", undefined, "2 values", { kind: "config", overrides: priorConfig })
check("config has both edits", Object.keys(overrides()).sort(), ["bracket.close", "bracket.open"])
check("undo restores the earlier block", applyUndo(cfgEntry) && Object.keys(overrides()), ["bracket.open"])
replaceOverrides({})

check("an entry with no undo payload does nothing", applyUndo({ action: "mod.kick" }), false)

console.log("\n— the ring buffer cannot grow forever —")
clear()
for (let i = 0; i < 320; i++) record(firelite, "mod.kick", nova, `spam ${i}`)
check("capped at the configured limit", size(), 300)
check("the newest survived", recent(1)[0].detail, "spam 319")
check("the oldest were dropped", search("spam 0").length, 0)

clear()

console.log("\n— logs read as text, grouped by day —")
// They used to be a wall of buttons, one per entry, the text in §8 on a grey
// button face — the thing you were trying to read was the least legible part of
// the screen. The entries live in the form body now, the way Credits does it.
{
    const now = Date.now()
    const day = 864e5
    check("today is named, not dated", dayLabel(now), "Today")
    check("so is yesterday", dayLabel(now - day), "Yesterday")
    // Anything older gets a date. Checked as a shape rather than a literal, so
    // this does not fail once a day forever.
    check("older entries get a day and a month",
        /^\d{1,2} [A-Z][a-z]{2}$/.test(dayLabel(now - 5 * day)), true)
    // Local time, deliberately: the person reading is standing in the world and
    // "yesterday" should mean their yesterday, not UTC's.
    const noon = new Date(); noon.setHours(14, 5, 0, 0)
    check("the clock is local and zero-padded", clockOf(noon.getTime()), "14:05")

    // The palette is the actual complaint. §8 for the timestamp is fine — it is
    // a label — but the sentence must not be §8, and neither must the actor.
    const entry = { at: now, actor: { name: "Alex" }, action: "mod.ban",
                    detail: "griefing", summary: "Banned Steve" }
    const [first, second] = readLine(entry)
    check("the time is dim", first.startsWith("§8"), true)
    check("but the sentence is white", first.includes("§f"), true)
    check("and the actor is §7, not §8 — that was the part that vanished",
        second.includes("§7Alex"), true)
    check("an undone entry says so", readLine({ ...entry, undone: true })[0].includes("undone"), true)
    check("a console entry names the console",
        readLine({ ...entry, actor: undefined })[1].includes("console"), true)
    check("no detail means no trailing separator",
        readLine({ ...entry, detail: "" })[1].includes("·"), false)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
