// Fonts for rank names, the way Discord offers fonts for a display name.
//
// Minecraft text has one typeface, so a "font" here is a set of look-alike
// letters: ꜱᴍᴀʟʟ ᴄᴀᴘꜱ, ᵗⁱⁿʸ, ⓒⓘⓡⓒⓛⓔⓓ. Checked against the game's own fonts on
// 2026-11-11: the pixel font (Mojangles) has none of these letters, and the
// fallback font that ships with the game (Noto Sans) has all of them. So they
// should draw, in a smoother style than the pixel letters around them. Whether
// chat and nametags really use that fallback is UNPROVEN until seen in game.
//
// Wide (fullwidth) letters are left out: the fallback font does not have them.
// Fonts we draw ourselves would need a resource pack glyph sheet; that is a
// later step, and this table is where they would be added.
//
// Discord's own fonts are licensed typefaces and cannot be shipped here.

const LOWER = "abcdefghijklmnopqrstuvwxyz"
const DIGITS = "0123456789"

/**
 * `lower` replaces a to z, `upper` replaces A to Z (falls back to `lower`),
 * `digits` replaces 0 to 9. A letter with no look-alike is left as it is:
 * there is no small-caps x and no tiny q in Unicode.
 */
export const FONTS = {
    normal: { label: "Normal" },
    smallcaps: { label: "Small caps", lower: "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ" },
    tiny: { label: "Tiny", lower: "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ", digits: "⁰¹²³⁴⁵⁶⁷⁸⁹" },
    circled: {
        label: "Circled",
        lower: "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ",
        upper: "ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ",
        digits: "⓪①②③④⑤⑥⑦⑧⑨"
    }
}
export const FONT_IDS = Object.keys(FONTS)

function convert(ch, font) {
    const lowerAt = LOWER.indexOf(ch)
    if (lowerAt >= 0) return font.lower?.[lowerAt] ?? ch
    const upperAt = LOWER.indexOf(ch.toLowerCase())
    if (upperAt >= 0 && ch !== ch.toLowerCase()) return (font.upper ?? font.lower)?.[upperAt] ?? ch
    const digitAt = DIGITS.indexOf(ch)
    if (digitAt >= 0) return font.digits?.[digitAt] ?? ch
    return ch
}

/**
 * Text in a font. Colour codes pass through untouched: the letter after a §
 * is a code, not part of the name, and converting it would break the colour.
 */
export function applyFont(text, id) {
    const font = FONTS[id]
    const value = String(text ?? "")
    if (!font?.lower) return value
    let out = ""
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]
        if (ch === "§" && i + 1 < value.length) { out += ch + value[++i]; continue }
        out += convert(ch, font)
    }
    return out
}

/** A font's name written in that font, for the list it is picked from. */
export function fontSample(id) {
    return applyFont(FONTS[id]?.label ?? id, id)
}

/** The font list for a form: each font named in itself. */
export function fontOptions() {
    return FONT_IDS.map(id => id === "normal" ? "Normal" : fontSample(id))
}
