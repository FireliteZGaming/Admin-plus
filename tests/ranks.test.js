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
    CREATOR_GAMERTAG, CREATOR_RANK, allRanks, rankState, rankGrant,
    DEVELOPER_RANK, isTeamDeveloper, __setTeamDevelopers, nodeLabels, canTrollOn, onStaffLost,
    TESTER_RANK, isTester, testerGamertags, MEDIA_RANK, isMedia, mediaGamertags
} from "../Admin+ BP/scripts/core/ranks.js"
import { CONFIG } from "../Admin+ BP/scripts/config.js"
import { SERVER_PRESETS_SHOWN } from "../Admin+ BP/scripts/core/onhold.js"

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
check("default ladder order", ladder().map(r => r.id), ["owner", "coowner", "manager", "admin", "mod", "member"])
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
// ONE MAIN TAG (2.10.0, the user, 2026-11-12): of the ranks in the order,
// only the highest shows. "It replaces your main tag, which is usually either
// default or staff." So Admin shows and Member, held too, does not.
check("only the highest rank in the order shows: admin, not member as well",
    displayRanks(steve).map(r => r.id), ["admin"])
check("so the tag is the staff one", primaryRank(steve).id, "admin")
check("authority = heaviest, not tag", playerRanks(steve)[0].id, "admin")
check("authority weight is admin's", topWeight(steve), getRank("admin").weight)

console.log("\n— per-player display order is cosmetic —")
moveHeldRank(steve.id, "admin", -1)
check("reordering changes nothing here: still only admin", displayRanks(steve).map(r => r.id), ["admin"])
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
check("mod moved above admin", ladder().map(r => r.id), ["owner", "coowner", "manager", "mod", "admin", "member"])
check("authority followed the move", canActOn(mod, admin.id), true)
check("and reversed the other way", canActOn(admin, mod.id), false)
moveRank("mod", 1)
check("moved back", ladder().map(r => r.id), ["owner", "coowner", "manager", "admin", "mod", "member"])
check("top of ladder can't move up", moveRank("owner", -1), false)
check("bottom can't move down", moveRank("member", 1), false)

console.log("\n— presets & undo —")
applyPreset("smp")
check("preset replaced ladder", ladder().map(r => r.id), ["owner", "staff", "member"])
check("holder keeping a surviving id", heldRankIds(steve), ["member"])
check("holder whose rank vanished falls back to default", heldRankIds(admin), ["member"])
restoreSnapshot()
check("undo restored previous ladder", ladder().map(r => r.id), ["owner", "coowner", "manager", "admin", "mod", "member"])

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
check("granting it replaces member, even though it is weaker",
    heldRankIds(steve), ["builder"])
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
check("a grant replaces member outright", heldRankIds(rookie), ["mod"])
check("tag is now mod", primaryRank(rookie).id, "mod")
check("nametag re-stamped", rookie.nameTag.includes("Mod"), true)
grantRank(rookie.id, "owner", rookie.name)
check("a stronger grant goes to the front", primaryRank(rookie).id, "owner")
grantRank(rookie.id, "owner", rookie.name)
check("granting the same rank twice does not duplicate it",
    heldRankIds(rookie).filter(id => id === "owner").length, 1)
revokeRank(rookie.id, "owner", rookie.name)
revokeRank(rookie.id, "mod", rookie.name)
check("with nothing left they fall back to the default rank", heldRankIds(rookie), ["member"])

console.log("\n— ranks STACK; only the default is replaced —")
// The rule, and the whole of it: a rank is something you HOLD, not a slot you
// occupy. Granting Admin to a Builder leaves them both. The one thing any grant
// takes away is the DEFAULT rank, because that is what everybody has for want
// of anything else — and it goes whatever the new rank weighs, which is the
// case the old weight comparison got backwards.
const promo = fakePlayer("Promo")
onPlayerJoin(promo)
check("starts as member", heldRankIds(promo), ["member"])
check("a grant says it will take member", displacedBy(promo.id, "mod").map(r => r.id), ["member"])
grantRank(promo.id, "mod", promo.name)
check("member is gone", heldRankIds(promo), ["mod"])
check("and there is nothing left to displace", displacedBy(promo.id, "admin"), [])
grantRank(promo.id, "admin", promo.name)
check("a second rank stacks rather than replacing the first",
    heldRankIds(promo).sort(), ["admin", "mod"])
check("the strongest still wears the tag", primaryRank(promo).id, "admin")

// A rank BELOW member on the ladder replaces it too. A new rank lands at the
// bottom, so under the old weight comparison member outweighed it and survived
// — which left every freshly created rank sitting as Member-and-that.
saveRank("builder", { display: "§9Builder", staff: false, perms: [], inherits: [], meta: {} })
const fresh = fakePlayer("Fresh")
onPlayerJoin(fresh)
check("builder sits below member",
    getRank("builder").weight < getRank("member").weight, true)
check("granting it still takes member",
    displacedBy(fresh.id, "builder").map(r => r.id), ["member"])
grantRank(fresh.id, "builder", fresh.name)
check("a rank weaker than the default still replaces it", heldRankIds(fresh), ["builder"])

grantRank(promo.id, "builder", promo.name)
check("and it stacks on real ranks", heldRankIds(promo).sort(), ["admin", "builder", "mod"])
check("without stealing the tag", primaryRank(promo).id, "admin")
check("granting the default itself displaces nothing", displacedBy(fresh.id, "member"), [])
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
// **The declaration itself must not count as a use.** This test read all of
// scripts/ — which includes core/ranks.js, where PERMISSION_NODES lives — so
// every declared node matched its own declaration and the check could never
// fail. Proven 2026-09-13 by injecting `admin.totallyFakeNode`, which nothing
// anywhere checks: it passed. The rule CLAUDE.md advertises had not been
// enforced since the day it was written.
//
// So the block that DECLARES nodes is cut out before looking for uses of them,
// along with the two tables that merely name them — a label and a bundle entry
// are not a switch doing something.
const DECLARATION = /export const PERMISSION_NODES = \{[\s\S]*?\n\}/
const NAMING_TABLES = /const (?:NODE_LABELS|BUNDLES)\s*=\s*\{[\s\S]*?\n\}/g
const CODE = sources(SRC_DIR)
    .map(src => src.replace(DECLARATION, "").replace(NAMING_TABLES, ""))
    .join("\n")

// The Operator group, one `cmd.<name>` node per vanilla command, went with the
// vanilla wrappers in 2.8.4. A cmd.* node would now be a switch nothing reads.
check("no per-command cmd.* node is declared",
    Object.values(PERMISSION_NODES).flat().filter(node => node.startsWith("cmd.")), [])

const declared = [...new Set(Object.values(PERMISSION_NODES).flat())]
const unused = declared.filter(node => {
    if (node.startsWith("cmd.")) return !enforcedInExecute
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
// One written exception: a feature that is hidden, not dropped
// (core/onhold.js). Its check stays in the code for the day it comes back, but
// its switch is gone, since it would switch on nothing anyone can see.
const ON_HOLD = SERVER_PRESETS_SHOWN ? [] : ["presets.apply"]
const undeclared = [...checked].filter(node => !declared.includes(node) && !node.startsWith("chat.") && !ON_HOLD.includes(node))
check("and nothing is checked without being declared", undeclared, [])
check("while presets are hidden, their permission has no switch", declared.includes("presets.apply"), SERVER_PRESETS_SHOWN)
check("but the panel still checks it, ready for their return", CODE.includes(`has(player, "presets.apply")`), true)

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
        .filter(p => p !== "*" && !p.endsWith(".*") && !declared.includes(p) && !ON_HOLD.includes(p))
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
// EMPTY since 2026-09-20. Its only entry was the Spear Mace ladder's trial
// rank, and that preset was removed - so every staff rank in every shipped
// ladder can now set a game mode, with no exceptions to carve out.
//
// Kept as a table rather than deleted because the rule it guards is the point:
// a staff rank that cannot change game mode is a staff rank that reaches for
// an operator instead, and if a ladder ever wants that restriction again it
// has to say so here rather than just quietly lacking the node.
const GAMEMODE_EXEMPT = {}
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
// The two assertions that stood here tested the Spear Mace trial rank and went
// with the preset. What replaces them is stronger anyway: the loop above now
// runs with NO exemptions, so every staff rank in every shipped ladder is
// checked rather than most of them.
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
// Vip here has a weight and no type, so it is a rank in the order, and the
// one main tag is Mod. "Cosmetic is what you would make if you want extra tags."
check("a lower rank in the order is held but doesn't show",
    displayRanks(collector.id).map(r => r.id), ["mod"])
saveR("vip", { display: "§aVip", type: "cosmetic", staff: false, perms: [], inherits: [] })
check("made cosmetic, it shows as an extra tag behind the main one",
    displayRanks(collector.id).map(r => r.id), ["mod", "vip"])
saveR("vip", { display: "§aVip", type: "default", weight: 15, staff: false, perms: [], inherits: [] })

// Two staff ranks: "it'll only show 1, and it'll show the highest one."
setRanks(collector.id, ["mod", "admin"], collector.name)
check("two staff ranks: only the highest shows",
    displayRanks(collector.id).map(r => r.id), ["admin"])
setRanks(collector.id, ["admin", "mod"], collector.name)
check("whichever order they are held in", displayRanks(collector.id).map(r => r.id), ["admin"])
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

// **The badge replaces the default rank on the TAG, and nowhere else.**
// Asked for 2026-09-19: prepending made the creator wear two tags,
// `[Admin+ Creator] [Member]`, which reads as a collected cosmetic rather than
// as the pack's mark.
//
// The first attempt did it in displayRanks — and playerRanks WAS displayRanks
// sorted by weight, so the creator silently lost warp.use and their ladder
// weight and ended up with fewer rights than a stranger. These pin both halves,
// because the display half passing on its own is exactly what that looked like.
{
    const shown = displayRanks(creator)
    check("the tag is the badge alone", shown.map(r => r.id), ["adminplus_creator"])
    check("the default rank is not worn beside it",
        shown.some(r => r.id === defaultRank().id), false)

    // ...and the authority list is untouched, which is the half that bit.
    check("but they still HOLD the default rank",
        heldRankIds(creator.id).includes(defaultRank().id), true)
    check("so its permissions still apply", has(creator, "warp.use"), true)
    check("and so does its weight", topWeight(creator), topWeight(stranger))
    check("the authority list carries the real rank, not the badge",
        playerRanks(creator).map(r => r.id), [defaultRank().id])
}

// A preset REPLACES the whole ladder. The badge lives outside it on purpose.
applyPreset("spearmace")
check("it survives a ladder being replaced", primaryRank(creator).id, "adminplus_creator")
check("and still grants nothing there", has(creator, "admin.panel"), false)
applyPreset("server")

console.log("\n— what a rank REALLY says about a node —")
// Reported from a world: permissions showed as off for things an Admin plainly
// had. The editor was reading rank.perms literally, so everything reaching a
// rank by INHERITANCE or through a WILDCARD rendered as off. rankState resolves
// it the way has() does, rather than by a second copy of that logic.
applyPreset("server")
check("a node the rank states itself", rankState("admin", "admin.ban"), "own")
// **Its own wildcard is not inheritance**, and this assertion used to say it
// was — the comment above already named them as two different things before
// collapsing both into one word. Reported from a world: Manager read
// "has it already, inherited" on ban while its Inherits list was empty.
check("one it gets through its OWN wildcard — chat.* covers this",
    rankState("admin", "chat.viewall"), "wildcard")
check("and the label can name the pattern responsible",
    rankGrant("admin", "chat.viewall").via, "chat.*")
check("one it inherits from the rank below", rankState("admin", "admin.kick"), "inherited")
check("which names the rank it came from", rankGrant("admin", "admin.kick").via.id, "mod")
check("and one nothing grants at all", rankState("admin", "admin.commands"), "none")
check("an unknown rank says nothing", rankState("nosuchrank", "admin.ban"), "none")

// A denial has to beat an inherited grant, or "-node" would be decorative.
saveRank("admin", { perms: ["-admin.kick"] })
check("an explicit denial wins over what it inherits",
    rankState("admin", "admin.kick"), "denied")

console.log("\n— a rank inheriting from NOTHING cannot inherit anything —")
// The report, verbatim: "what is it inherited from? literally nothing." Manager
// carries `admin.*` in its OWN perms, so every admin node matched the flattened
// list and got called inherited — while the Inherits list sat empty, which is
// an unanswerable thing to be told.
{
    applyPreset("realm")
    const mgr = getRank("manager")
    saveRank("manager", { ...mgr, inherits: [] })
    check("it still HAS ban, because its own admin.* grants it",
        rankState("manager", "admin.ban"), "wildcard")
    check("and says which pattern did it", rankGrant("manager", "admin.ban").via, "admin.*")
    check("nothing it holds can claim to be inherited now",
        PERMISSION_NODES["Punishments"].every(n => rankState("manager", n) !== "inherited"), true)

    // The other half: this screen must never disagree with has(). An ancestor's
    // exact denial outranks this rank's broad wildcard, so restoring the
    // inheritance and taking ban away at Admin has to take it away here too.
    applyPreset("realm")
    const admin = getRank("admin")
    saveRank("admin", {
        ...admin,
        perms: admin.perms.filter(p => p !== "admin.ban").concat("-admin.ban")
    })
    check("an ancestor's exact denial beats this rank's own wildcard",
        rankState("manager", "admin.ban"), "denied")
    check("and it names the rank that refused it",
        rankGrant("manager", "admin.ban").via.id, "admin")

    const holder = fakePlayer("Manager")
    setRanks(holder.id, ["manager"], holder.name)
    check("which is exactly what has() answers, or the screen would be lying",
        has(holder, "admin.ban"), false)
    applyPreset("realm")
}
applyPreset("server")

console.log("\n— the team developer's badge —")
// [Admin+ Dev], for developers the creator takes on. Same badge, one word
// changed — so every promise the block above makes has to hold here too, or the
// team list becomes the way round the creator badge's own rules.
__setTeamDevelopers(["HiredDev"])
const hired = fakePlayer("HiredDev")

check("they wear it", primaryRank(hired).id, "adminplus_dev")
check("and it reads as the pack's own mark",
    DEVELOPER_RANK.display.replace(/§./g, ""), "Admin+ Dev")
check("in the same colours as the Creator's",
    DEVELOPER_RANK.display.replace("Dev", "X"),
    CREATOR_RANK.display.replace("Creator", "X"))
check("nobody off the list gets it", isTeamDeveloper(fakePlayer("Nobody")), false)

check("it grants NO panel access", has(hired, "admin.panel"), false)
check("no ban", has(hired, "admin.ban"), false)
check("no rank management", has(hired, "ranks.manage"), false)
check("it is not staff", isStaff(hired), false)
check("it carries no permissions at all", DEVELOPER_RANK.perms, [])
check("it adds no authority", topWeight(hired), topWeight(stranger))
check("so a Mod can still act on them", canActOn(modly, hired), true)
check("it is not in the rank table either",
    allRanks().some(r => r.id === "adminplus_dev"), false)

// Same contract, same disappearing act.
grantRank(hired.id, "mod", hired.name)
check("a real rank replaces it", primaryRank(hired).id, "mod")
revokeRank(hired.id, "mod")
check("and giving it up brings the badge back", primaryRank(hired).id, "adminplus_dev")

// If the creator were ever also on the developer list, one badge has to win, or
// the tag they wear would depend on array order.
__setTeamDevelopers(["HiredDev", CREATOR_GAMERTAG])
check("Creator outranks Dev when somebody is both",
    primaryRank(creator).id, "adminplus_creator")
__setTeamDevelopers([])
check("off the list, the badge goes with it", primaryRank(hired).id, defaultRank().id)


console.log("\n— the tester's badge —")
// [Admin+ Tester], for people who try builds before they ship. Added for
// "King bacon6016" on 2026-11-12. The same badge again, so the same promises.
const testerName = testerGamertags()[0]
const tester = fakePlayer(testerName)
check("King bacon6016 is on the list, space and all", testerName, "King bacon6016")
check("they wear it", primaryRank(tester).id, "adminplus_tester")
check("and it reads Admin+ Tester", TESTER_RANK.display.replace(/§./g, ""), "Admin+ Tester")
check("in the same colours as the other two",
    TESTER_RANK.display.replace("Tester", "X"),
    CREATOR_RANK.display.replace("Creator", "X"))
check("the name matches in any case", isTester({ name: "king BACON6016" }), true)
check("a near miss does not", isTester({ name: "King bacon601" }), false)
check("nor does the name without its space", isTester({ name: "Kingbacon6016" }), false)
check("it grants NO panel access", has(tester, "admin.panel"), false)
check("it is not staff", isStaff(tester), false)
check("it carries no permissions at all", TESTER_RANK.perms, [])
check("it adds no authority", topWeight(tester), topWeight(stranger))
check("it is not in the rank table", allRanks().some(r => r.id === "adminplus_tester"), false)
grantRank(tester.id, "mod", tester.name)
check("a real rank replaces it", primaryRank(tester).id, "mod")
revokeRank(tester.id, "mod")
check("and giving it up brings the badge back", primaryRank(tester).id, "adminplus_tester")
__setTeamDevelopers([testerName])
check("Dev outranks Tester when somebody is both", primaryRank(tester).id, "adminplus_dev")
__setTeamDevelopers([])
check("off the team, the Tester badge is back", primaryRank(tester).id, "adminplus_tester")


console.log("\n— the Media badge —")
// [Admin+ Media], for the people making Admin+'s videos. Added for eXeinty404,
// who is helping make the showcase video, on 2026-11-13; the user: "so like
// §bAdmin§d+ §l§eMedia ?". The same badge again, so the same promises.
const mediaName = mediaGamertags()[0]
const maker = fakePlayer(mediaName)
check("eXeinty404 is on the list", mediaName, "eXeinty404")
check("they wear it", primaryRank(maker).id, "adminplus_media")
check("and it reads Admin+ Media", MEDIA_RANK.display.replace(/§./g, ""), "Admin+ Media")
check("in the user's colours: Admin aqua, + pink, Media bold yellow", MEDIA_RANK.display, "§bAdmin§d+§r §e§lMedia")
check("the same as the other three",
    MEDIA_RANK.display.replace("Media", "X"),
    CREATOR_RANK.display.replace("Creator", "X"))
check("the name matches in any case", isMedia({ name: "EXEINTY404" }), true)
check("a near miss does not", isMedia({ name: "eXeinty40" }), false)
check("it grants NO panel access", has(maker, "admin.panel"), false)
check("it is not staff", isStaff(maker), false)
check("it carries no permissions at all", MEDIA_RANK.perms, [])
check("it adds no authority", topWeight(maker), topWeight(stranger))
check("it is not in the rank table", allRanks().some(r => r.id === "adminplus_media"), false)
grantRank(maker.id, "mod", maker.name)
check("a real rank replaces it", primaryRank(maker).id, "mod")
revokeRank(maker.id, "mod")
check("and giving it up brings the badge back", primaryRank(maker).id, "adminplus_media")
__setTeamDevelopers([mediaName])
check("Dev outranks Media when somebody is both", primaryRank(maker).id, "adminplus_dev")
__setTeamDevelopers([])
check("off the team, the Media badge is back", primaryRank(maker).id, "adminplus_media")


console.log("\n— permission switches are labelled, not spelled out —")
// The switches used to read `cmd.kill`, `admin.tp`, `warp.use`. Inside a group
// the prefix is the same word on every row, so fifty-four of them reading
// `cmd.` down the left is harder to scan than `kill`, `give`, `clear`.
//
// Stripping the prefix blindly is a trap and two real groups spring it, which
// is why this is a rule with tests rather than a .replace() at the call site.
check("a shared prefix is dropped",
    nodeLabels(["cmd.kill", "cmd.give", "cmd.clear"]), ["kill", "give", "clear"])

// Every node in Player basics ENDS in .use. The prefix is the meaningful half
// there, and dropping it would leave five switches all labelled "use".
check("a shared SUFFIX is dropped instead",
    nodeLabels(["warp.use", "spawn.use", "tpa.use"]), ["warp", "spawn", "tpa"])

// Mixed prefixes, but the tails are still distinct.
//
// Driven with nodes that carry NO override, so this tests the algorithm
// rather than the table. It used to use `ranks.view`, which now has one —
// and the assertion then passed or failed on whether that entry existed,
// which is not what this line is about.
check("mixed prefixes shorten when the tails are unique",
    nodeLabels(["admin.panel", "admin.logs", "warp.use"]), ["panel", "logs", "use"])

// **The override table wins, whichever branch produced the label.** The
// generator keeps the tail when tails are unique, which is right 37 times out
// of 42 and wrong whenever the PREFIX carried the meaning: `presets.apply`
// came out as "apply", the vaguest word on a screen where it is the heaviest
// switch.
check("a node whose meaning is in its prefix is named by hand",
    nodeLabels(["presets.apply", "admin.commands", "admin.automod"])[0], "server presets")
check("and the rest of that group still comes from the generator",
    nodeLabels(["presets.apply", "admin.allowlist", "admin.automod"]).slice(1),
    ["allowlist", "automod"])
// It has to survive the OTHER branches too, not just this one.
check("an override applies when a shared prefix is stripped",
    nodeLabels(["chat.staff", "chat.manage", "chat.spy"]), ["staff", "make and edit chats", "spy"])
check("and when a single node is asked for on its own",
    nodeLabels(["ranks.view"]), ["rank list"])

// Management holds ranks.manage AND warp.manage, which collapse onto each
// other. The whole group keeps both halves rather than some rows shortening
// and others not — a list spelled two ways reads as a mistake.
check("a collision keeps both halves, for the whole group",
    nodeLabels(["ranks.grant", "ranks.manage", "warp.manage"]),
    ["ranks · grant", "ranks · manage", "warp · manage"])

check("one node alone is left as it is", nodeLabels(["admin.panel"]), ["admin.panel"])
check("and nothing at all does not throw", nodeLabels(undefined), [])

// The guarantee that actually matters on screen: whatever the rule does, two
// switches in one group must never end up with the same words on them.
for (const [group, nodes] of Object.entries(PERMISSION_NODES)) {
    const labels = nodeLabels(nodes)
    check(`${group}: every label is distinct`,
        labels.length - new Set(labels).size, 0)
    check(`${group}: a label for every node`, labels.length, nodes.length)
    check(`${group}: none still carries a dot`,
        labels.filter(l => l.includes(".")), [])
}


console.log("\n— the ladder: nothing above you, and no peer punishes a peer —")
// Nothing pinned the equal case before 2.2.5, which is how the rule could be
// changed from strictly-above to equal-or-below without a single test noticing.
{
    saveRank("lad_low", { display: "§7Low", weight: 10 })
    saveRank("lad_mid", { display: "§7Mid", weight: 50 })
    saveRank("lad_midtoo", { display: "§7MidToo", weight: 50 })
    saveRank("lad_high", { display: "§7High", weight: 90 })

    const who = (id, rank, op = false) => {
        const p = { id, name: id, getTags: () => [], commandPermissionLevel: op ? 1 : 0 }
        setRanks(id, [rank], id)
        return p
    }
    const low = who("lad-low", "lad_low")
    const mid = who("lad-mid", "lad_mid")
    const peer = who("lad-peer", "lad_midtoo")
    const high = who("lad-high", "lad_high")
    check("below you, yes", canActOn(mid, low), true)
    check("above you, never", canActOn(mid, high), false)
    // A peer cannot ban a peer. Two moderators are not each other's
    // moderators — that is what the rank above them is for, and a punishment
    // one equal hands another has no authority behind it.
    check("the same rank, NO", canActOn(mid, peer), false)
    check("the same weight on a different rank, also no", canActOn(peer, mid), false)
    check("yourself, always", canActOn(mid, mid), true)

    // Operators act on anyone. This is what "all OPs can use it on anyone"
    // means, and it is resolved before the ladder is consulted at all.
    const opLow = who("lad-oplow", "lad_low", true)
    check("an operator on a heavier rank, yes", canActOn(opLow, high), true)
    check("but a non-operator on the same pairing, no", canActOn(low, high), false)

    console.log("\n— and the looser rule, for jokes rather than punishments —")
    // The knockback stick and /smite. Being knocked about by a peer is banter;
    // being BANNED by a peer is a decision neither has the standing to make.
    // 2.2.5 briefly made one rule of both, off the strength of the stick, and
    // the result was that a peer could ban a peer.
    check("a peer may knock a peer about", canTrollOn(mid, peer), true)
    check("and the other way round", canTrollOn(peer, mid), true)
    check("below you, still yes", canTrollOn(mid, low), true)
    check("above you, still never", canTrollOn(mid, high), false)
    check("an operator, still anyone", canTrollOn(opLow, high), true)
    // The two rules differ in exactly one place and nowhere else.
    check("the ONLY difference from canActOn is the equal case",
        [[mid, low], [mid, high], [mid, mid], [opLow, high], [low, high]]
            .filter(([a, b]) => canActOn(a, b) !== canTrollOn(a, b)), [])
}


console.log("\n— everything that acts on a player consults the ladder —")
// The permission node says who may use a command. It says nothing about who
// they may use it ON, and that second question was answered in some files and
// not others. The vanilla passthroughs answered it NOWHERE until 2.2.5: a
// moderator could /slay an owner, /eff them poison, /dmg them or /move them
// into the void, because the ladder was never asked.
//
// So: any feature that takes a player as a command argument must either call
// canActOn, or be named below with the reason it does not. Adding a command
// that targets somebody and forgetting the check fails here.
{
    const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
    const files = readdirSync(dir).filter(f => f.endsWith(".js"))

    // Acting on somebody is not the same as SPEAKING to them or ASKING them.
    // These three take a player and deliberately do not check rank:
    const exempt = {
        "privatechat.js": "a message is not something done TO somebody — a moderator may PM an owner",
        "reports.js": "reporting upward is the entire point; a member must be able to report staff",
        "tpa.js": "a request, not an act — the other person accepts or declines it",
        // The gate here is OWNERSHIP of the ground, not rank. A member letting
        // an owner build in their base is an ordinary thing to want, and a
        // ladder check would refuse it. Staff pass by `admin.claims`, which is
        // a permission an owner grants, not a hierarchy this could consult.
        "claims.js": "trusting somebody on your own claim is about the land, not about them"
    }

    const unprotected = []
    for (const file of files) {
        const text = readFileSync(new URL(file, dir), "utf8")
        // BLOCK comments as well as line ones. A /** … */ paragraph explaining
        // why canActOn is the wrong question somewhere would otherwise read as
        // the check itself — the same trap that has twice made a test in this
        // repo agree with its own prose instead of with the code.
        const code = text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")
        const targets = /CustomCommandParamType\.(Player|Entity)Selector/.test(code)
            || /resolveSelector\(/.test(code)
        if (!targets) continue
        // canTrollOn is the ladder too — the looser rule, for tools that are a
        // joke rather than a punishment.
        if (/can(ActOn|TrollOn)\s*\(/.test(code)) continue
        if (file in exempt) continue
        unprotected.push(file)
    }
    check("no feature targets a player without asking the ladder", unprotected, [])

    // The exemptions are real files, not a list that rotted. A name here for a
    // file that no longer exists would silently excuse nothing while looking
    // like it excused something.
    check("every exemption names a file that exists",
        Object.keys(exempt).filter(f => !files.includes(f)), [])
    // And each one still actually needs it — if a file on this list grew a
    // ladder check, the exemption is stale and should go.
    check("and none of them has since grown the check",
        Object.keys(exempt).filter(f =>
            /can(ActOn|TrollOn)\s*\(/.test(readFileSync(new URL(f, dir), "utf8"))), [])
}


console.log("\n— the hierarchy audit, command by command —")
// Every pack command that takes a player was read in 2.2.9 and put in one of
// three boxes. This pins the boxes, so a new command cannot join the "no check"
// group by accident and an existing one cannot quietly fall out of its box.
//
// A command() block is found and read to its matching brace, rather than by a
// lazy regex, so a handler containing objects does not truncate the block.
{
    const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
    const sources = [
        ...readdirSync(dir).filter(f => f.endsWith(".js"))
            .map(f => [f, readFileSync(new URL(f, dir), "utf8")]),
        ["main.js", readFileSync(new URL("../Admin+ BP/scripts/main.js", import.meta.url), "utf8")]
    ]

    // Commands that take a player and DELIBERATELY do not check the ladder.
    // Each needs a reason that survives being read out loud.
    const noCheck = {
        msg: "a message is not done TO somebody — a moderator may PM an owner",
        pm: "same",
        prchat: "same — a private room is a conversation",
        praccept: "answering an invitation you were sent",
        prdeny: "declining one",
        report: "reporting upward is the entire point; a member must be able to report staff",
        tpa: "a request — they accept or decline",
        tpahere: "also a request, in the other direction",
        tpaccept: "answering a request you were sent",
        tpadeny: "declining one",
        // Trusting is about YOUR OWN land, not about them. A member letting an
        // owner build in their base is a perfectly ordinary thing to want, and
        // a ladder check would refuse it — the gate that matters is "is this
        // your claim", which both commands do check.
        trust: "granting access to your own claim; the gate is ownership, not rank",
        untrust: "same, in reverse — taking back access to your own claim",
        // The one that is a fix rather than a philosophy.
        unmute: "un-gated ON PURPOSE: a mute that came apart must be fixable by "
              + "whoever is there, or the player stays stuck until the right rank logs in"
    }

    const targeting = []
    for (const [file, text] of sources) {
        const clean = text.replace(/\/\*[\s\S]*?\*\//g, "")
            .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")
        for (const m of clean.matchAll(/command\(\{/g)) {
            const open = m.index + m[0].length - 1
            let depth = 0, end = open
            for (let i = open; i < clean.length; i++) {
                if (clean[i] === "{") depth++
                else if (clean[i] === "}" && --depth === 0) { end = i; break }
            }
            const block = clean.slice(open, end + 1)
            const name = (block.match(/name\s*:\s*"([a-z0-9_]+)"/) ?? [])[1]
            if (!name) continue
            if (!/(Player|Entity)Selector|resolveSelector\(/.test(block)) continue
            // The check may live in a helper this command calls, so the FILE is
            // the unit — a file that targets somebody and never mentions the
            // ladder anywhere cannot be checking.
            const ladder = /can(ActOn|TrollOn|SeeActionsOf)\s*\(/
            // Two questions, because one file can hold a command that checks
            // next to one that deliberately does not — modcommands.js has /ban
            // beside /unmute. The FILE answers "could this be checking in a
            // helper"; the BLOCK answers "did THIS command grow a check".
            targeting.push({
                name, file,
                checksSomewhere: ladder.test(clean),
                checksHere: ladder.test(block)
            })
        }
    }

    const unexplained = targeting
        .filter(c => !c.checksSomewhere && !(c.name in noCheck))
        .map(c => `${c.name} (${c.file})`)
    check("every player-targeting command either checks or has a written reason",
        unexplained.sort(), [])

    // The reasons list must not rot either: a name on it for a command that no
    // longer exists excuses nothing while looking like it excuses something,
    // and one that has since grown a check is a stale exemption.
    const names = new Set(targeting.map(c => c.name))
    check("every reason names a command that still targets somebody",
        Object.keys(noCheck).filter(n => !names.has(n)).sort(), [])
    check("and none of them has since grown a check",
        Object.keys(noCheck).filter(n =>
            targeting.find(c => c.name === n)?.checksHere).sort(), [])
}


console.log("\n— surfaces that SHOW you another player, not just act on one —")
// The audit that missed all of this looked for commands that TARGET a player.
// It had no idea a command could OBSERVE one, and observing was where every
// remaining leak lived: social spy, the chat log, warnings, the action log and
// the reports queue all showed a moderator things an owner did or had done to
// them.
//
// So this guard asks a different question: which files READ one player's
// record or conversation and show it to another? Each must consult
// canSeeActionsOf, or be named with a reason.
{
    const dir = new URL("../Admin+ BP/scripts/features/", import.meta.url)
    const core = new URL("../Admin+ BP/scripts/core/", import.meta.url)
    const read = url => readFileSync(url, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    // The readers, by the function they call to fetch somebody else's history.
    const OBSERVERS = /\b(recentChat|searchChat|chatBy|recent|about|by|branch|search|getEntry|pendingReports|handledReports|getReport|warningsFor|spyIds)\s*\(/

    const watching = []
    for (const [where, base] of [["features", dir], ["core", core]]) {
        for (const file of readdirSync(base).filter(f => f.endsWith(".js"))) {
            const code = read(new URL(file, base))
            if (!OBSERVERS.test(code)) continue
            // canSeeActionsOf itself, or the Logs' funnel that calls it
            // (readableLog and canReadEntry in features/logsUI.js), which the
            // Beta Logs (features/logbook.js, 2.12.5) reads through.
            watching.push({ file: `${where}/${file}`, sees: /\b(canSeeActionsOf|readableLog|canReadEntry)\s*\(/.test(code) })
        }
    }

    // Files that read somebody's history and deliberately do not rank-filter.
    const exempt = {
        // The stores themselves. They hand back rows; the SCREENS decide who
        // may see them, which is the only layer that knows who is asking.
        "core/logs.js": "the store, not a screen — it has no viewer to check against",
        "core/chatlog.js": "same",
        "core/reports.js": "same",
        "core/warnings.js": "same",
        "core/privatechat.js": "same — spyIds() is who has the toggle on, not a view of anything",
        // Reading your own.
        "core/ask.js": "relevance() reads only the VIEWER'S own actions, to order a pick list; nothing of anybody else's is shown",
        "features/warn.js": "checks canSeeActionsOf on the command path; tellOwn reads only your own record"
    }

    const unchecked = watching
        .filter(w => !w.sees && !(w.file in exempt))
        .map(w => w.file)
    check("every screen that shows one player's history to another checks the ladder",
        unchecked.sort(), [])

    check("every exemption names a file that still reads a history",
        Object.keys(exempt).filter(f => !watching.find(w => w.file === f)).sort(), [])
}


console.log("\n— watching automod and retuning it are two different jobs —")
// `admin.automod` used to be both: a moderator who should see "somebody is
// mining forty blocks a second" had to be handed the spam ladder and the held
// queue to get it. admin.alerts is the watching half.
{
    applyPreset("server")
    const src = readFileSync(
        new URL("../Admin+ BP/scripts/features/automod.js", import.meta.url), "utf8")
    const code = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n")

    check("the alert path asks for admin.alerts",
        /has\(player, "admin\.alerts"\)/.test(code), true)
    // EITHER node hears it. The new one is absent from every rank table
    // already out there, so a world upgrading would have gone silent for its
    // whole staff until somebody noticed.
    check("and still accepts the old one, so an upgrade goes quiet for nobody",
        /has\(player, "admin\.alerts"\)\s*\|\|\s*has\(player, "admin\.automod"\)/.test(code), true)

    // The editing half did NOT move. A rank with alerts alone must not reach
    // the config screen, or the split bought nothing.
    check("changing automod still asks for admin.automod",
        /has\(player, "admin\.automod"\)/.test(code), true)

    const watcher = fakePlayer("Watcher")
    saveR("watcher", { display: "§aWatcher", weight: 40, staff: true,
        perms: ["admin.panel", "admin.alerts"], inherits: [] })
    setRanks(watcher.id, ["watcher"], watcher.name)
    check("a rank can be given alerts", has(watcher, "admin.alerts"), true)
    check("without being given the controls", has(watcher, "admin.automod"), false)

    // And the shipped ladders hand out both, so nothing changes for them.
    const modly = fakePlayer("ModAlerts"); setRanks(modly.id, ["mod"], modly.name)
    check("the shipped Mod still gets alerts", has(modly, "admin.alerts"), true)
    check("and still tunes automod", has(modly, "admin.automod"), true)
    applyPreset("server")
}

console.log("\n— a demoted staff member does not keep creative —")
// Nothing used to happen here. Somebody in creative who lost their staff rank
// stayed in creative for good, and could not put themselves back either,
// because the demotion took admin.gamemode with it.
{
    applyPreset("server")
    const seen = []
    onStaffLost(p => seen.push(p.id))

    const demoted = fakePlayer("Demoted")
    __test.players.push(demoted)
    setRanks(demoted.id, ["mod"], demoted.name)
    check("nothing fires on the way UP", seen.length, 0)

    setRanks(demoted.id, ["member"], demoted.name)
    check("it fires on the way down", seen, [demoted.id])

    // Staff to staff is not a demotion, and firing there would put an owner
    // who promoted somebody into survival for their trouble.
    seen.length = 0
    setRanks(demoted.id, ["mod"], demoted.name)
    setRanks(demoted.id, ["admin"], demoted.name)
    check("moving between two staff ranks is not a demotion", seen, [])

    // And somebody who was never staff losing a cosmetic rank is not either.
    const civilian = fakePlayer("Civilian")
    __test.players.push(civilian)
    setRanks(civilian.id, ["member"], civilian.name)
    seen.length = 0
    setRanks(civilian.id, [], civilian.name)
    check("nor is a member losing a rank", seen, [])
}
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
