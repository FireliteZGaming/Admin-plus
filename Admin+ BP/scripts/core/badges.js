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
    return flag("feature.badges")
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
    adminplus_dev: "plus"
})

/**
 * Which ranks can wear a badge: Staff and Default ranks only (2.11.4). The
 * user, 2026-11-13: "only staff ranks can have [badges] and default ranks i
 * suppose ... because vip, the heighest rank gets priority". A player wears
 * one badge, from their main tag's rank (playerBadge in core/ranks.js), and
 * that is always a Staff or Default rank. Cosmetic tags sit beside it and
 * unlisted ranks show nothing.
 */
export function canWearBadge(type) {
    return type !== "cosmetic" && type !== "unlisted"
}

/**
 * The badge a rank wears: its own pick, nothing if "none" was picked, or its
 * default. `type` is the rank's type from core/ranks.js, passed in so this
 * file never imports ranks.js.
 */
/**
 * The Admin+ badge is the Admin+ team's own mark: the creator and the devs
 * (2.11.7). The user, 2026-11-13: "admin+ badge is specific only to me and
 * other devs now", after a player made a rank called "ADMIN+ CREATOR" and
 * could have given it the same badge.
 *
 * Since 2.12.2 the WHOLE team wears it, always: Creator, Dev, Tester and
 * Media. The user, 2026-11-13: "no matter what, you will always get the admin
 * + badge ... the admin+ badge marks who is a true cooperator of the admin+
 * team. even if you have an owner tag you still get admin+ over the crown".
 * So a team member's badge never comes from a world's rank (playerBadge in
 * core/ranks.js), and the Media team's camera from 2.12.1 is gone ("the media
 * badge should probably go"). These are the pack's own team ranks (teamBadge
 * in core/ranks.js), named here by id so this file never imports ranks.js.
 */
export const TEAM_BADGE = "plus"
// 3.1.6: the four team badges are one Developer rank now (core/ranks.js).
export const TEAM_RANKS = Object.freeze(["adminplus_dev"])

/** The Admin+ badge as a team member wears it, or "" when badges are off. */
export function teamBadgeFor() {
    return badgesOn() ? badgeChar(TEAM_BADGE, badgeStyle()) : ""
}

/** May this rank wear the badge `key`? Every badge but the team's is for anyone. */
export function mayWear(rank, key) {
    return key !== TEAM_BADGE || TEAM_RANKS.includes(rank?.id)
}

/** The badges a world's own rank can be given on its Badge screen. */
export function pickableBadges() {
    return BADGES.filter(badge => badge.key !== TEAM_BADGE)
}

export function badgeOf(rank, type) {
    if (!rank || !canWearBadge(type)) return undefined
    const picked = rank.meta?.badge
    if (picked === "none") return undefined
    // A rank that picked the team's badge before 2.11.7 goes back to its default.
    if (picked && picked in INDEX && mayWear(rank, picked)) return picked
    if (DEFAULT_BADGES[rank.id]) return DEFAULT_BADGES[rank.id]
    return type === "staff" ? "hammer" : undefined
}

/** The character to draw for a rank's badge, or "" when badges are off or it has none. */
export function badgeFor(rank, type) {
    if (!badgesOn()) return ""
    const key = badgeOf(rank, type)
    return key ? badgeChar(key, badgeStyle()) : ""
}

/**
 * A plain green tick, for lists of what something gives (the template cards,
 * 2.11.4). Row 2 of the same glyph page, drawn by tools/genbadges.py.
 */
export const TICK = String.fromCharCode(BADGE_PAGE + 0x20)
