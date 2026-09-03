import { __test } from "@minecraft/server"
import { onPlayerJoin, setRanks, saveRank } from "../Admin+ BP/scripts/core/ranks.js"
import {
    allWarps, getWarp, saveWarp, deleteWarp, normaliseWarpId,
    warpsFor, canUseWarp, accessLabel, getSpawn, setSpawn, clearSpawn
} from "../Admin+ BP/scripts/core/warps.js"
import { setSetting, resetSetting, flag, setting } from "../Admin+ BP/scripts/core/settings.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

let nextId = 1
function fakePlayer(name, { op = false, x = 100, y = 64, z = -50 } = {}) {
    const tags = new Set()
    const p = {
        id: `w${nextId++}`, name, nameTag: name,
        commandPermissionLevel: op ? 1 : 0,
        location: { x, y, z },
        dimension: { id: "minecraft:overworld" },
        getTags: () => [...tags], addTag: t => tags.add(t), removeTag: t => tags.delete(t),
        sendMessage: () => {}, teleport: (loc) => { p.location = loc }
    }
    __test.players.push(p)
    return p
}

const nova = fakePlayer("Nova")         ; onPlayerJoin(nova)
const modder = fakePlayer("Modder")     ; onPlayerJoin(modder)  ; setRanks(modder.id, ["mod"], modder.name)
const boss = fakePlayer("Boss")         ; onPlayerJoin(boss)    ; setRanks(boss.id, ["admin"], boss.name)

console.log("\n— creating a warp lands where you stand —")
const made = saveWarp("Market Square", { display: "§aMarket" }, nova)
check("id is normalised for typing", made.id, "market_square")
check("display kept separately", made.display, "§aMarket")
check("position taken from the creator", [Math.floor(made.x), made.y, Math.floor(made.z)], [100, 64, -50])
check("dimension recorded", made.dimension, "minecraft:overworld")
check("open to everyone by default", made.access, "all")

console.log("\n— staff-only warps are invisible, not merely refused —")
saveWarp("hq", { display: "§6Staff HQ", access: "staff" }, boss)
check("member cannot use it", canUseWarp(nova, getWarp("hq")), false)
check("and it is absent from their list", warpsFor(nova).map(w => w.id), ["market_square"])
check("mod can use it", canUseWarp(modder, getWarp("hq")), true)
check("and sees it listed", warpsFor(modder).map(w => w.id).sort(), ["hq", "market_square"])

console.log("\n— rank-gated warps use the ladder, not a name list —")
saveWarp("vault", { display: "§5Vault", access: "rank", rank: "admin" }, boss)
check("member below the bar is out", canUseWarp(nova, getWarp("vault")), false)
check("mod below the bar is out too", canUseWarp(modder, getWarp("vault")), false)
check("admin at the bar is in", canUseWarp(boss, getWarp("vault")), true)
saveWarp("vault", { access: "rank", rank: "mod" })
check("lowering the bar lets the mod in", canUseWarp(modder, getWarp("vault")), true)
check("and admin, being above it, still qualifies", canUseWarp(boss, getWarp("vault")), true)

console.log("\n— a deleted rank fails closed, not open —")
saveWarp("vault", { access: "rank", rank: "ghost_rank" })
check("member still cannot reach it", canUseWarp(nova, getWarp("vault")), false)
check("it degrades to staff-only", canUseWarp(modder, getWarp("vault")), true)
check("and the label says something is wrong", accessLabel(getWarp("vault")).includes("missing"), true)

console.log("\n— labels —")
check("everyone", accessLabel(getWarp("market_square")).includes("Everyone"), true)
check("staff", accessLabel(getWarp("hq")).includes("Staff"), true)

console.log("\n— spawn —")
check("unset at first", getSpawn(), undefined)
setSpawn(boss)
check("set from the player", [Math.floor(getSpawn().x), getSpawn().y], [100, 64])
clearSpawn()
check("and can be cleared", getSpawn(), undefined)

console.log("\n— feature switches —")
check("warps ship on", flag("feature.warps"), true)
check("spawn ships on", flag("feature.spawn"), true)
setSetting("feature.warps", "false")
check("and can be turned off", flag("feature.warps"), false)
check("the data survives being switched off", allWarps().length > 0, true)
setSetting("feature.warps", "true")
check("turning it back on restores the warps untouched", warpsFor(boss).length > 0, true)

console.log("\n— spawn protection radius —")
// Mirrors the guard in features/warps.js: squared distance, same dimension.
setSpawn(boss)                      // boss stands at 100, 64, -50
setSetting("spawn.protect", "true")
setSetting("spawn.radius", "16")
const point = getSpawn()
const inside = (x, z, dim = "minecraft:overworld") => {
    if (!flag("spawn.protect")) return false
    if (dim !== point.dimension) return false
    const r = Number(setting("spawn.radius"))
    if (!Number.isFinite(r) || r <= 0) return false
    const dx = x - point.x, dz = z - point.z
    return dx * dx + dz * dz <= r * r
}
check("the spawn block itself is inside", inside(point.x, point.z), true)
check("15 blocks out is inside", inside(point.x + 15, point.z), true)
check("17 blocks out is outside", inside(point.x + 17, point.z), false)
check("the corner of the square is outside the circle", inside(point.x + 12, point.z + 12), false)
check("same coordinates in another dimension are not protected",
    inside(point.x, point.z, "minecraft:nether"), false)
setSetting("spawn.radius", "0")
check("a zero radius protects nothing", inside(point.x, point.z), false)
setSetting("spawn.protect", "false")
setSetting("spawn.radius", "16")
check("protection off protects nothing", inside(point.x, point.z), false)
resetSetting("spawn.protect")
resetSetting("spawn.radius")

console.log("\n— deleting —")
deleteWarp("market_square")
check("gone from the table", allWarps().map(w => w.id).sort(), ["hq", "vault"])
check("and gone from every list", warpsFor(modder).map(w => w.id).sort(), ["hq", "vault"])
check("id lookup is case-insensitive", getWarp(normaliseWarpId("HQ"))?.id, "hq")

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
