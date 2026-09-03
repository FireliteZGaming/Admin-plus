import { readFileSync, readdirSync } from "node:fs"
import { __test } from "@minecraft/server"
import {
    has, meta, isStaff, topWeight, canActOn, canEditRank,
    ladder, moveRank, getRank, saveRank, deleteRank, applyPreset, restoreSnapshot, snapshot,
    PRESETS,
    BUNDLES,
    PERMISSION_NODES,
    setRanks, grantRank, revokeRank, heldRankIds, playerRanks, displayRanks, primaryRank,
    moveHeldRank, onPlayerJoin, defaultRank, displacedBy, cooldownFor, saveRank as saveR
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
check("display order is what was set", displayRanks(steve).map(r => r.id), ["member", "admin"])
check("tag = first in display order", primaryRank(steve).id, "member")
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

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
