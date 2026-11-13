import { readFileSync, existsSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { __test } from "@minecraft/server"
import { __ui } from "@minecraft/server-ui"
import { setRanks, onPlayerJoin, applyPreset, getRank, saveRank, renderTags, rankType } from "../Admin+ BP/scripts/core/ranks.js"
import { setSetting, renderTag } from "../Admin+ BP/scripts/core/settings.js"
import { BADGES, BADGE_PAGE, badgeChar, badgeOf, badgesOn, badgeLabel } from "../Admin+ BP/scripts/core/badges.js"
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
            if ((row > 1 || col >= BADGES.length) && filled(col, row)) stray.push(`${col},${row}`)
    check("and nothing else is drawn on the page", stray, [])
    // Characters U+EA00 to U+EAFF draw from this page. Page EA is used by
    // neither the game nor any pack installed on the PC this was made on.
    check("the page is EA", BADGE_PAGE, 0xEA00)
    check("the crown is the first picture", badgeChar("crown"), "")
    check("its classic picture is one row down", badgeChar("crown", "classic"), "")
    check("the sword sits after the ban hammer", badgeChar("sword"), "")
    check("Admin+'s own mark is the twelfth", badgeChar("plus"), String.fromCharCode(0xEA0B))
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
    check("the starting rank wears none", badgeOf(getRank("member"), "default"), undefined)
    check("a cosmetic rank wears none until one is picked", badgeOf(getRank("builder"), "cosmetic"), undefined)
    check("a picked badge wins", badgeOf({ id: "mod", meta: { badge: "gem" } }, "staff"), "gem")
    check("so does picking none", badgeOf({ id: "owner", meta: { badge: "none" } }, "staff"), undefined)
    check("a badge that no longer exists falls back to the default", badgeOf({ id: "mod", meta: { badge: "dragon" } }, "staff"), "hammer")
    check("every badge has a name players read", BADGES.every(b => badgeLabel(b.key) === b.label), true)
}

console.log("\n— on Default, nothing changes —")
{
    setBeta(false)
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
}

console.log("\n— on Beta, tags and buttons wear badges —")
{
    setBeta(true)
    check("badges are on", badgesOn(), true)
    const ownerTag = renderTags(boss)
    // Outside the bracket, as the user asked: "|badge|{Owner}".
    check("the owner's badge comes first, then the tag as it always was",
        ownerTag, `${badgeChar("crown")} ${renderTag(getRank("owner"))}`)
    check("a mod's has the ban hammer", renderTags(moddy).includes(badgeChar("hammer")), true)
    check("a new player's has none", PRIVATE_USE.test(renderTags(newbie)), false)
    check("the stored rank keeps its own name", PRIVATE_USE.test(getRank("owner").display), false)

    setSetting("badge.classic", "true")
    check("the classic style draws from the second row", renderTags(boss).includes(badgeChar("crown", "classic")), true)
    setSetting("badge.classic", "false")
    setSetting("feature.badges", "false")
    check("with the Badges switch off, no picture", PRIVATE_USE.test(renderTags(boss)), false)
    setSetting("feature.badges", "true")

    // Blanking a rank's name is how a world asks for no tag. A badge must not
    // bring the tag back.
    const ownerName = getRank("owner").display
    saveRank("owner", { display: "" })
    check("a rank with a blanked name still shows no tag", renderTags(boss).includes(badgeChar("crown")), false)
    saveRank("owner", { display: ownerName })

    await ranksScreen(boss, () => {})
    const rows = buttonsOf(lastForm())
    const ownerRow = rows.find(r => r.includes("Owner"))
    check("a staff rank's row shows its badge", ownerRow?.includes(badgeChar("crown")), true)
    check("instead of the word staff", ownerRow?.includes("staff"), false)
    check("on one line", ownerRow?.includes("\n"), false)
    const memberRow = rows.find(r => r.includes("Member"))
    check("the starting rank still says new players get it", memberRow?.includes("new players get it"), true)
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
    check("and the tag shows it", renderTags(moddy).includes(badgeChar("gem")), true)
    check("everything else about the rank is kept", [after.display, rankType(after), after.weight, after.perms.length],
        [before.display, rankType(before), before.weight, before.perms.length])

    __ui.answers.push(press(at), press(BADGES.length))
    await rankScreen(boss, "mod", () => {})
    check("No badge saves none", getRank("mod").meta.badge, "none")
    check("and the tag shows no picture", PRIVATE_USE.test(renderTags(moddy)), false)

    // Only someone who may edit a rank may change its badge, as with Basics.
    __ui.answers.length = 0
    await rankScreen(moddy, "owner", () => {})
    check("a mod sees no Badge button on the owner rank", buttonsOf(lastForm()).some(t => t.includes("Badge")), false)
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
    check("on Beta the page shows", buttonsOf(lastForm()).some(t => t.includes("Badges")), true)
    setBeta(false)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
