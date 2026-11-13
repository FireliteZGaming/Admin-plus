import { isBeta } from "./channel.js"
import { BRAND_PREFIX } from "./theme.js"

// Admin+'s own look, the UI overhaul (2.11.0, Beta only). The user approved
// the concept on 2026-11-13: "Yes the UI is perfect, we can start on that."
// Design and images: Obsidian > Admin+ > UI Overhaul.
//
// How it works. `Admin+ RP/ui/server_form.json` reads every form title. A
// title carrying BETA_LOOK is drawn in Admin+'s own frame
// (`Admin+ RP/ui/adminplus_beta.json`) instead of the game's: a dark panel,
// the aqua-to-pink bar, dark buttons that light up aqua. With TILES as well,
// the buttons are drawn as tiles, two to a row, each with an icon and a
// coloured stripe.
//
// Scripts add these markers only when the pack settings slider is on Beta
// (core/channel.js). On Default every form is exactly what it was.
//
// The markers are written like MULTILINE and the chest grid's: a § before
// each letter, so the game draws nothing, placed at the END of a title so
// nothing after them is restyled. Every letter is a colour code, never bold,
// italic, obfuscated or reset. tests/look.test.js pins them to the pack.

export const BETA_LOOK = "§b§e§t§a"
export const TILES = "§q§u§a§d"

/** True when Admin+'s own look is on. Asked once per form. */
export function betaLook() { return isBeta() }

// Text chosen for the game's light grey buttons uses black (§0) and dark grey
// (§8). On the dark panel those all but vanish, so the Beta look lifts them:
// black becomes white and dark grey becomes grey. Every other colour reads on
// both.
const LIFT = { "0": "f", "8": "7" }

/**
 * The same text, readable on the dark panel. For words a player READS: never
 * for a value in a text box, which is what gets saved.
 */
export function lift(text) {
    return typeof text === "string" ? text.replace(/§([08])/g, (_, code) => `§${LIFT[code]}`) : text
}

/**
 * A title for the Beta look. The frame draws "Admin+" itself, so the brand
 * prefix comes off and the screen's own name stays, in its hub colour.
 */
export function lookTitle(title, { tiles = false } = {}) {
    let text = String(title ?? "")
    if (text.startsWith(BRAND_PREFIX)) text = text.slice(BRAND_PREFIX.length)
    return lift(text) + BETA_LOOK + (tiles ? TILES : "")
}

/** A tile's picture: its stripe and icon, drawn by tools/genlook.py. */
export function tileIcon(key) { return `textures/ui/adminplus/tile_${key}` }

/**
 * A button's face when its menu is drawn as tiles: a white name over one short
 * grey line. The line has room for about 18 letters.
 */
export function tile(key, name, line) {
    return { text: line ? `§f§l${name}§r\n§7${line}` : `§f§l${name}`, icon: tileIcon(key) }
}
