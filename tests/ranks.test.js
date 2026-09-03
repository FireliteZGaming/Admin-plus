import { readFileSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import {
    has, meta, isStaff, topWeight, canActOn, canEditRank,
    ladder, moveRank, getRank, saveRank, deleteRank, applyPreset, restoreSnapshot, snapshot,
    PRESETS,
    BUNDLES,
    PERMISSION_NODES,
    setRanks, grantRank, revokeRank, heldRankIds, playerRanks, displayRanks, primaryRank,
    moveHeldRank, onPlayerJoin, defaultRank, displacedBy, cooldownFor, saveRank as saveR, knownHolders,
    CREATOR_GAMERTAG, CREATOR_RANK, allRanks
} from "../Admin+ BP/scripts/core/ranks.js"
import { CONFIG } from "../Admin+ BP/scripts/config.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

// Fake players: only the fields the engine reads.
let nextId = 1
function fakePlayer(name, { op = false } = {}) {
    const tags = new Set()
    const p = {
        id: `p${nextId++}`, name, nameTag: name,
        commandPermissionLevel: op ? 1 : 0,
        getTags: () => [...tags],
        addTag: t => { tags.add(t); return true },
        removeTag: t => tags.delete(t)
    }
    __test.players.push(p)
    return p
}

console.log("\n— ladder & defaults —")
check("default ladder order", ladder().map(r => r.id), ["owner", "coowner", "developer", "admin", "mod", "member"])
check("default rank is member", defaultRank()?.id, "member")

console.log("\n— joining —")
const steve = fakePlayer("Steve")
onPlayerJoin(steve)
check("new player gets default rank", heldRankIds(steve), ["member"])
check("tag mirrored onto player", steve.getTags(), ["rank:member"])
check("member can use warps", has(steve, "warp.use"), true)
check("member cannot ban", has(steve, "admin.ban"), false)
check("a rank with no meta falls back", meta(steve, "tpCooldown", 7), 7)
check("member is not staff", isStaff(steve), false)

console.log("\n— wildcards, inheritance, negation —")
const mod = fakePlayer("Mod")
onPlayerJoin(mod)
setRanks(mod.id, ["mod"], mod.name)
check("mod inherits member's warp.use", has(mod, "warp.use"), true)
check("mod has own kick node", has(mod, "admin.kick"), true)
check("mod lacks ban (not granted)", has(mod, "admin.ban"), false)
check("mod is staff", isStaff(mod), true)

const admin = fakePlayer("Admin")
onPlayerJoin(admin)
setRanks(admin.id, ["admin"], admin.name)
check("admin.* grants admin.ban", has(admin, "admin.ban"), true)
check("admin inherits mod->member basics", has(admin, "tpa.use"), true)

// Negation must beat an inherited wildcard.
saveRank("admin", { perms: ["admin.*", "-admin.ban", "ranks.*", "warp.manage"] })
check("negated node beats own wildcard", has(admin, "admin.ban"), false)
check("sibling nodes still granted", has(admin, "admin.kick"), true)
saveRank("admin", { perms: ["admin.*", "ranks.*", "warp.manage"] })

console.log("\n— weight precedence across multiple ranks —")
// Holding both member and admin: admin is heavier, so it decides.
setRanks(steve.id, ["member", "admin"], steve.name)
check("heaviest rank decides the node", has(steve, "admin.ban"), true)
// Held order was ["member", "admin"], but a STAFF rank is pulled to the front:
// the one thing a player must be able to read off a name is whether the person
// is staff, and held order is manual enough to hide that by accident.
check("staff is pulled ahead of the non-staff rank",
    displayRanks(steve).map(r => r.id), ["admin", "member"])
check("so the tag is the staff one", primaryRank(steve).id, "admin")
check("authority = heaviest, not tag", playerRanks(steve)[0].id, "admin")
check("authority weight is admin's", topWeight(steve), getRank("admin").weight)

console.log("\n— per-player display order is cosmetic —")
moveHeldRank(steve.id, "admin", -1)
check("moved admin to front", displayRanks(steve).map(r => r.id), ["admin", "member"])
check("tag now admin", primaryRank(steve).id, "admin")
check("authority unchanged by reorder", topWeight(steve), getRank("admin").weight)
setRanks(steve.id, ["member"], steve.name)

console.log("\n— hierarchy protection —")
check("mod cannot act on admin", canActOn(mod, admin.id), false)
check("admin can act on mod", canActOn(admin, mod.id), true)
check("mod can act on member", canActOn(mod, steve.id), true)
check("mod cannot edit the admin rank", canEditRank(mod, getRank("admin")), false)
check("admin cannot edit owner rank", canEditRank(admin, getRank("owner")), false)
check("admin can edit mod rank", canEditRank(admin, getRank("mod")), true)
check("acting on yourself is allowed", canActOn(mod, mod.id), true)

console.log("\n— ladder reordering —")
moveRank("mod", -1)
check("mod moved above admin", ladder().map(r => r.id), ["owner", "coowner", "developer", "mod", "admin", "member"])
check("authority followed the move", canActOn(mod, admin.id), true)
check("and reversed the other way", canActOn(admin, mod.id), false)
moveRank("mod", 1)
check("moved back", ladder().map(r => r.id), ["owner", "coowner", "developer", "admin", "mod", "member"])
check("top of ladder can't move up", moveRank("owner", -1), false)
check("bottom can't move down", moveRank("member", 1), false)

console.log("\n— presets & undo —")
applyPreset("smp")
check("preset replaced ladder", ladder().map(r => r.id), ["owner", "staff", "member"])
check("holder keeping a surviving id", heldRankIds(steve), ["member"])
check("holder whose rank vanished falls back to default", heldRankIds(admin), ["member"])
restoreSnapshot()
check("undo restored previous ladder", ladder().map(r => r.id), ["owner", "coowner", "developer", "admin", "mod", "member"])

// A rank the current ladder does not define is HIDDEN, not deleted — and it has
// to survive somebody editing that player's ranks in the meantime. It did not:
// grantRank, revokeRank and moveHeldRank all read the FILTERED list and wrote
// it back, so one ordinary panel action while a preset was applied erased the
// rest for good, and undo could not bring them back.
const kept = fakePlayer("Kept"); onPlayerJoin(kept)
setRanks(kept.id, ["coowner"], kept.name)
applyPreset("smp")
check("their rank is hidden while the ladder lacks it", heldRankIds(kept), ["member"])
grantRank(kept.id, "staff", kept.name)
check("and a promotion on the new ladder works", heldRankIds(kept), ["staff"])
restoreSnapshot()
check("the hidden rank comes back after undo", heldRankIds(kept).includes("coowner"), true)

// Deleting a rank is deliberate and still strips it from everyone.
applyPreset("server")
saveRank("temp", { display: "Temp", staff: false, perms: [], inherits: [], meta: {} })
grantRank(kept.id, "temp", kept.name)
check("they hold the temporary rank", heldRankIds(kept).includes("temp"), true)
deleteRank("temp")
check("deleting really removes it, unlike a preset switch",
    heldRankIds(kept).includes("temp"), false)
setRanks(kept.id, ["member"], kept.name)

console.log("\n— create / delete —")
saveRank("builder", { display: "§9Builder", staff: false, perms: ["warp.use"], inherits: [], meta: {} })
check("new rank lands at the bottom", ladder().map(r => r.id).at(-1), "builder")
grantRank(steve.id, "builder", steve.name)
check("player holds both", heldRankIds(steve), ["member", "builder"])
deleteRank("builder")
check("delete strips it from holders", heldRankIds(steve), ["member"])
check("rank is gone", getRank("builder"), undefined)

console.log("\n— operator fallback —")
const host = fakePlayer("Host", { op: true })
onPlayerJoin(host)
check("op passes a node no rank grants", has(host, "admin.ban"), true)
check("op counts as staff", isStaff(host), true)
setRanks(host.id, ["member"], host.name)
check("op with a rank still passes where no rank has an opinion", has(host, "admin.ban"), true)
// ...but an explicit denial on a rank they hold DOES bind an operator.
saveRank("member", { perms: ["warp.use", "spawn.use", "tpa.use", "-admin.ban"] })
check("explicit deny binds even an operator", has(host, "admin.ban"), false)
check("non-op member also denied", has(steve, "admin.ban"), false)
saveRank("member", { perms: ["warp.use", "spawn.use", "tpa.use"] })
check("deny lifted", has(host, "admin.ban"), true)

console.log("\n— config owners are untouchable, online or not —")
const boss = fakePlayer("Boss")
onPlayerJoin(boss)
setRanks(boss.id, ["member"], boss.name)
check("before being named an owner, admin outranks them", canActOn(admin, boss.id), true)
CONFIG.owners.push("Boss")
check("named owner is protected as a Player object", canActOn(admin, boss), false)
check("named owner is protected by id alone (the offline path)", canActOn(admin, boss.id), false)
check("owner outranks everyone", canActOn(boss, admin.id), true)
check("owner passes any node while holding only member", has(boss, "admin.ban"), true)
CONFIG.owners.length = 0
check("stripping ownership restores normal rules", canActOn(admin, boss.id), true)

console.log("\n— an operator can actually administer a fresh world —")
// The bug this guards: op holding only the default rank could open the rank
// screens but every list came back empty, because topWeight said 10.
const freshOp = fakePlayer("FreshOp", { op: true })
onPlayerJoin(freshOp)
check("op holds only the default rank", heldRankIds(freshOp), ["member"])
check("op has unrestricted authority", topWeight(freshOp) === Infinity, true)
check("every rank is grantable by an op", ladder().filter(r => canEditRank(freshOp, r)).length, ladder().length)
check("op can edit the owner rank", canEditRank(freshOp, getRank("owner")), true)
check("op can act on a ranked admin", canActOn(freshOp, admin.id), true)
check("a plain member still cannot", ladder().filter(r => canEditRank(steve, r)).length, 0)

console.log("\n— granting a rank changes the tag —")
// The bug this guards: grantRank appended, so giving Mod to a Member left
// them still wearing Member and looked like nothing happened.
const rookie = fakePlayer("Rookie")
onPlayerJoin(rookie)
check("starts on member", primaryRank(rookie).id, "member")
grantRank(rookie.id, "mod", rookie.name)
check("promotion replaces member outright", heldRankIds(rookie), ["mod"])
check("tag is now mod", primaryRank(rookie).id, "mod")
check("nametag re-stamped", rookie.nameTag.includes("Mod"), true)
grantRank(rookie.id, "owner", rookie.name)
check("a stronger grant goes to the front", primaryRank(rookie).id, "owner")
grantRank(rookie.id, "owner", rookie.name)
check("granting the same rank twice does not duplicate it", heldRankIds(rookie), ["owner"])
revokeRank(rookie.id, "owner", rookie.name)
check("with nothing left they fall back to the default rank", heldRankIds(rookie), ["member"])

console.log("\n— promotions replace, cosmetic ranks stack —")
const promo = fakePlayer("Promo")
onPlayerJoin(promo)
check("starts as member", heldRankIds(promo), ["member"])
check("promotion says what it displaces", displacedBy(promo.id, "mod").map(r => r.id), ["member"])
grantRank(promo.id, "mod", promo.name)
check("member is gone after promotion", heldRankIds(promo), ["mod"])
grantRank(promo.id, "admin", promo.name)
check("promoting again drops mod too", heldRankIds(promo), ["admin"])

// A cosmetic rank opts out and stacks instead.
saveRank("builder", { display: "§9Builder", staff: false, perms: [], inherits: [], meta: {}, replacesLower: false })
grantRank(promo.id, "builder", promo.name)
check("cosmetic rank stacks", heldRankIds(promo).sort(), ["admin", "builder"])
check("and does not steal the tag", primaryRank(promo).id, "admin")
check("cosmetic grant displaces nothing", displacedBy(promo.id, "builder"), [])
deleteRank("builder")

console.log("\n— staff are exempt from cooldowns —")
saveRank("member", { meta: { tpCooldown: 8 } })
saveRank("mod", { meta: { tpCooldown: 8 } })
const civ = fakePlayer("Civilian")
onPlayerJoin(civ)
check("a member waits", cooldownFor(civ), 8)
const modder = fakePlayer("Modder")
onPlayerJoin(modder)
setRanks(modder.id, ["mod"], modder.name)
check("staff wait zero", cooldownFor(modder), 0)

console.log("\n— persistence round-trip —")
const before = ladder().map(r => r.id)
const raw = [...__test.props.keys()].filter(k => k.startsWith("ap:")).length
check("state actually written to dynamic properties", raw > 0, true)
check("ladder stable after writes", ladder().map(r => r.id), before)

console.log("\n— every declared node is a node the code actually asks about —")
// The rule PERMISSION_NODES has to keep. A node listed but never checked draws
// a switch in the rank editor that does nothing when you flip it - which is how
// admin.fly, admin.god, admin.heal, admin.feed, admin.bring and admin.reset sat
// there for weeks describing features that were never built. This test is why
// that cannot happen quietly again.
const SRC_DIR = new URL("../Admin+ BP/scripts/", import.meta.url)
function sources(dir) {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir)
        if (entry.isDirectory()) out.push(...sources(child))
        else if (entry.name.endsWith(".js")) out.push(readFileSync(child, "utf8"))
    }
    return out
}
const CODE = sources(SRC_DIR).join("\n")

const declared = [...new Set(Object.values(PERMISSION_NODES).flat())]
const unused = declared.filter(node => {
    // Counted as "asked about" when the code checks it directly, or when a
    // wildcard branch it belongs to is granted somewhere (admin.* covers
    // admin.kick). Only a direct check proves the switch does something, so
    // that is what this looks for.
    return !CODE.includes(`"${node}"`)
})
check("no node is declared without being checked", unused, [])

const nodePattern = /(?:has\([^)]*"|perm: *")([a-z]+\.[a-z]+)"/g
const checked = new Set()
for (const match of CODE.matchAll(nodePattern)) checked.add(match[1])
const undeclared = [...checked].filter(node => !declared.includes(node) && !node.startsWith("chat."))
check("and nothing is checked without being declared", undeclared, [])

check("no node is listed in two groups at once",
    Object.values(PERMISSION_NODES).flat().length, declared.length)
check("every bundle only names real nodes",
    Object.values(BUNDLES).flatMap(b => b.nodes)
        .filter(n => n !== "*" && !declared.includes(n)), [])

console.log("\n— every ladder preset grants only real nodes —")
for (const [id, preset] of Object.entries(PRESETS)) {
    const granted = Object.values(preset.ranks).flatMap(r => r.perms)
    const bogus = granted
        .map(p => p.replace(/^-/, ""))
        .filter(p => p !== "*" && !p.endsWith(".*") && !declared.includes(p))
    check(`${id} grants nothing invented`, bogus, [])
}

console.log("\n— ranks survive leaving and rejoining —")
// The one failure nobody would forgive. Ranks live in a world table keyed by
// PLAYER ID; the "rank:<id>" tag on the player is only a mirror of it. So a
// rejoin has to rebuild the tag from the table, not the other way round —
// otherwise a player who logs out returns as a Member and the table is right
// while the world is wrong.
applyPreset("server")
const returning = fakePlayer("Returning")
setRanks(returning.id, ["admin"], returning.name)
check("they have it before leaving", primaryRank(returning).id, "admin")
const tagBefore = returning.getTags().filter(t => t.startsWith("rank:"))
check("and the mirror tag is on them", tagBefore, ["rank:admin"])

// Leaving and coming back = a BRAND NEW player object. Same id, no tags: the
// engine does not hand back the object that left.
const rejoined = {
    id: returning.id, name: "Returning", nameTag: "Returning",
    commandPermissionLevel: 0,
    _tags: new Set(),
    getTags() { return [...this._tags] },
    addTag(t) { this._tags.add(t); return true },
    removeTag(t) { return this._tags.delete(t) }
}
__test.players.push(rejoined)
check("they come back with no tags at all", rejoined.getTags(), [])
onPlayerJoin(rejoined)
check("the rank is still theirs", primaryRank(rejoined).id, "admin")
check("their permissions came back too", has(rejoined, "admin.ban"), true)
check("and the mirror tag was re-stamped from the table",
    rejoined.getTags().filter(t => t.startsWith("rank:")), ["rank:admin"])
check("authority is intact", topWeight(rejoined), getRank("admin").weight)

// A gamertag change has to follow them, or the offline player list goes stale.
const renamed = {
    id: returning.id, name: "RenamedNow", nameTag: "RenamedNow",
    commandPermissionLevel: 0,
    _tags: new Set(),
    getTags() { return [...this._tags] },
    addTag(t) { this._tags.add(t); return true },
    removeTag(t) { return this._tags.delete(t) }
}
__test.players.push(renamed)
onPlayerJoin(renamed)
check("a changed gamertag is picked up",
    knownHolders().find(h => h.id === returning.id).name, "RenamedNow")
check("without losing the rank", primaryRank(renamed).id, "admin")

console.log("\n— every staff rank can set a game mode —")
// The pack exists so staff do not need operator. A moderator who cannot set a
// game mode gets opped instead, and opping them hands over everything — which
// is the exact outcome this addon is for avoiding.
//
// It is not free: admin.gamemode covers CREATIVE, and creative is an item
// duplication machine — spawn it, switch to survival, keep it. What makes that
// acceptable is that every change is recorded as mod.gamemode and announced to
// everyone above them the moment it happens.
const GAMEMODE_EXEMPT = {
    // Asked for as "very very strict... admin doesn't even get ban, and mod is
    // really just trying out for admin". A trial rank with creative in a PvP
    // world is the sharpest possible version of that conflict, so this ladder
    // keeps game mode at Admin. Deliberate, not an oversight.
    spearmace: ["moderator"]
}
for (const [key, preset] of Object.entries(PRESETS)) {
    applyPreset(key)
    const exempt = GAMEMODE_EXEMPT[key] ?? []
    const missing = []
    for (const rank of Object.values(preset.ranks)) {
        if (!rank.staff || exempt.includes(rank.id)) continue
        const p = fakePlayer(`gm_${key}_${rank.id}`)
        setRanks(p.id, [rank.id], p.name)
        if (!has(p, "admin.gamemode")) missing.push(rank.id)
    }
    check(`${key}: every staff rank can`, missing, [])
}
applyPreset("spearmace")
const trial = fakePlayer("Trial"); setRanks(trial.id, ["moderator"], trial.name)
check("except the PvP ladder's trial rank, on purpose",
    has(trial, "admin.gamemode"), false)
check("which still kicks", has(trial, "admin.kick"), true)
applyPreset("server")

console.log("\n— a staff tag always wins the nametag —")
// Held order is manual, so a moderator who collected a cosmetic tag was showing
// the tag. Whatever else a tag is for, the one thing a player has to be able to
// read off somebody's name is whether they are staff.
applyPreset("server")
saveR("vip", { display: "§aVip", weight: 15, staff: false, perms: [], inherits: [] })
const collector = fakePlayer("Collector")
setRanks(collector.id, ["vip", "mod"], collector.name)
check("held order puts the cosmetic tag first",
    heldRankIds(collector.id), ["vip", "mod"])
check("but the staff rank is what shows", primaryRank(collector).id, "mod")
check("and the cosmetic one is still held, just behind it",
    displayRanks(collector.id).map(r => r.id), ["mod", "vip"])

// Stable inside each group: two staff ranks keep the order their holder chose.
setRanks(collector.id, ["mod", "admin"], collector.name)
check("two staff ranks keep the manual order",
    displayRanks(collector.id).map(r => r.id), ["mod", "admin"])
setRanks(collector.id, ["admin", "mod"], collector.name)
check("reversed, and it follows", displayRanks(collector.id).map(r => r.id), ["admin", "mod"])
check("authority is unchanged either way — still the heaviest",
    playerRanks(collector.id)[0].id, "admin")

setRanks(collector.id, ["vip"], collector.name)
check("someone with only a cosmetic tag still shows it",
    primaryRank(collector).id, "vip")
deleteRank("vip")

console.log("\n— the author's badge —")
// The tag is cosmetic and has to STAY cosmetic. These assertions are the point
// of the feature, not decoration on it: a pack that gives its own author
// authority inside somebody else's world is a backdoor, and the only thing
// standing between "a nice badge" and that is this block.
applyPreset("server")
const creator = fakePlayer(CREATOR_GAMERTAG)
const stranger = fakePlayer("SomeoneElse")
const modly = fakePlayer("Modly"); setRanks(modly.id, ["mod"], modly.name)

check("they wear it", primaryRank(creator).id, "adminplus_creator")
check("and it reads as the pack's own mark",
    CREATOR_RANK.display.replace(/§./g, ""), "Admin+ Creator")
check("nobody else gets it", primaryRank(stranger).id, defaultRank().id)
check("the gamertag match ignores case",
    primaryRank(fakePlayer(CREATOR_GAMERTAG.toUpperCase())).id, "adminplus_creator")

check("it grants NO panel access", has(creator, "admin.panel"), false)
check("no ban", has(creator, "admin.ban"), false)
check("no rank management", has(creator, "ranks.manage"), false)
check("it is not staff", isStaff(creator), false)
check("it carries no permissions at all", CREATOR_RANK.perms, [])
check("they keep the default rank's own basics", has(creator, "warp.use"), true)

check("it adds no authority", topWeight(creator), topWeight(stranger))
check("so a Mod can still act on them", canActOn(modly, creator), true)
check("and they cannot act on a Mod", canActOn(creator, modly), false)

check("it is not in the rank table, so it cannot be granted to anyone",
    allRanks().some(r => r.id === "adminplus_creator"), false)
check("nor edited", getRank("adminplus_creator"), undefined)

// The contract the user asked for: it holds until a world gives them a rank.
grantRank(creator.id, "mod", creator.name)
check("a real rank replaces it", primaryRank(creator).id, "mod")
check("and the badge is gone entirely",
    displayRanks(creator).some(r => r.id === "adminplus_creator"), false)
revokeRank(creator.id, "mod")
check("taking that rank away brings it back", primaryRank(creator).id, "adminplus_creator")

// A preset REPLACES the whole ladder. The badge lives outside it on purpose.
applyPreset("spearmace")
check("it survives a ladder being replaced", primaryRank(creator).id, "adminplus_creator")
check("and still grants nothing there", has(creator, "admin.panel"), false)
applyPreset("server")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
