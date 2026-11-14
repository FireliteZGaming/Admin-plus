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
/**
 * A Profile card above the tiles (2.12.3, the user: "in /menu, you can see
 * your skin and then right by it it has your rank, and stuff"). Only after
 * TILES: the tile frame draws a "Profile" heading, the player's own model
 * and the form's body beside it, and nothing there can be pressed.
 */
export const PROFILE = "§p§f§i§5"

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
 *
 * The game reads "§" and the character after it as one code, left to right,
 * so "§§" is a code too and hides itself. A code followed by "§§" is being
 * shown off in its own colour, as in the rank editor's row "§0§§0 §1§§1 ...",
 * so it keeps its colour. Reading codes one at a time like the game also
 * means the "8" shown after "§§" is never mistaken for a code.
 */
export function lift(text) {
    if (typeof text !== "string") return text
    return text.replace(/§([\s\S])/g, (pair, code, at) =>
        LIFT[code] && !text.startsWith("§§", at + 2) ? `§${LIFT[code]}` : pair)
}

/**
 * A title for the Beta look. The frame draws "Admin+" itself, so the brand
 * prefix comes off and the screen's own name stays, in its hub colour.
 */
export function lookTitle(title, { tiles = false, profile = false } = {}) {
    let text = String(title ?? "")
    if (text.startsWith(BRAND_PREFIX)) text = text.slice(BRAND_PREFIX.length)
    return lift(text) + BETA_LOOK + (tiles ? TILES : "") + (tiles && profile ? PROFILE : "")
}

/**
 * Tiles stand in two columns. The pack builds each column the way the game
 * builds its own menu lists (2.11.1: the first try, a grid, drew nothing in
 * game). Every tile is made in both columns and shown in one: a tile whose
 * text ends in TILE_LEFT shows on the left, any other on the right. Same
 * hidden-code style as the markers above.
 */
export const TILE_LEFT = "§e§f§t"

/** A tile's text at its place in the menu: every other tile goes on the left. */
export function tileText(text, index) {
    return index % 2 === 0 ? `${text}${TILE_LEFT}` : text
}

/** A tile's picture: its stripe and icon, drawn by tools/genlook.py. */
export function tileIcon(key) { return `textures/ui/adminplus/tile_${key}` }

/**
 * Cards (2.11.4): buttons drawn side by side as cards, like Discord's role
 * templates, which the user pointed to on 2026-11-13. A button whose text ends
 * in CARD is a card. The pack's list frame draws every card in one row across
 * the top and every other button as a normal row under them, so a menu of
 * cards still has its Back button. Same hidden-code style as the markers above.
 */
export const CARD = "§j§c§a§s"

/** A card's text, marked so the list frame draws it as a card. */
export function cardText(text) { return `${text}${CARD}` }

/** The coloured strip along a card's top edge, drawn by tools/genlook.py. */
export function cardStripe(key) { return `textures/ui/adminplus/stripe_${key}` }

/**
 * A button's face when its menu is drawn as tiles: a white name over one short
 * grey line. The line has room for about 18 letters.
 */
export function tile(key, name, line) {
    return { text: line ? `§f§l${name}§r\n§7${line}` : `§f§l${name}`, icon: tileIcon(key) }
}
