import { isBeta } from "./channel.js"
import { flag } from "./settings.js"

// Rank badges (2.11.2, redrawn in 2.11.3, Beta). The user, 2026-11-13: like
// the little badges on Twitch and Discord, "not their way, but our way. In our
// theme and style ... Especially to the buttons instead of putting staff". Of
// the first previews they liked two styles, the dark tile with the Admin+ bar
// and the classic coloured square, so a server picks one in Names and tags ▸
// Badges.
//
// A badge is a picture inside text: one character on the glyph page
// `Admin+ RP/font/glyph_EA.png` (characters U+EA00 to U+EAFF), drawn by
// tools/genbadges.py from shapes, flat and bold like the user's references
// (2.11.3: the first, pixel-by-pixel set looked "sloppy"). Row 0 holds the
// Admin+ style, row 1 the classic style, one column per badge. BADGES below
// must stay in the tool's order; tests/badges.test.js checks that, and that
// every picture is there.
//
// Badges show only in Beta (core/channel.js) with the Badges switch on. On
// Default every tag and button is exactly what it was.

export const BADGES = Object.freeze([
    { key: "crown", label: "Crown" },
    { key: "hammer", label: "Ban hammer" },
    { key: "sword", label: "Sword" },
    { key: "shield", label: "Shield" },
    { key: "star", label: "Star" },
    { key: "gem", label: "Gem" },
    { key: "heart", label: "Heart" },
    { key: "bolt", label: "Bolt" },
    { key: "pickaxe", label: "Pickaxe" },
    { key: "flask", label: "Flask" },
    { key: "check", label: "Check" },
    { key: "plus", label: "Admin+" }
])

/** The first character of the glyph page. */
export const BADGE_PAGE = 0xEA00

const INDEX = Object.freeze(Object.fromEntries(BADGES.map((badge, i) => [badge.key, i])))

/** The character that draws a badge in a style, "admin" or "classic". "" for no such badge. */
export function badgeChar(key, style = "admin") {
    const i = INDEX[key]
    if (i === undefined) return ""
    return String.fromCharCode(BADGE_PAGE + (style === "classic" ? 16 : 0) + i)
}

/** A badge's name, as players read it. */
export function badgeLabel(key) {
    return BADGES[INDEX[key]]?.label ?? "No badge"
}

/** True when badges show: the slider on Beta, and the Badges switch on. */
export function badgesOn() {
    return isBeta() && flag("feature.badges")
}

/** "admin" or "classic", from Server ▸ Settings ▸ Names and tags ▸ Badges. */
export function badgeStyle() {
    return flag("badge.classic") ? "classic" : "admin"
}

// What a rank wears until someone picks: Admin+'s own ranks get a fitting
// badge, and any other staff rank the ban hammer, so every staff rank shows a
// badge where its button used to say "staff". Rank tables live in each world,
// so this is how ranks made before 2.11.2 get theirs.
const DEFAULT_BADGES = Object.freeze({
    owner: "crown", coowner: "crown", manager: "star", admin: "shield",
    mod: "hammer", staff: "hammer",
    vip: "gem", vipplus: "gem", mvp: "star",
    adminplus_creator: "plus", adminplus_dev: "plus", adminplus_tester: "flask"
})

/**
 * The badge a rank wears: its own pick, nothing if "none" was picked, or its
 * default. `type` is the rank's type from core/ranks.js, passed in so this
 * file never imports ranks.js.
 */
export function badgeOf(rank, type) {
    if (!rank) return undefined
    const picked = rank.meta?.badge
    if (picked === "none") return undefined
    if (picked && picked in INDEX) return picked
    if (DEFAULT_BADGES[rank.id]) return DEFAULT_BADGES[rank.id]
    return type === "staff" ? "hammer" : undefined
}

/** The character to draw for a rank's badge, or "" when badges are off or it has none. */
export function badgeFor(rank, type) {
    if (!badgesOn()) return ""
    const key = badgeOf(rank, type)
    return key ? badgeChar(key, badgeStyle()) : ""
}
