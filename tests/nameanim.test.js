import { __test } from "@minecraft/server"
import "../Admin+ BP/scripts/main.js"
import { setSetting, resetSetting } from "../Admin+ BP/scripts/core/settings.js"
import { setRanks, saveRank, getRank, RANK_VALUES, nametagStyleFor, refreshNameTag, creatorIdentity, CREATOR_GAMERTAG } from "../Admin+ BP/scripts/core/ranks.js"
import { setNickname } from "../Admin+ BP/scripts/core/identity.js"
import { STYLES, STYLE_IDS, paint, currentFrame, advanceFrame, __resetFrames } from "../Admin+ BP/scripts/core/nametag.js"
import { stepNameAnimation } from "../Admin+ BP/scripts/features/nameanim.js"

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const codesIn = s => [...String(s).matchAll(/§(.)/g)].map(m => m[1])
const plainOf = s => String(s).replace(/§./g, "")

console.log("\n— the palettes —")
{
    check("none is first, so it is the default a dropdown lands on", STYLE_IDS[0], "none")
    check("none has no ramp", STYLES.none.ramp, "")

    // Every ramp is a CYCLE — the frame offset wraps, so the last stop sits
    // next to the first. Nothing here checks that they look nice; what it
    // checks is that they are made of real codes, because a typo paints a
    // literal letter into somebody's name and nothing else would catch it.
    const legacy = "0123456789abcdef"
    const material = "ghijmnpqstuv"          // 1.21.20+ material colours
    const valid = new Set([...legacy, ...material])
    for (const id of STYLE_IDS) {
        const bad = [...STYLES[id].ramp].filter(c => !valid.has(c))
        check(`${id}: every stop is a real colour code`, bad, [])
    }
    check("and each one has a label and a hint",
        STYLE_IDS.every(id => STYLES[id].label && (id === "none" || STYLES[id].hint)), true)
}

console.log("\n— painting —")
{
    check("one code per character", codesIn(paint("abc", "c6e", 0)).length, 3)
    check("the letters survive unchanged", plainOf(paint("Firelite", "c6e", 0)), "Firelite")
    check("no ramp, no change", paint("Firelite", "", 0), "Firelite")
    check("empty text is not an error", paint("", "c6e", 0), "")

    // A space with a colour on it is two wasted characters and it makes a
    // multi-word name's wave stutter where the gap falls.
    check("spaces are left alone", codesIn(paint("a b", "c6e", 0)).length, 2)
    check("and the space is still there", plainOf(paint("a b", "c6e", 0)), "a b")
}

console.log("\n— the wave travels, which is the whole feature —")
{
    const at0 = paint("abcdef", "c6eab9", 0)
    const at1 = paint("abcdef", "c6eab9", 1)
    check("a different frame paints differently", at0 === at1, false)
    check("but the text is identical", plainOf(at0), plainOf(at1))

    // Travelling LEFT TO RIGHT: the colour on character i at frame f is the one
    // that was on character i-1 at frame f-1. This is the assertion that would
    // fail if the offset were added rather than subtracted, which is the easy
    // way to write it backwards.
    check("the colour moves one place right per frame",
        codesIn(at1).slice(1).join(""), codesIn(at0).slice(0, -1).join(""))

    // A ramp is a cycle, so a full lap comes back to where it started. This is
    // what stops a visible seam travelling along the name once per cycle.
    const ramp = "c6eab9"
    check("a full lap of the ramp returns to frame 0",
        paint("abcdef", ramp, ramp.length), at0)
}

console.log("\n— the negative-modulo trap —")
// `(i - frame) % len` goes negative the moment frame passes i, and ramp[-1] is
// undefined — which would paint the literal text "§undefined" into a nametag.
// The same sign trap cost a flaky /rtp test earlier today.
{
    for (const frame of [0, 1, 7, 99, 1000]) {
        const out = paint("abcdef", "c6eab9", frame)
        check(`frame ${frame} paints no undefined`, out.includes("undefined"), false)
        check(`frame ${frame} keeps the text`, plainOf(out), "abcdef")
    }
}

console.log("\n— the frame counter is shared —")
// Two people on one style must shimmer in step, or it reads as a fault rather
// than an effect. One counter, one frame, everybody.
{
    __resetFrames()
    check("starts at zero", currentFrame(), 0)
    advanceFrame()
    check("and advances", currentFrame(), 1)
    __resetFrames()
}

console.log("\n— the style is a rank value —")
{
    check("it is declared", RANK_VALUES["nametag.style"].kind, "style")
    check("as a choice, not a number", Array.isArray(RANK_VALUES["nametag.style"].options), true)
    check("and defaults to none", RANK_VALUES["nametag.style"].fallback, "none")
}

const player = {
    id: "n-1", name: "Firelite", nameTag: "Firelite",
    getTags: () => [], addTag: () => true, removeTag: () => false,
    sendMessage: () => {}, commandPermissionLevel: 0
}
__test.players.push(player)
setRanks(player.id, ["member"], player.name)

console.log("\n— resolving the style off the rank —")
{
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": undefined } })
    check("nothing set means none", nametagStyleFor(player), "none")

    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "rainbow" } })
    check("a rank that names one gives it", nametagStyleFor(player), "rainbow")

    // A rank naming a style that no longer exists must not paint §undefined.
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "chartreuse" } })
    check("an unknown style falls back rather than throwing", nametagStyleFor(player), "none")
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "rainbow" } })
}

console.log("\n— it reaches the nametag —")
{
    setSetting("feature.namecolour", "true")
    __resetFrames()
    refreshNameTag(player)
    const painted = player.nameTag
    check("the nametag carries colour codes", codesIn(painted).length > 3, true)
    check("and still reads as the name", painted.replace(/§./g, "").includes("Firelite"), true)

    advanceFrame()
    refreshNameTag(player)
    check("a later frame writes a different nametag", player.nameTag === painted, false)
    check("with the same letters",
        plainOf(player.nameTag), plainOf(painted))
}

console.log("\n— the switch actually switches it off —")
// A switch that does nothing is worse than no switch; a test enforces this
// across the pack and this is that test for this feature.
{
    setSetting("feature.namecolour", "false")
    refreshNameTag(player)
    const off = player.nameTag
    advanceFrame()
    refreshNameTag(player)
    check("off, the nametag stops changing", player.nameTag, off)
    // The rank TAG has colours of its own, so counting codes across the whole
    // nametag measures nothing. The question is whether the NAME was painted,
    // and the answer is the name appearing as one unbroken run of letters.
    check("and the name is one plain run, not one code per letter",
        off.includes("Firelite"), true)
    setSetting("feature.namecolour", "true")
}

console.log("\n— the tick only pays for players wearing one —")
{
    const plain = {
        id: "n-2", name: "Nobody", nameTag: "Nobody",
        getTags: () => [], addTag: () => true, removeTag: () => false,
        sendMessage: () => {}, commandPermissionLevel: 0
    }
    __test.players.push(plain)

    // The style has to sit on a rank only ONE of them holds. Putting it on
    // `member` did not do that: onPlayerJoin seeds the default rank, so both
    // players held member and both were painted — the first run of this test
    // reported 2 and looked like a bug in the tick. It was a bug in the setup.
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "none" } })
    saveRank("shiny", {
        id: "shiny", display: "§dShiny", weight: 20, inherits: [], perms: [],
        staff: false, meta: { "nametag.style": "rainbow" }
    })
    setRanks(player.id, ["shiny"], player.name)
    setRanks(plain.id, ["member"], plain.name)
    check("one wears a style and the other does not",
        [nametagStyleFor(player), nametagStyleFor(plain)], ["rainbow", "none"])

    plain.nameTag = "Nobody"
    check("only the styled player is repainted",
        stepNameAnimation([player, plain]), 1)
    check("and the other one is untouched", plain.nameTag, "Nobody")
}

console.log("\n— a nickname's own colours are replaced, not interleaved —")
// Painting one code per character over a string that already has its own
// interleaves two sets and renders as rubbish. The plain text is what gets
// painted, and that is a real trade rather than a bug.
{
    __resetFrames()
    const out = paint("§4F§ci§6re", "c6eab9", 0)
    check("painting an already-coded string is what we avoid — it doubles up",
        codesIn(out).length > 5, true)
    // Which is why the caller strips first:
    const stripped = paint("§4F§ci§6re".replace(/§./g, ""), "c6eab9", 0)
    check("stripped first, it is one code per letter", codesIn(stripped).length, 4)
    check("and the name is intact", plainOf(stripped), "Fire")
}

console.log("\n— the creator wears the name they go by —")
// Asked for on 2026-09-20. The gamertag is FireliteZGaming; the name they use
// is Firelite, and they chose a specific string of colour codes for it. The
// point of the feature is that this is a DEFAULT they land back on, not an
// override that fights a nickname.
{
    setSetting("feature.namecolour", "true")
    setSetting("creator.identity", "true")
    __resetFrames()

    const creator = {
        id: "c-1", name: CREATOR_GAMERTAG, nameTag: CREATOR_GAMERTAG,
        getTags: () => [], addTag: () => true, removeTag: () => false,
        sendMessage: () => {}, commandPermissionLevel: 0
    }
    __test.players.push(creator)
    setRanks(creator.id, ["member"], creator.name)

    check("the creator is recognised", !!creatorIdentity(creator), true)
    check("and nobody else is", creatorIdentity(player), undefined)

    // THE ASSERTION THAT MATTERS: frame 0 of the molten ramp on their text is
    // byte-for-byte the string they picked. If the ramp is ever reordered, this
    // fails rather than quietly rendering something they did not choose.
    const CHOSEN = "§mF§4i§nr§ce§6l§pi§gt§ee"
    check("frame 0 is exactly the string they chose",
        paint("Firelite", STYLES.molten.ramp, 0), CHOSEN)

    setNickname(creator, "")
    refreshNameTag(creator)
    check("with no nickname, the nametag carries it", creator.nameTag.includes(CHOSEN), true)
    check("and NOT the gamertag", plainOf(creator.nameTag).includes("ZGaming"), false)

    // It shifts, like any other style.
    const before = creator.nameTag
    advanceFrame()
    refreshNameTag(creator)
    check("it shifts too", creator.nameTag === before, false)
    check("with the same letters", plainOf(creator.nameTag).includes("Firelite"), true)

    // A nickname they set BEATS it — "unless they replace my nametag".
    setNickname(creator, "Somebody Else")
    refreshNameTag(creator)
    check("a nickname they set wins",
        plainOf(creator.nameTag).includes("Somebody Else"), true)
    check("and the default is not also drawn",
        plainOf(creator.nameTag).includes("Firelite"), false)

    // Clearing it comes back HERE rather than to the gamertag. This is the
    // specific behaviour asked for: the reset lands on the name they use.
    setNickname(creator, "")
    __resetFrames()
    refreshNameTag(creator)
    check("clearing the nickname returns to it, not to the gamertag",
        creator.nameTag.includes(CHOSEN), true)

    // A rank supplies the TAG; this supplies the NAME. They never contend.
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "toxic" } })
    __resetFrames()
    refreshNameTag(creator)
    check("a rank's own style does not take their name off them",
        creator.nameTag.includes(CHOSEN), true)
    // The tag beside it is the CREATOR BADGE, not Member — the badge replaces
    // the default rank, which is what 2.7.1 was for. So the two halves of the
    // nametag come from two different places and neither overwrites the other:
    //     §8[§bAdmin§d+§r §e§lCreator§8]§r §f§mF§4i§nr§ce§6l§pi§gt§ee
    check("and the badge is still drawn beside it",
        plainOf(creator.nameTag).includes("Creator"), true)
    saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "none" } })

    // And it is a switch like everything else.
    setSetting("creator.identity", "false")
    refreshNameTag(creator)
    check("switched off, they are just their gamertag",
        plainOf(creator.nameTag).includes("FireliteZGaming"), true)
    setSetting("creator.identity", "true")
}

saveRank("member", { meta: { ...getRank("member")?.meta, "nametag.style": "none" } })
resetSetting("creator.identity")
resetSetting("feature.namecolour")
resetSetting("namecolour.speed")
console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
