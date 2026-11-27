import { readFileSync, existsSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setRanks, onPlayerJoin, applyPreset, getRank, saveRank, renderTags, rankType, playerBadge, badgedTags, __setTeamDevelopers } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, renderTag, render } from "../Admin+ BP/scripts/core/settings.js"
import { BADGES, BADGE_PAGE, TICK, badgeChar, badgeOf, badgesOn, badgeLabel, canWearBadge, pickableBadges, mayWear, TEAM_RANKS } from "../Admin+ BP/scripts/core/badges.js"
import { ranksScreen, rankScreen } from "../Admin+ BP/scripts/features/ranksUI.js"
import { GROUPS, groupScreen, settingKeys } from "../Admin+ BP/scripts/features/settingsUI.js"

// Rank badges (2.11.2, Beta). The user, 2026-11-13: badges like Twitch's mod
// badge, "not their way, but our way. In our theme and style", on tags and
// "to the buttons instead of putting staff". They liked two styles, so both
// ship and a server picks one.
//
// A badge is a picture in text: a character on Admin+'s glyph page, drawn by
// tools/genbadges.py. The script names a picture by its place on that page,
// so the two files have to agree, and nothing at runtime says when they don't:
// the wrong picture just shows. That, and that Default never changes, is what
// this file checks.

let passed = 0, failed = 0
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected)
    if (a === e) { passed++; console.log(`  ok   ${name}`) }
    else { failed++; console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`) }
}

const ROOT = new URL("../", import.meta.url)
const PAGE_FILE = new URL("Admin+ RP/font/glyph_EA.png", ROOT)
const TOOL = readFileSync(new URL("tools/genbadges.py", ROOT), "utf8")

/** Just enough PNG reading for an 8-bit RGBA image: alpha by pixel. */
function readAlpha(url) {
    const data = readFileSync(url)
    let at = 8, width = 0, height = 0
    const idat = []
    while (at < data.length) {
        const length = data.readUInt32BE(at), type = data.toString("ascii", at + 4, at + 8)
        const body = data.subarray(at + 8, at + 8 + length)
        if (type === "IHDR") {
            width = body.readUInt32BE(0); height = body.readUInt32BE(4)
            if (body[8] !== 8 || body[9] !== 6) throw new Error("expected 8-bit RGBA")
        }
        if (type === "IDAT") idat.push(body)
        at += 12 + length
    }
    const raw = inflateSync(Buffer.concat(idat))
    const stride = width * 4
    const out = Buffer.alloc(height * stride)
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]
        for (let x = 0; x < stride; x++) {
            const v = raw[y * (stride + 1) + 1 + x]
            const left = x >= 4 ? out[y * stride + x - 4] : 0
            const up = y > 0 ? out[(y - 1) * stride + x] : 0
            const upLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0
            let p
            if (filter === 0) p = v
            else if (filter === 1) p = v + left
            else if (filter === 2) p = v + up
            else if (filter === 3) p = v + ((left + up) >> 1)
            else {
                const base = left + up - upLeft
                const pa = Math.abs(base - left), pb = Math.abs(base - up), pc = Math.abs(base - upLeft)
                p = v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
            }
            out[y * stride + x] = p & 0xff
        }
    }
    return { width, height, alpha: (x, y) => out[y * stride + x * 4 + 3] }
}

console.log("\n— the pictures and the list agree —")
{
    const drawn = [...TOOL.matchAll(/\("(\w+)", "([^"]+)", (?:"[0-9a-f]{6}"|None), (?:"[0-9a-f]{6}"|None)\)/g)].map(m => [m[1], m[2]])
    check("the tool draws the badges in the list's order, under the same names",
        drawn, BADGES.map(b => [b.key, b.label]))
    check("the glyph page is in the resource pack's font folder", existsSync(PAGE_FILE), true)
    const page = readAlpha(PAGE_FILE)
    // 32-pixel pictures (2.11.3), the size the game's own smooth icons use.
    check("it is a 16 by 16 grid of 32-pixel pictures", [page.width, page.height], [512, 512])
    const filled = (col, row) => {
        for (let y = row * 32; y < row * 32 + 32; y++)
            for (let x = col * 32; x < col * 32 + 32; x++) if (page.alpha(x, y) > 0) return true
        return false
    }
    check("every badge has its Admin+ picture in row 0", BADGES.map((b, i) => filled(i, 0)).every(Boolean), true)
    check("and its classic picture in row 1", BADGES.map((b, i) => filled(i, 1)).every(Boolean), true)
    const stray = []
    for (let row = 0; row < 16; row++)
        for (let col = 0; col < 16; col++)
            if ((row > 1 || col >= BADGES.length) && !(row === 2 && col === 0) && filled(col, row)) stray.push(`${col},${row}`)
    check("and nothing else is drawn on the page", stray, [])
    // Characters U+EA00 to U+EAFF draw from this page. Page EA is used by
    // neither the game nor any pack installed on the PC this was made on.
    check("the page is EA", BADGE_PAGE, 0xEA00)
    check("the crown is the first picture", badgeChar("crown"), "")
    check("its classic picture is one row down", badgeChar("crown", "classic"), "")
    check("the sword sits after the ban hammer", badgeChar("sword"), "")
    check("Admin+'s own mark is the twelfth", badgeChar("plus"), String.fromCharCode(0xEA0B))
    // 2.12.2: the Media team's camera from 2.12.1 is gone ("the media badge
    // should probably go"), so Admin+'s mark is the last again.
    check("there is no camera any more", [BADGES.length, badgeChar("camera")], [12, ""])
    check("an unknown badge draws nothing", badgeChar("dragon"), "")
}

// Players and ranks, as a world would have them.
function player(id, name, ranks) {
    const p = { id, name, nameTag: name, commandPermissionLevel: 0, getTags: () => [], addTag: () => true, removeTag: () => true, sendMessage: () => {} }
    __test.players.push(p)
    onPlayerJoin(p)
    setRanks(p.id, ranks, p.name)
    return p
}
applyPreset("server")
const boss = player("bdg-boss", "Boss", ["owner"])
const moddy = player("bdg-mod", "Moddy", ["mod"])
const newbie = player("bdg-new", "Newbie", ["member"])
saveRank("guard", { display: "§9Guard", type: "staff" })
saveRank("builder", { display: "§6Builder", type: "cosmetic" })

const BETA_ITEM = { id: "adminplus:channel_beta" }
function setBeta(on) {
    const at = __test.itemTypes.indexOf(BETA_ITEM)
    if (on && at < 0) __test.itemTypes.push(BETA_ITEM)
    if (!on && at >= 0) __test.itemTypes.splice(at, 1)
}
const PRIVATE_USE = /[-]/
const lastForm = () => __ui.shown[__ui.shown.length - 1]
const buttonsOf = form => form.parts.filter(p => p[0] === "button").map(p => p[1])
const press = selection => ({ canceled: false, selection })

console.log("\n— which badge a rank wears —")
{
    check("the owner wears the crown", badgeOf(getRank("owner"), "staff"), "crown")
    check("a mod wears the ban hammer, the Admin+ answer to Twitch's mod badge", badgeOf(getRank("mod"), "staff"), "hammer")
    check("any other staff rank wears the ban hammer too", badgeOf(getRank("guard"), rankType(getRank("guard"))), "hammer")
    // The user, 2026-11-19: "members shouldn't get a badge ... its the default
    // setting when you first launch the mod". A badge only if somebody picks one.
    check("Member, out of the box, wears no badge", badgeOf(getRank("member"), rankType(getRank("member"))), undefined)
    check("the starting rank wears none", badgeOf(getRank("member"), "default"), undefined)
    check("a cosmetic rank wears none", badgeOf(getRank("builder"), "cosmetic"), undefined)
    // 2.11.4, the user: badges are for staff and default ranks.
    check("even with one picked", badgeOf({ id: "builder", meta: { badge: "gem" } }, "cosmetic"), undefined)
    check("nor does an unlisted rank", badgeOf({ id: "secret", meta: { badge: "gem" } }, "unlisted"), undefined)
    check("staff and default ranks can", [canWearBadge("staff"), canWearBadge("default"), canWearBadge("cosmetic"), canWearBadge("unlisted")], [true, true, false, false])
    check("a default rank like VIP keeps its gem", badgeOf({ id: "vip" }, "default"), "gem")

    // 2.11.7, the user: "admin+ badge is specific only to me and other devs
    // now", after a player made a rank called "ADMIN+ CREATOR". 2.12.2: the
    // whole team, "the admin+ badge marks who is a true cooperator of the
    // admin+ team".
    // 3.1.6: the four team badges are one Developer rank now.
    check("one team rank, the Developer", TEAM_RANKS, ["adminplus_dev"])
    check("it wears the Admin+ badge", TEAM_RANKS.map(id => badgeOf({ id }, "default")), ["plus"])
    check("the flask is a badge like any other now", mayWear({ id: "lab" }, "flask"), true)
    check("a world's own rank that picked it shows no badge", badgeOf({ id: "admin_creator", meta: { badge: "plus" } }, "default"), undefined)
    check("a staff rank that picked it goes back to the ban hammer", badgeOf({ id: "fake", meta: { badge: "plus" } }, "staff"), "hammer")
    check("it is not offered on a rank's Badge screen", pickableBadges().some(b => b.key === "plus"), false)
    check("every other badge still is", pickableBadges().length, BADGES.length - 1)
    check("and anyone may wear those", BADGES.filter(b => b.key !== "plus").every(b => mayWear({ id: "fake" }, b.key)), true)
    check("a picked badge wins", badgeOf({ id: "mod", meta: { badge: "gem" } }, "staff"), "gem")
    check("so does picking none", badgeOf({ id: "owner", meta: { badge: "none" } }, "staff"), undefined)
    check("a badge that no longer exists falls back to the default", badgeOf({ id: "mod", meta: { badge: "dragon" } }, "staff"), "hammer")
    check("every badge has a name players read", BADGES.every(b => badgeLabel(b.key) === b.label), true)
}

console.log("\n— with the Badges switch off, nothing changes —")
{
    // Badges are everyone's since 2.12.10; their own switch still turns them off.
    setSetting("feature.badges", "false")
    check("badges are off", badgesOn(), false)
    check("tags carry no picture", [boss, moddy, newbie].map(p => PRIVATE_USE.test(renderTags(p))), [false, false, false])
    await ranksScreen(boss, () => {})
    const rows = buttonsOf(lastForm())
    check("the rank list carries no picture", rows.some(r => PRIVATE_USE.test(r)), false)
    check("and staff ranks still say staff", rows.filter(r => r.includes("Owner"))[0]?.endsWith("staff"), true)
    __ui.answers.length = 0
    await rankScreen(boss, "mod", () => {})
    check("a rank has no Badge button", buttonsOf(lastForm()).some(t => t.includes("Badge")), false)
    const names = GROUPS.find(g => g.id === "names")
    await groupScreen(boss, names, () => {})
    check("and Names and tags shows no Badges page", buttonsOf(lastForm()).some(t => t.includes("Badges")), false)
    setSetting("feature.badges", "true")
}

console.log("\n— on Beta, one badge per player, between bars —")
{
    setBeta(true)
    check("badges are on", badgesOn(), true)
    check("tags themselves carry no picture any more", [boss, moddy, newbie].map(p => PRIVATE_USE.test(renderTags(p))), [false, false, false])
    check("the owner wears the crown", playerBadge(boss), badgeChar("crown"))
    check("a mod wears the ban hammer", playerBadge(moddy), badgeChar("hammer"))
    check("a new player wears none", playerBadge(newbie), "")
    check("the stored rank keeps its own name", PRIVATE_USE.test(getRank("owner").display), false)

    // The user, 2026-11-13: "General | (badge) | {ranks}", and for a line
    // without a room "| (badge) |". In front of all the tags, once.
    const plain = s => s.replace(/§./g, "")
    const line = (key, p, nick, extra = {}) => plain(render(key, { BADGE: playerBadge(p), TAG: renderTags(p), NICKNAME: nick, MSG: "hi", ...extra }))
    check("a line labelled with its room shares the room's bar",
        line("format.chatChannel", boss, "Boss", { CHANNEL: "General" }), `General | ${badgeChar("crown")} | [Owner] Boss: hi`)
    check("any other chat line puts the badge between two bars",
        line("format.chat", boss, "Boss"), `| ${badgeChar("crown")} | [Owner] Boss » hi`)
    check("so does the name above their head",
        line("format.nameTag", boss, "Boss"), `| ${badgeChar("crown")} | [Owner] Boss`)
    check("no badge leaves no empty bars on a room line",
        line("format.chatChannel", newbie, "Newbie", { CHANNEL: "General" }), "General | [Member] Newbie: hi")
    check("or on any other line", line("format.chat", newbie, "Newbie"), "[Member] Newbie » hi")
    check("a caller that gives no badge prints no {BADGE}", plain(render("format.chat", { TAG: "[A]", NICKNAME: "Steve", MSG: "hi" })), "[A] Steve » hi")

    setRanks(moddy.id, ["mod", "builder"], moddy.name)
    check("one badge for every tag, in front of them all", plain(badgedTags(moddy)), `| ${badgeChar("hammer")} | [Mod] [Builder]`)
    check("the cosmetic tag adds no badge of its own", [...badgedTags(moddy)].filter(c => PRIVATE_USE.test(c)).length, 1)
    setRanks(moddy.id, ["mod"], moddy.name)
    check("a player list without a badge is just the tags", badgedTags(newbie), renderTags(newbie))

    setSetting("badge.classic", "true")
    check("the classic style draws from the second row", playerBadge(boss), badgeChar("crown", "classic"))
    setSetting("badge.classic", "false")
    setSetting("feature.badges", "false")
    check("with the Badges switch off, no picture", playerBadge(boss), "")
    setSetting("feature.badges", "true")

    // Blanking a rank's name is how a world asks for no tag. A badge must not
    // bring the tag back.
    const ownerName = getRank("owner").display
    saveRank("owner", { display: "" })
    check("a rank with a blanked name shows no badge either", playerBadge(boss), "")
    saveRank("owner", { display: ownerName })
    setSetting("feature.ranktags", "false")
    check("with rank tags off there is no main tag, so no badge", playerBadge(boss), "")
    setSetting("feature.ranktags", "true")

    // 2.12.2, the user: "no matter what, you will always get the admin +
    // badge ... even if you have an owner tag you still get admin+ over the
    // crown". 3.1.6: two developers stand in for the team.
    __setTeamDevelopers(["MakerDev", "SecondDev"])
    const maker = player("bdg-maker", "MakerDev", ["member"])
    const tester = player("bdg-second", "SecondDev", ["member"])
    check("a developer on the starting rank wears the Admin+ badge", [playerBadge(maker), playerBadge(tester)], [badgeChar("plus"), badgeChar("plus")])
    check("in front of their Developer tag", plain(badgedTags(maker)), `| ${badgeChar("plus")} | [Developer]`)
    setRanks(maker.id, ["owner"], maker.name)
    check("as an owner they still wear the Admin+ badge, not the crown", playerBadge(maker), badgeChar("plus"))
    check("in chat, in front of the owner's tag", line("format.chat", maker, "Maker"), `| ${badgeChar("plus")} | [Owner] Maker » hi`)
    check("on a room line too", line("format.chatChannel", maker, "Maker", { CHANNEL: "General" }), `General | ${badgeChar("plus")} | [Owner] Maker: hi`)
    check("while anyone else who is owner keeps the crown", playerBadge(boss), badgeChar("crown"))
    setRanks(tester.id, ["vip"], tester.name)
    check("over a default rank's badge too, like VIP's gem", playerBadge(tester), badgeChar("plus"))
    saveRank("owner", { display: "" })
    check("and even when their rank shows no tag", playerBadge(maker), badgeChar("plus"))
    saveRank("owner", { display: ownerName })
    setSetting("badge.classic", "true")
    check("in the classic style, from the second row", playerBadge(maker), badgeChar("plus", "classic"))
    setSetting("badge.classic", "false")
    setSetting("feature.badges", "false")
    check("the Badges switch still hides it, like everyone's", playerBadge(maker), "")
    setSetting("feature.badges", "true")
    __setTeamDevelopers([])
    setSetting("feature.ranktags", "false")
    check("and so do rank tags off", playerBadge(maker), "")
    setSetting("feature.ranktags", "true")
    setRanks(maker.id, ["member"], maker.name)
    setRanks(tester.id, ["member"], tester.name)

    await ranksScreen(boss, () => {})
    const rows = buttonsOf(lastForm())
    const ownerRow = rows.find(r => r.includes("Owner"))
    check("a staff rank's row shows its badge", ownerRow?.includes(badgeChar("crown")), true)
    check("instead of the word staff", ownerRow?.includes("staff"), false)
    check("on one line", ownerRow?.includes("\n"), false)
    const memberRow = rows.find(r => r.includes("Member"))
    check("the starting rank still says new players get it", memberRow?.includes("new players get it"), true)
    const builderRow = rows.find(r => r.includes("Builder"))
    check("a cosmetic rank's row shows no badge", PRIVATE_USE.test(builderRow ?? ""), false)
}

console.log("\n— picking a rank's badge —")
{
    __ui.answers.length = 0
    await rankScreen(boss, "mod", () => {})
    const buttons = buttonsOf(lastForm())
    const at = buttons.findIndex(t => t.includes("Badge"))
    check("a rank has a Badge button on Beta", at >= 0, true)
    check("which says what it wears now", buttons[at]?.includes(badgeChar("hammer")), true)

    const before = getRank("mod")
    __ui.answers.push(press(at), press(BADGES.findIndex(b => b.key === "gem")))
    await rankScreen(boss, "mod", () => {})
    const after = getRank("mod")
    check("picking the gem saves it", after.meta.badge, "gem")
    check("and the player wears it", playerBadge(moddy), badgeChar("gem"))
    check("everything else about the rank is kept", [after.display, rankType(after), after.weight, after.perms.length],
        [before.display, rankType(before), before.weight, before.perms.length])

    __ui.answers.push(press(at), press(pickableBadges().length))
    await rankScreen(boss, "mod", () => {})
    check("No badge saves none", getRank("mod").meta.badge, "none")
    check("and the player wears no picture", playerBadge(moddy), "")

    __ui.answers.length = 0
    await rankScreen(boss, "builder", () => {})
    check("a cosmetic rank has no Badge button", buttonsOf(lastForm()).some(t => t.includes("Badge")), false)

    // Only someone who may edit a rank may change its badge, as with Basics.
    __ui.answers.length = 0
    await rankScreen(moddy, "owner", () => {})
    check("a mod sees no Badge button on the owner rank", buttonsOf(lastForm()).some(t => t.includes("Badge")), false)

    __ui.answers.length = 0
    await rankScreen(boss, "mod", () => {})
    const badgeAt = buttonsOf(lastForm()).findIndex(t => t.includes("Badge"))
    __ui.answers.push(press(badgeAt))
    await rankScreen(boss, "mod", () => {})
    check("the Badge screen lists no Admin+ badge, even for the owner",
        buttonsOf(lastForm()).some(t => t.includes("Admin+") && t.includes(badgeChar("plus"))), false)
}

console.log("\n— the tick for template cards —")
{
    check("the tick is on the same page, row 2", TICK, String.fromCharCode(BADGE_PAGE + 0x20))
    const page = readAlpha(PAGE_FILE)
    let ink = false
    for (let y = 64; y < 96; y++) for (let x = 0; x < 32; x++) if (page.alpha(x, y) > 0) ink = true
    check("and is drawn", ink, true)
}

console.log("\n— drawn at text size —")
{
    // 2.11.5, from the user's screenshots: the game draws a glyph at one of its
    // pixels per picture pixel, centred on the line, and never shrinks it. The
    // 2.11.3 badges filled their 32-pixel cells and drew four lines tall. The
    // game's own icons (page E0) are 9 to 23 pixels, centred in their cells.
    const page = readAlpha(PAGE_FILE)
    const drawn = (col, row) => {
        let x0 = 99, y0 = 99, x1 = -1, y1 = -1
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            if (page.alpha(col * 32 + x, row * 32 + y) > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
        }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2 }
    }
    const badges = BADGES.flatMap((b, i) => [drawn(i, 0), drawn(i, 1)])
    check("every badge is at most 10 pixels each way, one chat line tall",
        badges.filter(d => d.w > 10 || d.h > 10).length, 0)
    check("and at least 8, so it can still be read", badges.filter(d => d.w < 8 || d.h < 8).length, 0)
    check("each sits in the middle of its cell, as the game centres it on the line",
        badges.filter(d => Math.abs(d.cx - 16) > 1 || Math.abs(d.cy - 16) > 1).length, 0)
    const tick = drawn(0, 2)
    check("the tick is no taller than a capital letter (7 pixels)", tick.h <= 7, true)
    check("and in the middle too", Math.abs(tick.cy - 16) <= 1, true)
}

console.log("\n— the Badges page —")
{
    const names = GROUPS.find(g => g.id === "names")
    const page = names.pages.find(p => p.label === "Badges")
    check("Names and tags has a Badges page", !!page, true)
    check("marked as Beta", page?.beta, true)
    check("with the switch and the style", page?.fields.map(f => f.key), ["feature.badges", "badge.classic"])
    check("both settings can be changed from a page", ["feature.badges", "badge.classic"].every(k => settingKeys().includes(k)), true)
    await groupScreen(boss, names, () => {})
    // In Beta a group is one page in sections (2.12.7).
    check("on Beta it is a section of the page", lastForm().parts.some(p => p[0] === "label" && String(p[1]).includes("§lBadges")), true)
    setBeta(false)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
