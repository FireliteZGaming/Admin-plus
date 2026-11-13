"""Draw Admin+'s rank badges: small pictures that sit in text.

    python tools/genbadges.py              # the glyph page for the pack
    python tools/genbadges.py --preview    # also a preview beside real chat text

The user asked on 2026-11-13 for badges like Twitch's mod badge, "not their
way, but our way. In our theme and style", on rank tags and on buttons instead
of the word "staff". Of the first previews they liked two: the dark tile with
the Admin+ aqua-to-pink bar, and the classic coloured square. Both are drawn
here, and a server picks one.

Minecraft draws pictures inside text from "glyph pages": a 16 by 16 grid of
pictures, one per character, in a resource pack's font folder. Admin+ uses page
EA (characters U+EA00 to U+EAFF). Neither the game (D0-D7, E0, E1, F9-FF) nor
any pack installed on this PC (E0-E4, E7-E9, F1, F9) uses it, so they can't
clash. Row 0 holds the Admin+ style, row 1 the classic style, one column per
badge, in the order of BADGES below. core/badges.js must list them in the same
order; tests/badges.test.js checks.

Everything is drawn from scratch. The Ban Hammer is a real mace in game, so
the hammer badge is a mace shape, drawn here, not the game's picture.
"""
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "Admin+ RP" / "font" / "glyph_EA.png"
CELL = 16


def rgb(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


WHITE, BLACK = rgb("ffffff"), rgb("000000")
AQUA, PINK = rgb("55ffff"), rgb("ff55ff")
TILE, EDGE = rgb("1d212c"), rgb("3a4256")

# Each symbol is drawn on a 12 by 12 grid: x is its colour, h a lighter tone,
# s a darker one, w always white, and . see-through.
SYMBOLS = {
    "crown": [
        "............",
        ".h...hh...h.",
        ".x...xx...x.",
        ".xx..xx..xx.",
        ".xxx.xx.xxx.",
        ".xxxxxxxxxx.",
        ".xxxxxxxxxx.",
        ".xxwxxxxwxx.",
        ".xxxxxxxxxx.",
        ".ssssssssss.",
        "............",
        "............"],
    "hammer": [
        "...hhhhhhhh.",
        "...xxxxxxxx.",
        "...xxxxxxxx.",
        "...xxxxxxxx.",
        "...ssssssss.",
        "......ss....",
        ".....ss.....",
        "....ss......",
        "...ss.......",
        "..ss........",
        ".ss.........",
        "............"],
    "shield": [
        "............",
        ".hhhhhxxxxx.",
        ".hhhhhxxxxx.",
        ".hhhhhxxxxx.",
        ".hhhhhxxxxx.",
        ".hhhhhxxxxx.",
        "..hhhhxxxx..",
        "..hhhhxxxx..",
        "...hhhxxx...",
        "....hhxx....",
        ".....hx.....",
        "............"],
    "star": [
        ".....hh.....",
        ".....hh.....",
        "....hxxx....",
        "hhhhxxxxxxxx",
        ".hxxxxxxxxx.",
        "..xxxxxxxx..",
        "...xxxxxx...",
        "..xxxxxxxx..",
        "..xxxssxxx..",
        ".xxs....sxx.",
        ".ss......ss.",
        "............"],
    "gem": [
        "............",
        "...hhhhhh...",
        "..hhhwhhhh..",
        ".hxxxxxxxxs.",
        "hxxxxxxxxxxs",
        ".xxxxxxxxxs.",
        "..xxxxxxxs..",
        "...xxxxxs...",
        "....xxxs....",
        ".....xs.....",
        "............",
        "............"],
    "heart": [
        "............",
        "..hhh..xxx..",
        ".hwhhhxxxxx.",
        "hhhhxxxxxxxx",
        "hhxxxxxxxxxx",
        "xxxxxxxxxxxx",
        ".xxxxxxxxxs.",
        "..xxxxxxxs..",
        "...xxxxxs...",
        "....xxxs....",
        ".....xs.....",
        "............"],
    "bolt": [
        "......hhhh..",
        ".....hhhh...",
        "....xxxx....",
        "...xxxx.....",
        "..xxxxxxxx..",
        "......xxx...",
        ".....xxx....",
        "....xxx.....",
        "...xxs......",
        "..xs........",
        ".s..........",
        "............"],
    "pickaxe": [
        "..hhhhhh....",
        ".xxxxxxxxx..",
        "xxs....ssxx.",
        "xs.....ssxx.",
        ".......sssx.",
        "......ss..x.",
        ".....ss.....",
        "....ss......",
        "...ss.......",
        "..ss........",
        ".ss.........",
        "............"],
    "flask": [
        "....hhhh....",
        ".....xx.....",
        ".....xx.....",
        "....xxxx....",
        "...xxxxxx...",
        "..xxxxxxxx..",
        ".xwwhhhhhxx.",
        ".xhhhhhhhhx.",
        ".xhhhhhhhhx.",
        "..ssssssss..",
        "............",
        "............"],
    "check": [
        "............",
        "..........hh",
        ".........hhx",
        "........hxx.",
        ".......xxx..",
        "hh....xxx...",
        "xxx..xxx....",
        ".xxxxxx.....",
        "..xxxx......",
        "...ss.......",
        "............",
        "............"],
    "plus": [
        "....hhhh....",
        "....xxxx....",
        "....xxxx....",
        "....xxxx....",
        "hhhhxxxxhhhh",
        "xxxxxxxxxxxx",
        "xxxxxxxxxxxx",
        "ssssxxxxssss",
        "....xxxx....",
        "....xxxx....",
        "....ssss....",
        "............"],
}

# The badges, in glyph order. Each: (key, the name players see, colour).
# Admin+'s own mark uses the aqua-to-pink of its name instead of one colour.
BADGES = [
    ("crown", "Crown", "ffd166"),
    ("hammer", "Ban hammer", "51cf66"),
    ("shield", "Shield", "ff6b6b"),
    ("star", "Star", "fcc419"),
    ("gem", "Gem", "3bc9db"),
    ("heart", "Heart", "f06595"),
    ("bolt", "Bolt", "9775fa"),
    ("pickaxe", "Pickaxe", "e8a15c"),
    ("flask", "Flask", "cc5de8"),
    ("check", "Check", "4dabf7"),
    ("plus", "Admin+", None),
]


def tones(colour):
    """Base, lighter and darker tones of one colour."""
    return colour, mix(colour, WHITE, 0.45), mix(colour, BLACK, 0.35)


def paint_symbol(img, name, left, top, palette):
    base, light, dark = palette
    for y, row in enumerate(SYMBOLS[name]):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            colour = {"x": base, "h": light, "s": dark, "w": WHITE}[ch]
            img.putpixel((left + x, top + y), colour)


def gradient_at(x, width=CELL):
    return mix(AQUA, PINK, x / (width - 1))


def round_corners(img):
    for x, y in ((0, 0), (CELL - 1, 0), (0, CELL - 1), (CELL - 1, CELL - 1)):
        img.putpixel((x, y), (0, 0, 0, 0))
    return img


def admin_style(name, colour):
    """Ours: a dark tile with the Admin+ bar on top and the symbol in colour.

    The tile carries a faint wash of the badge's colour, brighter at the top,
    so badges can be told apart at a glance even where the symbol is small.
    """
    img = Image.new("RGBA", (CELL, CELL), TILE)
    wash = rgb(colour) if colour else mix(AQUA, PINK, 0.5)
    for y in range(2, CELL - 1):
        tint = mix(TILE, wash, 0.16 - 0.10 * (y - 2) / (CELL - 4))
        for x in range(1, CELL - 1):
            img.putpixel((x, y), tint)
    for x in range(CELL):
        bar = gradient_at(x)
        img.putpixel((x, 0), bar)
        img.putpixel((x, 1), mix(bar, TILE, 0.35))
        img.putpixel((x, CELL - 1), EDGE)
    for y in range(2, CELL):
        img.putpixel((0, y), EDGE)
        img.putpixel((CELL - 1, y), EDGE)
    if colour is None:
        # Admin+'s mark: the symbol itself takes the aqua-to-pink.
        sym = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
        paint_symbol(sym, name, 0, 0, (WHITE, WHITE, rgb("c8d0e0")))
        for y in range(12):
            for x in range(12):
                r, g, b, a = sym.getpixel((x, y))
                if a:
                    tint = gradient_at(x + 2)
                    shade = (r + g + b) / (3 * 255)
                    sym.putpixel((x, y), mix(BLACK, tint, shade))
        img.alpha_composite(sym, (2, 3))
    else:
        paint_symbol(img, name, 2, 3, tones(rgb(colour)))
    return round_corners(img)


def classic_style(name, colour):
    """The classic: a coloured square with a white symbol, lit from the top."""
    img = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    for y in range(CELL):
        for x in range(CELL):
            base = gradient_at(x) if colour is None else rgb(colour)
            if y == 0 or x == 0:
                c = mix(base, WHITE, 0.25)
            elif y == CELL - 1 or x == CELL - 1:
                c = mix(base, BLACK, 0.30)
            else:
                c = base
            img.putpixel((x, y), c)
    base = rgb("ffffff")
    shadow = mix(gradient_at(8) if colour is None else rgb(colour), BLACK, 0.45)
    # A soft shadow under the symbol, one pixel down and right.
    sym = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    paint_symbol(sym, name, 2, 2, (base, base, rgb("dfe3ea")))
    for y in range(CELL - 1):
        for x in range(CELL - 1):
            if sym.getpixel((x, y))[3] and not sym.getpixel((x + 1, y + 1))[3]:
                img.putpixel((x + 1, y + 1), shadow)
    img.alpha_composite(sym)
    return round_corners(img)


def build():
    sheet = Image.new("RGBA", (CELL * 16, CELL * 16), (0, 0, 0, 0))
    for i, (key, _label, colour) in enumerate(BADGES):
        sheet.alpha_composite(admin_style(key, colour), (i * CELL, 0))
        sheet.alpha_composite(classic_style(key, colour), (i * CELL, CELL))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    return sheet


def preview(sheet, path):
    """The badges beside real chat text, using the game's own font sheet.

    The font is read from wherever it was unpacked (tools/vanillaui.py style),
    passed on the command line, and never copied into the pack.
    """
    candidates = [pathlib.Path(p) for p in sys.argv if p.endswith("default8.png")]
    if not candidates:
        print("preview needs the game's default8.png path as an argument")
        return
    font = Image.open(candidates[0]).convert("RGBA")
    mc = {"0": "000000", "4": "AA0000", "5": "AA00AA", "6": "FFAA00", "7": "AAAAAA", "8": "555555", "a": "55FF55",
          "b": "55FFFF", "c": "FF5555", "d": "FF55FF", "e": "FFFF55", "f": "FFFFFF", "9": "5555FF", "2": "00AA00"}
    scale = 2

    def glyph(ch):
        code = ord(ch)
        x, y = (code % 16) * 8, (code // 16) * 12
        cell = font.crop((x, y, x + 8, y + 12))
        box = cell.getbbox()
        return cell, 4 if ch == " " else ((box[2] if box else 3) + 1)

    def text(img, x, y, s, row):
        colour = rgb("ffffff")
        i = 0
        while i < len(s):
            ch = s[i]
            if ch == "§":
                code = s[i + 1]
                if code in mc:
                    colour = rgb(mc[code])
                elif code == "r":
                    colour = rgb("ffffff")
                i += 2
                continue
            if ch == "{":
                end = s.index("}", i)
                idx = [b[0] for b in BADGES].index(s[i + 1:end])
                cell = sheet.crop((idx * CELL, row * CELL, idx * CELL + CELL, row * CELL + CELL))
                big = cell.resize((8 * scale, 8 * scale), Image.NEAREST)
                img.alpha_composite(big, (x, y + 2 * scale))
                x += 9 * scale
                i = end + 1
                continue
            cell, width = glyph(ch)
            tinted = Image.new("RGBA", cell.size, colour[:3] + (0,))
            tinted.putalpha(cell.getchannel("A"))
            big = tinted.resize((8 * scale, 12 * scale), Image.NEAREST)
            sh = Image.new("RGBA", big.size, tuple(v // 4 for v in colour[:3]) + (0,))
            sh.putalpha(big.getchannel("A"))
            img.alpha_composite(sh, (x + scale, y + scale))
            img.alpha_composite(big, (x, y))
            x += width * scale
            i += 1
        return x

    width = 1460
    img = Image.new("RGBA", (width, 640), rgb("2f4a22"))
    for row, title in ((0, "Admin+ style"), (1, "Classic style")):
        top = 16 + row * 312
        chat = Image.new("RGBA", (860, 150), (0, 0, 0, 105))
        img.alpha_composite(chat, (16, top + 30))
        text(img, 16, top, f"§f{title}", row)
        text(img, 26, top + 38, "§7General §8| §8[{crown} §4Owner§8] §dMidnight§f: ay ts name thingy w aswell", row)
        text(img, 26, top + 66, "§7General §8| §8[{hammer} §aMod§8] §fWafflehouse9549§f: dihi", row)
        text(img, 26, top + 94, "§7General §8| §8[{gem} §eVIP§8] §fSteve§f: nice", row)
        text(img, 26, top + 122, "§7General §8| §8[{plus} §bAdmin§d+ §e§lCreator§8] §cFirelite§f: yeah", row)
        # a rank list row, as in the Beta look
        rows = Image.new("RGBA", (520, 120), rgb("12141b"))
        img.alpha_composite(rows, (900, top + 30))
        for n, (badge, name) in enumerate([("crown", "§41. §4§lOwner"), ("shield", "§72. §6§lAdmin"), ("hammer", "§73. §aMod")]):
            btn = Image.new("RGBA", (500, 32), rgb("1d212c"))
            img.alpha_composite(btn, (910, top + 36 + n * 36))
            text(img, 920, top + 40 + n * 36, f"{{{badge}}} {name}", row)
        # every badge, bigger
        for i in range(len(BADGES)):
            cell = sheet.crop((i * CELL, row * CELL, i * CELL + CELL, row * CELL + CELL))
            img.alpha_composite(cell.resize((64, 64), Image.NEAREST), (26 + i * 76, top + 196))
    img.save(path)
    print("preview:", path)


if __name__ == "__main__":
    sheet = build()
    print(f"{len(BADGES)} badges in two styles -> {OUT}")
    if "--preview" in sys.argv:
        out = [p for p in sys.argv if p.endswith(".png") and not p.endswith("default8.png")]
        preview(sheet, out[0] if out else str(ROOT / "notes" / "badges-preview.png"))
