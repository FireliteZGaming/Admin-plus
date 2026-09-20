import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, getRank } from "../Admin+ BP/scripts/core/ranks.js"
import {
    allClaims, claimsOf, getClaim, createClaim, removeClaim, claimAt,
    inside, squareAround, trust, untrust, mayBuild, claimLimit, __resetClaims
} from "../Admin+ BP/scripts/core/claims.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const OVER = "minecraft:overworld"
const NETHER = "minecraft:nether"
const makePlayer = (id, name, loc = { x: 0, y: 64, z: 0 }, dim = OVER) => ({
    id, name, nameTag: name, location: loc,
    dimension: { id: dim },
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
})
const blockAt = (x, z, dim = OVER) => ({ location: { x, y: 64, z }, dimension: { id: dim } })

const owner = makePlayer("c-own", "Builder")
const stranger = makePlayer("c-str", "Passerby", { x: 500, y: 64, z: 500 })
const friend = makePlayer("c-fri", "Friend", { x: 500, y: 64, z: 500 })
const mod = makePlayer("c-mod", "Mod", { x: 500, y: 64, z: 500 })
__test.players.push(owner, stranger, friend, mod)

// Rank ids are case-SENSITIVE and an unknown one silently becomes the default.
setRanks(owner.id, ["member"], owner.name)
setRanks(stranger.id, ["member"], stranger.name)
setRanks(friend.id, ["member"], friend.name)
setRanks(mod.id, ["mod"], mod.name)
setSetting("feature.claims", "true")
saveRank("member", { meta: { ...getRank("member")?.meta, "claim.limit": 2, "claim.size": 64 } })

console.log("\n— the square is centred on you and closes on itself —")
{
    const box = squareAround({ x: 0, z: 0 }, 16)
    check("it is the width asked for", box.x2 - box.x1 + 1, 16)
    check("in both directions", box.z2 - box.z1 + 1, 16)
    check("and you are inside it",
        inside({ dimension: OVER, ...box }, OVER, 0, 0), true)

    // Off-by-one at the edge is the bug that makes a claim one block short on
    // two sides, which nobody notices until somebody mines through the corner.
    const claim = { dimension: OVER, ...box }
    check("the far corner is inside", inside(claim, OVER, box.x2, box.z2), true)
    check("one block past it is not", inside(claim, OVER, box.x2 + 1, box.z2), false)
    check("the near corner is inside", inside(claim, OVER, box.x1, box.z1), true)
    check("and one block before it is not", inside(claim, OVER, box.x1 - 1, box.z1), false)
}

console.log("\n— claiming, and what it refuses —")
{
    __resetClaims()
    const result = createClaim(owner, 16)
    check("it claimed", result.ok, true)
    check("the owner is recorded by id", result.claim.owner, owner.id)
    check("and by name, so a message can say whose it is", result.claim.ownerName, "Builder")
    check("it is findable by where it is", claimAt(OVER, 0, 0)?.id, result.claim.id)
    check("and not in another dimension at the same coordinates",
        claimAt(NETHER, 0, 0), undefined)

    // Overlap is refused even against your OWN claim: two claims sharing ground
    // makes "whose rules apply here" unanswerable.
    const again = createClaim(owner, 16)
    check("a second claim on the same spot is refused", again.ok, false)
    check("and says it is their own", /your own claim/i.test(again.reason), true)

    const elsewhere = makePlayer("c-own", "Builder", { x: 300, y: 64, z: 300 })
    check("but one somewhere else is fine", createClaim(elsewhere, 16).ok, true)
}

console.log("\n— somebody else's ground —")
{
    __resetClaims()
    createClaim(owner, 32)
    const theirs = createClaim(makePlayer("c-str", "Passerby", { x: 4, y: 64, z: 4 }), 16)
    check("overlapping a stranger's claim is refused", theirs.ok, false)
    check("and names them, so it starts a conversation not a report",
        /Builder/.test(theirs.reason), true)
}

console.log("\n— what protection actually means —")
{
    __resetClaims()
    createClaim(owner, 16)

    check("the owner may build", mayBuild(owner, OVER, 0, 0).ok, true)
    check("a stranger may not", mayBuild(stranger, OVER, 0, 0).ok, false)
    check("and is told whose it is", /Builder/.test(mayBuild(stranger, OVER, 0, 0).reason), true)
    check("unclaimed ground is everybody's", mayBuild(stranger, OVER, 9000, 9000).ok, true)
    check("and so is the same spot in another dimension",
        mayBuild(stranger, NETHER, 0, 0).ok, true)
}

console.log("\n— the hooks cancel, which is the only thing that stops a grief —")
// Driven through the REAL before-events. An after-event hook would report a
// block that is already gone, so a test that only proved "something fired"
// would pass against a claim system that protects nothing.
{
    __resetClaims()
    createClaim(owner, 16)
    const here = blockAt(0, 0)
    const away = blockAt(9000, 9000)

    check("a stranger's break is cancelled", __test.tryBreakBlock(stranger, here), true)
    check("a stranger's place is cancelled", __test.tryPlaceBlock(stranger, here), true)
    // Without this a claim keeps your walls up and hands over everything inside
    // them, which is worse than no claim because it looks like protection.
    check("and so is opening the chest", __test.tryInteractBlock(stranger, here), true)

    check("the owner's break goes through", __test.tryBreakBlock(owner, here), false)
    check("the owner's place goes through", __test.tryPlaceBlock(owner, here), false)
    check("and nobody is stopped outside a claim",
        __test.tryBreakBlock(stranger, away), false)
}

console.log("\n— trusting somebody —")
{
    __resetClaims()
    const claim = createClaim(owner, 16).claim
    const here = blockAt(0, 0)

    check("a friend starts out blocked", __test.tryBreakBlock(friend, here), true)
    check("trusting works", trust(claim.id, friend).ok, true)
    check("and now they can build", __test.tryBreakBlock(friend, here), false)
    check("trusting twice is refused rather than duplicated",
        trust(claim.id, friend).ok, false)
    check("the owner cannot be trusted onto their own land",
        trust(claim.id, owner).ok, false)

    check("untrusting works", untrust(claim.id, friend.id), true)
    check("and they are blocked again", __test.tryBreakBlock(friend, here), true)
    check("untrusting somebody who was never trusted is not an error",
        untrust(claim.id, stranger.id), false)
}

console.log("\n— staff pass, because a moderator who cannot reach it uses creative instead —")
{
    __resetClaims()
    createClaim(owner, 16)
    const here = blockAt(0, 0)
    const verdict = mayBuild(mod, OVER, 0, 0)
    check("admin.claims passes", verdict.ok, true)
    check("and it is marked as an override, not as ownership", verdict.override, true)
    check("so their break is not cancelled", __test.tryBreakBlock(mod, here), false)
}

console.log("\n— an explosion loses the blocks inside a claim, not all of them —")
// A creeper has no permission node, so this is judged by WHERE each block is.
//
// The first version of the hook read `event.impactedBlocks` and set
// `event.cancel`; the real event carries getImpactedBlocks()/setImpactedBlocks()
// and each block knows its own dimension. The test passed anyway, because the
// STUB had been written from the same wrong guess — which is the one failure
// mode a test cannot catch on its own.
{
    __resetClaims()
    createClaim(owner, 16)
    const at = (x, z, dim = OVER) => ({ location: { x, y: 64, z }, dimension: { id: dim } })

    const mixed = [at(0, 0), at(2, 2), at(9000, 9000), at(9001, 9000)]
    const survived = __test.tryExplosion(mixed)
    check("the two inside the claim are dropped", survived.length, 2)
    check("and the ones out in the world are not",
        survived.map(b => b.location.x).sort((a, b) => a - b), [9000, 9001])

    // Nothing claimed anywhere near it: the list must come back untouched,
    // or every explosion in the world pays for this feature.
    const clear = [at(5000, 5000), at(5001, 5000)]
    check("an explosion far from any claim is left alone",
        __test.tryExplosion(clear).length, 2)

    // Same coordinates, wrong dimension.
    check("a claim does not protect the nether at the same spot",
        __test.tryExplosion([at(0, 0, NETHER)]).length, 1)
}

console.log("\n— limits are the rank's —")
{
    __resetClaims()
    check("the rank decides how many", claimLimit(owner), 2)
    check("first", createClaim(makePlayer("c-own", "Builder", { x: 0, y: 64, z: 0 }), 16).ok, true)
    check("second", createClaim(makePlayer("c-own", "Builder", { x: 400, y: 64, z: 400 }), 16).ok, true)
    const third = createClaim(makePlayer("c-own", "Builder", { x: 800, y: 64, z: 800 }), 16)
    check("third is refused", third.ok, false)
    check("and says what to do about it", /remove one first/i.test(third.reason), true)

    const huge = createClaim(makePlayer("c-str", "Passerby", { x: 5000, y: 64, z: 5000 }), 200)
    check("a claim wider than the rank allows is refused", huge.ok, false)
    check("naming the maximum", /64/.test(huge.reason), true)

    const tiny = createClaim(makePlayer("c-str", "Passerby", { x: 6000, y: 64, z: 6000 }), 2)
    check("and so is a silly little one", tiny.ok, false)
}

console.log("\n— a rank allowed none —")
{
    __resetClaims()
    saveRank("member", { meta: { ...getRank("member")?.meta, "claim.limit": 0 } })
    const result = createClaim(owner, 16)
    check("refused", result.ok, false)
    check("because of the rank", /rank can't claim land/i.test(result.reason), true)
    saveRank("member", { meta: { ...getRank("member")?.meta, "claim.limit": 2 } })
}

console.log("\n— giving one up —")
{
    __resetClaims()
    const claim = createClaim(owner, 16).claim
    const here = blockAt(0, 0)
    check("a stranger is blocked while it stands", __test.tryBreakBlock(stranger, here), true)
    check("it goes", removeClaim(claim.id), true)
    check("and the ground is open again", __test.tryBreakBlock(stranger, here), false)
    check("removing it twice is not an error", removeClaim(claim.id), false)
    check("and it is gone from the list", allClaims().length, 0)
}

console.log("\n— the feature switch —")
{
    __resetClaims()
    createClaim(owner, 16)
    const here = blockAt(0, 0)
    check("protected while on", __test.tryBreakBlock(stranger, here), true)
    setSetting("feature.claims", "false")
    // Switched off means OFF, not "claims still silently enforced" — otherwise
    // an owner turning it off to fix something finds it did nothing.
    check("switched off, nothing is protected", __test.tryBreakBlock(stranger, here), false)
    check("and no new ones can be made", createClaim(stranger, 16).ok, false)
    setSetting("feature.claims", "true")
    check("back on, and the claim is still there", __test.tryBreakBlock(stranger, here), true)
}

resetSetting("feature.claims")
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
