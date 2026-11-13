"""Draw Admin+'s rank badges: small pictures that sit in text.

    python tools/genbadges.py
    python tools/genbadges.py --preview <the game's default8.png> [out.png]

The user asked on 2026-11-13 for badges like Twitch's and Discord's, "not their
way, but our way. In our theme and style", on rank tags and on buttons instead
of the word "staff". Their references: flat, bold, geometric symbols that fill
the badge, such as a gavel whose head sits square across a thick diagonal
handle. A first set drawn pixel by pixel looked "sloppy", so every symbol here
is built from shapes (bars, rectangles, circles, arcs) at eight times the size
and then shrunk, which keeps edges clean and angles true. Nothing is copied
from the references or from the game.

Two styles, because the user liked both: the Admin+ style (a dark tile with the
aqua-to-pink bar and the symbol in colour) and the classic (a coloured square
with the symbol in white).

Minecraft draws pictures inside text from "glyph pages": a 16 by 16 grid, one
picture per character, in a resource pack's font folder. Admin+ uses page EA
(characters U+EA00 to U+EAFF), which neither the game (D0-D7, E0, E1, F9-FF)
nor any pack installed on this PC (E0-E4, E7-E9, F1, F9) uses. Each picture is
32 pixels, the size the game's own smooth icons use (its page E0), and still
draws one letter tall. Row 0 is the Admin+ style, row 1 the classic, one
column per badge in the order of BADGES. core/badges.js lists them in the same
order, and tests/badges.test.js checks.
"""
import math
import pathlib
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "Admin+ RP" / "font" / "glyph_EA.png"
CELL = 32      # pixels per picture on the page
SS = 8         # drawn this many times larger, then shrunk
BOX = 22       # a symbol is designed in a 22 by 22 box


def rgb(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


WHITE, BLACK = rgb("ffffff"), rgb("000000")
AQUA, PINK = rgb("55ffff"), rgb("ff55ff")
TILE, EDGE = rgb("1d212c"), rgb("3a4256")


# ------------------------------------------------------------------ shapes
class Pen:
    """Draws in symbol units onto a large mask: 255 is symbol, 0 cuts it away."""

    def __init__(self, draw, left, top):
        self.d, self.left, self.top = draw, left, top

    def p(self, x, y):
        return ((self.left + x) * SS, (self.top + y) * SS)

    def poly(self, points, fill=255):
        self.d.polygon([self.p(x, y) for x, y in points], fill=fill)

    def circle(self, x, y, r, fill=255):
        (cx, cy), rr = self.p(x, y), r * SS
        self.d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=fill)

    def rect(self, x0, y0, x1, y1, fill=255, radius=0):
        a, b = self.p(x0, y0), self.p(x1, y1)
        self.d.rounded_rectangle((a[0], a[1], b[0], b[1]), radius=radius * SS, fill=fill)

    def bar(self, x0, y0, x1, y1, width, fill=255, round_ends=True):
        """A straight bar between two points, with round ends."""
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        nx, ny = -dy / length * width / 2, dx / length * width / 2
        self.poly([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill)
        if round_ends:
            self.circle(x0, y0, width / 2, fill)
            self.circle(x1, y1, width / 2, fill)

    def block(self, cx, cy, along, across, length, thickness, fill=255):
        """A rectangle centred on (cx, cy), `length` along a direction, `thickness` across it."""
        ux, uy = along
        vx, vy = across
        hl, ht = length / 2, thickness / 2
        self.poly([(cx + ux * hl + vx * ht, cy + uy * hl + vy * ht), (cx + ux * hl - vx * ht, cy + uy * hl - vy * ht),
                   (cx - ux * hl - vx * ht, cy - uy * hl - vy * ht), (cx - ux * hl + vx * ht, cy - uy * hl + vy * ht)], fill)

    def arc(self, cx, cy, r, start, end, width, fill=255):
        (x, y), rr = self.p(cx, cy), r * SS
        self.d.arc((x - rr, y - rr, x + rr, y + rr), start, end, fill=fill, width=round(width * SS))


R = 1 / math.sqrt(2)
UP_RIGHT, DOWN_RIGHT = (R, -R), (R, R)   # the two diagonals


def crown(p):
    p.poly([(2, 16), (2, 6.4), (6.9, 11.2), (11, 3.6), (15.1, 11.2), (20, 6.4), (20, 16)])
    p.rect(2, 17.4, 20, 20, radius=0.8)
    for x, y in ((2, 5.4), (11, 2.6), (20, 5.4)):
        p.circle(x, y, 1.8)


def hammer(p):
    # A gavel: a thick handle up the diagonal, and a head square across it
    # with wider striking faces at each end.
    p.bar(3.4, 18.6, 12.4, 9.6, 3.8)
    cx, cy = 14.4, 7.6
    p.block(cx, cy, DOWN_RIGHT, UP_RIGHT, 12.6, 6.2)
    for end in (-1, 1):
        fx, fy = cx + DOWN_RIGHT[0] * 5.6 * end, cy + DOWN_RIGHT[1] * 5.6 * end
        p.block(fx, fy, DOWN_RIGHT, UP_RIGHT, 2.6, 8.6)


def sword(p):
    gx, gy = 7.6, 14.4                        # where the guard crosses
    tx, ty = 20.2, 1.8                        # the tip
    w = 2.2
    nx, ny = DOWN_RIGHT[0] * w, DOWN_RIGHT[1] * w
    sx, sy = tx - UP_RIGHT[0] * 4.2, ty - UP_RIGHT[1] * 4.2
    p.poly([(gx + nx, gy + ny), (sx + nx, sy + ny), (tx, ty), (sx - nx, sy - ny), (gx - nx, gy - ny)])
    p.block(gx, gy, DOWN_RIGHT, UP_RIGHT, 10.2, 3.0)
    p.bar(gx, gy, 3.6, 18.4, 3.0, round_ends=False)
    p.circle(2.8, 19.2, 2.2)


SHIELD = [(2.2, 3.4), (11, 1.2), (19.8, 3.4), (19.8, 9.8), (19.1, 13.2), (17.2, 16.2), (14.4, 18.8), (11, 20.8),
          (7.6, 18.8), (4.8, 16.2), (2.9, 13.2), (2.2, 9.8)]


def shield(p):
    p.poly(SHIELD)
    # The left half solid, the right half hollow: one clean split down the
    # middle. The cut is the shield made smaller, kept to the right of centre.
    inner = [(11 + (x - 11) * 0.70, 11.4 + (y - 11) * 0.72) for x, y in SHIELD]
    p.poly([(max(x, 11.0), y) for x, y in inner], fill=0)


def star(p):
    cx, cy, outer, inner = 11, 11.8, 10.6, 4.6
    points = []
    for i in range(10):
        a = math.radians(-90 + i * 36)
        r = outer if i % 2 == 0 else inner
        points.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    p.poly(points)


def gem(p):
    p.poly([(1.6, 7.6), (6.4, 2.4), (15.6, 2.4), (20.4, 7.6), (11, 20.4)])
    p.bar(1.6, 7.6, 20.4, 7.6, 1.3, fill=0, round_ends=False)
    p.bar(6.4, 2.4, 9.2, 7.6, 1.1, fill=0, round_ends=False)
    p.bar(15.6, 2.4, 12.8, 7.6, 1.1, fill=0, round_ends=False)
    p.bar(9.2, 7.6, 11, 20.4, 1.0, fill=0, round_ends=False)
    p.bar(12.8, 7.6, 11, 20.4, 1.0, fill=0, round_ends=False)


def heart(p):
    p.circle(6.6, 7.6, 5.3)
    p.circle(15.4, 7.6, 5.3)
    p.poly([(1.5, 9.4), (20.5, 9.4), (11, 20.4)])


def bolt(p):
    p.poly([(13.2, 0.8), (3.4, 12.4), (9.8, 12.4), (7.6, 21.2), (18.6, 8.4), (12.2, 8.4), (15.6, 0.8)])


def pickaxe(p):
    p.bar(3.6, 18.6, 13.6, 8.6, 3.4)
    # The head: an arc square across the handle, bulging away from it.
    cx, cy, r = 6.4, 16.2, 12.2
    p.arc(cx, cy, r, 262, 368, 3.8)


def flask(p):
    p.rect(7.0, 0.8, 15.0, 3.6, radius=1.0)
    p.rect(8.6, 3.0, 13.4, 8.4)
    p.poly([(8.6, 8.0), (13.4, 8.0), (20.4, 18.0), (19.4, 20.8), (2.6, 20.8), (1.6, 18.0)])
    p.bar(5.2, 13.0, 16.8, 13.0, 1.4, fill=0, round_ends=False)
    p.circle(13.2, 16.6, 1.2, fill=0)


def check(p):
    p.bar(2.8, 11.6, 8.6, 17.4, 4.2)
    p.bar(8.6, 17.4, 19.6, 4.6, 4.2)


def plus(p):
    p.rect(8.4, 1.2, 13.6, 20.8, radius=1.2)
    p.rect(1.2, 8.4, 20.8, 13.6, radius=1.2)


SYMBOLS = {"crown": crown, "hammer": hammer, "sword": sword, "shield": shield, "star": star, "gem": gem,
           "heart": heart, "bolt": bolt, "pickaxe": pickaxe, "flask": flask, "check": check, "plus": plus}

# The badges, in glyph order: (key, the name players see, classic colour,
# Admin+ style colour). Admin+'s own mark uses the aqua-to-pink of its name.
BADGES = [
    ("crown", "Crown", "e09f00", "ffd166"),
    ("hammer", "Ban hammer", "1fae45", "6bff8f"),
    ("sword", "Sword", "e03131", "ff8787"),
    ("shield", "Shield", "4c6ef5", "91a7ff"),
    ("star", "Star", "f08c00", "ffd43b"),
    ("gem", "Gem", "15aabf", "66d9e8"),
    ("heart", "Heart", "e64980", "faa2c1"),
    ("bolt", "Bolt", "7950f2", "b197fc"),
    ("pickaxe", "Pickaxe", "c8692a", "ffa94d"),
    ("flask", "Flask", "ae3ec9", "e599f7"),
    ("check", "Check", "228be6", "74c0fc"),
    ("plus", "Admin+", None, None),
]


def symbol_mask(name, top):
    mask = Image.new("L", (CELL * SS, CELL * SS), 0)
    SYMBOLS[name](Pen(ImageDraw.Draw(mask), (CELL - BOX) / 2, top))
    return mask


def tile_mask(radius=6.5):
    mask = Image.new("L", (CELL * SS, CELL * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, CELL * SS - 1, CELL * SS - 1), radius=radius * SS, fill=255)
    return mask


def gradient(size, a, b):
    img = Image.new("RGBA", size)
    for x in range(size[0]):
        c = mix(a, b, x / (size[0] - 1))
        for y in range(size[1]):
            img.putpixel((x, y), c)
    return img


def shrink(img):
    return img.resize((CELL, CELL), Image.BOX)


def admin_style(name, colour):
    """Ours: a dark tile, the Admin+ bar on top, the symbol in colour."""
    big = (CELL * SS, CELL * SS)
    shape = tile_mask()
    wash = rgb(colour) if colour else mix(AQUA, PINK, 0.5)
    base = Image.new("RGBA", big, (0, 0, 0, 0))
    body = Image.new("RGBA", big, mix(TILE, wash, 0.10))
    base.paste(body, (0, 0), shape)
    inner = Image.new("L", big, 0)
    ImageDraw.Draw(inner).rounded_rectangle((SS, SS, big[0] - 1 - SS, big[1] - 1 - SS), radius=5.5 * SS, fill=255)
    edge = Image.new("RGBA", big, EDGE)
    ring = Image.eval(shape, lambda v: v)
    ring.paste(0, (0, 0), inner)
    base.paste(edge, (0, 0), ring)
    bar = gradient((big[0], int(4.2 * SS)), AQUA, PINK)
    bar_mask = Image.new("L", big, 0)
    bar_mask.paste(shape.crop((0, 0, big[0], int(4.2 * SS))), (0, 0))
    base.paste(bar, (0, 0), bar_mask.crop((0, 0, big[0], int(4.2 * SS))))
    sym = symbol_mask(name, (CELL - BOX) / 2 + 1.8)
    fill = gradient(big, AQUA, PINK) if colour is None else Image.new("RGBA", big, rgb(colour))
    base.paste(fill, (0, 0), sym)
    return shrink(base)


def classic_style(name, colour):
    """The classic: a coloured square, the symbol in white."""
    big = (CELL * SS, CELL * SS)
    base = Image.new("RGBA", big, (0, 0, 0, 0))
    fill = gradient(big, rgb("0fb9c6"), rgb("d63bd6")) if colour is None else Image.new("RGBA", big, rgb(colour))
    base.paste(fill, (0, 0), tile_mask())
    base.paste(Image.new("RGBA", big, WHITE), (0, 0), symbol_mask(name, (CELL - BOX) / 2))
    return shrink(base)


def build():
    sheet = Image.new("RGBA", (CELL * 16, CELL * 16), (0, 0, 0, 0))
    for i, (key, _label, classic, admin) in enumerate(BADGES):
        sheet.alpha_composite(admin_style(key, admin), (i * CELL, 0))
        sheet.alpha_composite(classic_style(key, classic), (i * CELL, CELL))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    return sheet


def preview(sheet, font_path, path):
    """The badges beside chat text drawn with the game's own font (never shipped).

    Text is drawn at 3 screen pixels per font pixel, as at GUI scale 3, where a
    badge is 24 pixels: the game shrinks the 32-pixel picture to fit a letter.
    """
    font = Image.open(font_path).convert("RGBA")
    mc = {"0": "000000", "4": "AA0000", "5": "AA00AA", "6": "FFAA00", "7": "AAAAAA", "8": "555555", "a": "55FF55",
          "b": "55FFFF", "c": "FF5555", "d": "FF55FF", "e": "FFFF55", "f": "FFFFFF", "9": "5555FF", "2": "00AA00"}
    scale = 3
    keys = [b[0] for b in BADGES]

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
                idx = keys.index(s[i + 1:end])
                cell = sheet.crop((idx * CELL, row * CELL, idx * CELL + CELL, row * CELL + CELL))
                img.alpha_composite(cell.resize((8 * scale, 8 * scale), Image.LANCZOS), (x, y + 2 * scale))
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

    width = 1500
    img = Image.new("RGBA", (width, 700), rgb("2f4a22"))
    for row, title in ((0, "Admin+ style"), (1, "Classic style")):
        top = 14 + row * 340
        img.alpha_composite(Image.new("RGBA", (920, 170), (0, 0, 0, 105)), (14, top + 36))
        text(img, 14, top, f"§f{title}", row)
        text(img, 24, top + 44, "§7General §8| {crown} §8[§4Owner§8] §dMidnight§f: ay ts name", row)
        text(img, 24, top + 84, "§7General §8| {hammer} §8[§aMod§8] §fWafflehouse9549§f: dihi", row)
        text(img, 24, top + 124, "§7General §8| {shield} §8[§6Admin§8] §fSteve§f: hi", row)
        img.alpha_composite(Image.new("RGBA", (530, 170), rgb("12141b")), (950, top + 36))
        for n, (badge, name) in enumerate([("crown", "§71. §4Owner"), ("shield", "§72. §6Admin"), ("hammer", "§73. §aMod")]):
            img.alpha_composite(Image.new("RGBA", (510, 44), rgb("1d212c")), (960, top + 44 + n * 52))
            text(img, 972, top + 48 + n * 52, f"{{{badge}}} {name}", row)
        for i in range(len(BADGES)):
            cell = sheet.crop((i * CELL, row * CELL, i * CELL + CELL, row * CELL + CELL))
            img.alpha_composite(cell.resize((96, 96), Image.NEAREST), (24 + i * 120, top + 222))
    img.save(path)
    print("preview:", path)


if __name__ == "__main__":
    sheet = build()
    print(f"{len(BADGES)} badges in two styles -> {OUT}")
    if "--preview" in sys.argv:
        rest = sys.argv[sys.argv.index("--preview") + 1:]
        fonts = [a for a in rest if a.endswith("default8.png")]
        outs = [a for a in rest if a.endswith(".png") and not a.endswith("default8.png")]
        if not fonts:
            raise SystemExit("--preview needs the path to the game's default8.png (see tools/vanillaui.py)")
        preview(sheet, fonts[0], outs[0] if outs else str(ROOT / "notes" / "badges-preview.png"))
