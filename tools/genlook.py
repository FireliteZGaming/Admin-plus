"""Draw the textures for Admin+'s own look (the Beta UI, 2.11.0).

    python tools/genlook.py

Writes PNGs into Admin+ RP/textures/ui/adminplus/. Everything here is drawn
from scratch: flat colours, two gradients, and 8x8 pixel icons taken from the
concept the user approved on 2026-11-13 ("Yes the UI is perfect"). No game
texture is copied. Run it again after changing a colour or an icon; the output
is the same every time.

The colours are the concept's (Obsidian > Admin+ > UI Overhaul).
"""
import math
import pathlib
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / "Admin+ RP" / "textures" / "ui" / "adminplus"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


AQUA, PINK = rgb("55ffff"), rgb("ff55ff")
RED, GREEN, GOLD = rgb("ff6b6b"), rgb("6bff8f"), rgb("ffd166")
STEEL, WHITE, PURPLE = rgb("9aa3b8"), rgb("f2f4f8"), rgb("c77dff")
PANEL_TOP, PANEL_BOTTOM = rgb("191c25"), rgb("12141b")
TILE, TILE_HOVER, TILE_PRESSED = rgb("1d212c"), rgb("252a38"), rgb("161922")
CLEAR = (0, 0, 0, 0)


def save(img, name):
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / f"{name}.png")
    return name


def flat(colour, name, size=4):
    return save(Image.new("RGBA", (size, size), colour), name)


def blend(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def gradient(a, b, name, w, h, horizontal=True):
    img = Image.new("RGBA", (w, h))
    steps = (w if horizontal else h) - 1
    for x in range(w):
        for y in range(h):
            img.putpixel((x, y), blend(a, b, (x if horizontal else y) / steps))
    return save(img, name)


# ---------------------------------------------------------------- icons
# Each icon is 8x8, written as rows. A letter is a colour from its palette and
# "." is see-through, so the tile shows behind holes like the gear's middle.

ICONS = {
    # The concept's six (/admin).
    "player": ({"h": "5a3d24", "s": "c69c6d", "w": "ffffff", "b": "3b5bdb", "m": "8a5a3b"}, [
        "hhhhhhhh",
        "hhhhhhhh",
        "ssssssss",
        "ssssssss",
        "swbssbws",
        "ssssssss",
        "sssmmsss",
        "ssssssss"]),
    # Personalization (2.12.0): a painter's palette with four dabs of colour.
    "palette": ({"w": "d9b77e", "d": "a07a43", "r": "ff5555", "y": "ffff55", "b": "55ffff", "p": "ff55ff"}, [
        "..wwww..",
        ".wrwwyw.",
        "wwwwwwww",
        "wbwwddww",
        "wwwwddw.",
        "wwpwwww.",
        ".wwwwww.",
        "..wwww.."]),
    "crown": ({"g": "ffd166", "d": "c99a2e", "a": "55ffff"}, [
        "........",
        "...gg...",
        "g..gg..g",
        "g..gg..g",
        "gggaaggg",
        "gggggggg",
        "dddddddd",
        "........"]),
    "pin": ({"g": "6bff8f"}, [
        "..gggg..",
        ".gggggg.",
        ".gg..gg.",
        ".gggggg.",
        "..gggg..",
        "...gg...",
        "...gg...",
        "........"]),
    "scroll": ({"e": "b89b5e", "p": "e8d9b0", "l": "7a6a4a", "k": "ff55ff"}, [
        "eeeeeeee",
        ".pppppp.",
        ".pllllp.",
        ".pppppp.",
        ".plllkp.",
        ".pppppp.",
        ".pppppp.",
        "eeeeeeee"]),
    "gear": ({"s": "9aa3b8"}, [
        "...ss...",
        ".ssssss.",
        ".ssssss.",
        "sss..sss",
        "sss..sss",
        ".ssssss.",
        ".ssssss.",
        "...ss..."]),
    "help": ({"w": "f2f4f8"}, [
        "..wwww..",
        ".ww..ww.",
        ".ww..ww.",
        ".....ww.",
        "...ww...",
        "...ww...",
        "........",
        "...ww..."]),
    # Added for /menu and the reports badge, in the same style.
    "alert": ({"g": "ffd166"}, [
        "...gg...",
        "...gg...",
        "...gg...",
        "...gg...",
        "...gg...",
        "........",
        "...gg...",
        "...gg..."]),
    "compass": ({"s": "9aa3b8", "r": "ff6b6b", "w": "f2f4f8"}, [
        "..ssss..",
        ".s.rr.s.",
        "s..rr..s",
        "s..rr..s",
        "s..ww..s",
        "s..ww..s",
        ".s.ww.s.",
        "..ssss.."]),
    "people": ({"h": "5a3d24", "s": "c69c6d", "a": "55ffff", "p": "ff55ff"}, [
        "hhh..hhh",
        "sss..sss",
        "sss..sss",
        "........",
        "aaa..ppp",
        "aaa..ppp",
        "aaa..ppp",
        "........"]),
    "shield": ({"d": "3fbf62", "g": "6bff8f"}, [
        "dddddddd",
        "dggggggd",
        "dggggggd",
        "dggggggd",
        "dggggggd",
        ".dggggd.",
        "..dggd..",
        "...dd..."]),
    "terminal": ({"s": "9aa3b8", "k": "0f1117", "p": "ff55ff", "w": "f2f4f8"}, [
        "ssssssss",
        "skkkkkks",
        "skpkkkks",
        "skkpkkks",
        "skpkwwks",
        "skkkkkks",
        "ssssssss",
        "........"]),
    # Setup's wide tile in /admin (3.1.6): a star, for getting started.
    "star": ({"g": "ffd166", "d": "c99a2e"}, [
        "...gg...",
        "...gg...",
        "gggggggg",
        ".gggggg.",
        "..gggg..",
        ".gggggg.",
        ".dd..dd.",
        "d......d"]),
    # The Logs timeline (2.12.5). Drawn in one colour on a round dot, so only
    # the shape matters here.
    "hammer": ({"g": "ffffff"}, [
        "gggggg..",
        "gggggg..",
        "gggggg..",
        "..gg....",
        "..gg....",
        "..gg....",
        "..gg....",
        "..gg...."]),
    "bubble": ({"g": "ffffff"}, [
        ".gggggg.",
        "gggggggg",
        "gggggggg",
        "gggggggg",
        ".gggggg.",
        "..gg....",
        ".gg.....",
        "........"]),
    "eye": ({"g": "ffffff"}, [
        "........",
        "..gggg..",
        ".gg..gg.",
        "gg.gg.gg",
        "gg.gg.gg",
        ".gg..gg.",
        "..gggg..",
        "........"]),
    "sign": ({"g": "ffffff"}, [
        "gggggggg",
        "gggggggg",
        "gggggggg",
        "gggggggg",
        "...gg...",
        "...gg...",
        "...gg...",
        "........"]),
    "block": ({"g": "ffffff"}, [
        "gggggggg",
        "g......g",
        "g.g....g",
        "g..g...g",
        "g.g..g.g",
        "g......g",
        "gggggggg",
        "........"]),
    "down": ({"g": "ffffff"}, [
        "...gg...",
        "...gg...",
        "...gg...",
        "...gg...",
        "gggggggg",
        ".gggggg.",
        "..gggg..",
        "...gg..."]),
    "up": ({"g": "ffffff"}, [
        "...gg...",
        "..gggg..",
        ".gggggg.",
        "gggggggg",
        "...gg...",
        "...gg...",
        "...gg...",
        "...gg..."]),
    "undo": ({"g": "ffffff"}, [
        "..g.....",
        ".gg.....",
        "gggggg..",
        ".gg...g.",
        "..g....g",
        ".......g",
        "......g.",
        "..gggg.."]),
    "bin": ({"g": "ffffff"}, [
        "..gggg..",
        "gggggggg",
        ".gggggg.",
        ".g.gg.g.",
        ".g.gg.g.",
        ".g.gg.g.",
        ".g.gg.g.",
        ".gggggg."]),
    "search": ({"g": "ffffff"}, [
        ".gggg...",
        "gg..gg..",
        "g....g..",
        "g....g..",
        "gg..gg..",
        ".gggggg.",
        "......gg",
        ".......g"]),
}

# The Logs timeline's pictures (2.12.5): a dark round dot ringed in the kind's
# colour, the icon inside in the same colour. Keys are what scripts pass
# (core/look.js logIcon()); kinds match features/logbook.js KIND_ICON.
LOG_ICONS = {
    "moderation": ("hammer", RED),
    "chatmod": ("bubble", PINK),
    "people": ("crown", AQUA),
    "staff": ("eye", GOLD),
    "server": ("gear", STEEL),
    "reports": ("alert", rgb("ffa94d")),
    "land": ("shield", GREEN),
    "signs": ("sign", rgb("d9b77e")),
    "blocks": ("block", PURPLE),
    "older": ("down", STEEL),
    "newer": ("up", STEEL),
    "undo": ("undo", GOLD),
    "clear": ("bin", RED),
    "search": ("search", AQUA),
}

# The flowing aqua-to-pink (2.12.6): a flip book the menus step through, so the
# bar on top of every Admin+ menu drifts. The game's flip books step by
# frame_step pixels; whether it steps across or down is not written down
# anywhere this tool can read, so the gradient runs DIAGONALLY: moving the
# 128x2 window 4 pixels right or 4 pixels down shows the same next frame.
# One loop is 64 frames of 4 pixels, which is one period of the gradient
# (aqua to pink and back over 256 pixels), so it never jumps.
FLOW_PERIOD, FLOW_STEP, FLOW_FRAMES, FLOW_WINDOW = 256, 4, 64, (128, 2)


def flow_texture():
    width = FLOW_WINDOW[0] + (FLOW_FRAMES - 1) * FLOW_STEP + FLOW_STEP
    height = FLOW_WINDOW[1] + (FLOW_FRAMES - 1) * FLOW_STEP + FLOW_STEP
    img = Image.new("RGBA", (width, height))
    half = FLOW_PERIOD / 2
    for x in range(width):
        for y in range(height):
            p = (x + y) % FLOW_PERIOD
            img.putpixel((x, y), blend(AQUA, PINK, p / half if p < half else (FLOW_PERIOD - p) / half))
    return save(img, "flow")


# A dot is 32x32 and shows at 16x16, so it stays sharp: a ring 2 wide, then
# the 8x8 icon at 2 pixels per pixel in the middle.
DOT = 32


def log_dot(key, icon, colour):
    _palette, rows = ICONS[icon]
    img = Image.new("RGBA", (DOT, DOT), CLEAR)
    inside = blend(TILE, colour, 0.16)
    middle = (DOT - 1) / 2
    for x in range(DOT):
        for y in range(DOT):
            d = ((x - middle) ** 2 + (y - middle) ** 2) ** 0.5
            if d <= 15.5:
                img.putpixel((x, y), colour if d > 13.5 else inside)
    left = top = (DOT - 16) // 2
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            for dx in range(2):
                for dy in range(2):
                    img.putpixel((left + x * 2 + dx, top + y * 2 + dy), colour)
    return save(img, f"log_{key}")

# The tiles in Admin+'s own look. A tile's colour stripe is drawn into its
# icon, so the stripe and the icon arrive together on one button image and
# the resource pack needs no string tricks to colour it. Keys are what
# scripts pass (core/look.js tile()).
TILES = {
    "players": ("player", RED),
    "ranks": ("crown", AQUA),
    "places": ("pin", GREEN),
    "logs": ("scroll", PINK),
    "server": ("gear", STEEL),
    "help": ("help", WHITE),
    "reports": ("alert", GOLD),
    "travel": ("compass", GREEN),
    "people": ("people", AQUA),
    "claims": ("shield", GREEN),
    "settings": ("gear", STEEL),
    "console": ("terminal", PURPLE),
    "personalize": ("palette", PINK),
    "setup": ("star", GOLD),
}

# A tile's icon area is 32x34 on screen (inside the button's 1px edge), drawn
# at twice that so it stays sharp: a 6px stripe, an 8px gap, then the icon at
# 6px per pixel, centred top to bottom.
TILE_W, TILE_H, STRIPE, GAP, SCALE = 64, 68, 6, 8, 6


def tile_texture(key, icon, stripe):
    palette, rows = ICONS[icon]
    img = Image.new("RGBA", (TILE_W, TILE_H), CLEAR)
    for x in range(STRIPE):
        for y in range(TILE_H):
            img.putpixel((x, y), stripe)
    left, top = STRIPE + GAP, (TILE_H - 8 * SCALE) // 2
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            colour = rgb(palette[ch])
            for dx in range(SCALE):
                for dy in range(SCALE):
                    img.putpixel((left + x * SCALE + dx, top + y * SCALE + dy), colour)
    return save(img, f"tile_{key}")


# The strip along the top of each template card (2.11.4), in the colour its
# rank usually has: Mod green, Admin gold, Manager purple, Owner dark red.
STRIPES = {"mod": "55ff55", "admin": "ffaa00", "manager": "aa00aa", "owner": "aa0000"}


# ------------------------------------------------------------- Bot Guard
# Bot Guard's own look (3.1.5, the user: "its own unique UI look really
# animated and good"). Drawn smooth, at SS times the size and shrunk, the way
# the rank badges learned to be (2.11.3: pixel by pixel looked "sloppy").
SS = 8
DARK = rgb("0b0d12")


def smooth(w, h, draw, name, out=None):
    """Draw a w by h design SS times over and shrink it. Saved at `out`, twice
    the size it shows at by default, like the tile icons, so it stays sharp."""
    ow, oh = out or (w * 2, h * 2)
    s = SS * ow / w
    big = Image.new("RGBA", (round(w * s), round(h * s)), CLEAR)
    draw(big, ImageDraw.Draw(big), s)
    return save(big.resize((ow, oh), Image.LANCZOS), name)


def shield_points(w, h, inset=0.0):
    """A heater shield: a straight top with round corners, sides that curve to a point."""
    pts = []
    left, right, top, bottom = inset, w - inset, inset, h - inset
    mid = w / 2
    corner = w * 0.12
    # Top edge, round corners.
    for i in range(9):
        a = math.pi * (1 + i / 16)
        pts.append((left + corner + corner * math.cos(a), top + corner + corner * math.sin(a)))
    for i in range(9):
        a = math.pi * (1.5 + i / 16)
        pts.append((right - corner + corner * math.cos(a), top + corner + corner * math.sin(a)))
    # Right side down, then a curve to the point.
    shoulder = top + (bottom - top) * 0.5
    pts.append((right, shoulder))
    for i in range(1, 17):
        t = i / 16
        # Quadratic curve from the shoulder through (right, bottom-ish) to the point.
        x = (1 - t) ** 2 * right + 2 * (1 - t) * t * right + t ** 2 * mid
        y = (1 - t) ** 2 * shoulder + 2 * (1 - t) * t * (bottom - (bottom - top) * 0.12) + t ** 2 * bottom
        pts.append((x, y))
    for i in range(1, 17):
        t = i / 16
        x = (1 - t) ** 2 * mid + 2 * (1 - t) * t * left + t ** 2 * left
        y = (1 - t) ** 2 * bottom + 2 * (1 - t) * t * (bottom - (bottom - top) * 0.12) + t ** 2 * shoulder
        pts.append((x, y))
    return pts


def vertical_gradient(w, h, a, b):
    img = Image.new("RGBA", (w, h))
    for y in range(h):
        colour = blend(a, b, y / max(1, h - 1))
        for x in range(w):
            img.putpixel((x, y), colour)
    return img


def robot(draw, cx, cy, size, face, eye, antenna_tip):
    """A small robot head: a rounded square, two eyes, a mouth, an antenna."""
    half = size / 2
    draw.rounded_rectangle([cx - half, cy - half * 0.8, cx + half, cy + half * 0.8], radius=size * 0.22, fill=face)
    r = size * 0.11
    for dx in (-size * 0.22, size * 0.22):
        draw.ellipse([cx + dx - r, cy - r * 1.3, cx + dx + r, cy + r * 0.7], fill=eye)
    draw.rounded_rectangle([cx - size * 0.2, cy + size * 0.18, cx + size * 0.2, cy + size * 0.26], radius=size * 0.04, fill=DARK)
    draw.line([cx, cy - half * 0.8, cx, cy - half * 1.25], fill=face, width=max(1, int(size * 0.08)))
    tip = size * 0.1
    draw.ellipse([cx - tip, cy - half * 1.25 - tip, cx + tip, cy - half * 1.25 + tip], fill=antenna_tip)


def guard_shield(off=False):
    """The emblem: a dark shield ringed aqua to pink, a white robot inside with aqua eyes.
    Off, the same shield in greys, so a switched-off Bot Guard looks asleep."""
    w, h = 40, 44
    ring = (rgb("5c6375"), rgb("3a3f4c")) if off else (AQUA, PINK)
    face, eye, tip = (rgb("6b7285"), rgb("2a2e38"), rgb("4a5060")) if off else (WHITE, AQUA, PINK)

    def draw(img, d, s):
        W, H = img.size
        outer = shield_points(W, H, inset=s * 0.5)
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).polygon(outer, fill=255)
        img.paste(vertical_gradient(W, H, *ring), (0, 0), mask)
        d.polygon(shield_points(W, H, inset=s * 3), fill=DARK)
        robot(d, W / 2, H * 0.47, W * 0.46, face, eye, tip)

    return smooth(w, h, draw, "guard_shield_off" if off else "guard_shield")


def guard_banner():
    """The banner behind Bot Guard's status: faintly aqua at the shield's end, plain dark at the other."""
    return gradient(blend(TILE, AQUA, 0.12), TILE, "guard_banner", 64, 1)


def guard_glow():
    """A soft aqua glow behind the shield, to pulse."""
    w = h = 64
    img = Image.new("RGBA", (w, h), CLEAR)
    mid = (w - 1) / 2
    for x in range(w):
        for y in range(h):
            d = ((x - mid) ** 2 + (y - mid) ** 2) ** 0.5 / mid
            if d < 1:
                img.putpixel((x, y), AQUA[:3] + (round(150 * (1 - d) ** 2),))
    return save(img, "guard_glow")


def guard_scan():
    """The scanning line that sweeps the banner: aqua with a white core, fading to nothing at its sides."""
    w, h = 16, 64
    img = Image.new("RGBA", (w, h), CLEAR)
    mid = (w - 1) / 2
    for x in range(w):
        t = 1 - abs(x - mid) / mid
        colour = blend(AQUA, WHITE, max(0, t - 0.6) / 0.4)
        for y in range(h):
            fade = min(1, min(y, h - 1 - y) / 8)
            img.putpixel((x, y), colour[:3] + (round(200 * t ** 2 * fade),))
    return save(img, "guard_scan")


def guard_icon_moderation():
    """Bot Moderation's card: three sliders, aqua, pink and gold knobs."""
    w = h = 32

    def draw(img, d, s):
        for i, (at, knob) in enumerate([(0.32, AQUA), (0.7, PINK), (0.48, GOLD)]):
            y = (8 + i * 8) * s
            d.rounded_rectangle([4 * s, y - s, 28 * s, y + s], radius=s, fill=STEEL)
            x = (4 + 24 * at) * s
            d.ellipse([x - 3.2 * s, y - 3.2 * s, x + 3.2 * s, y + 3.2 * s], fill=knob)

    return smooth(w, h, draw, "guard_moderation", out=(56, 56))


def guard_icon_detected():
    """Detected Bots' card: a robot with red eyes and a red alert dot."""
    w = h = 32

    def draw(img, d, s):
        robot(d, 15 * s, 18 * s, 20 * s, WHITE, RED, STEEL)
        d.ellipse([22 * s, 3 * s, 30 * s, 11 * s], fill=RED)
        d.rounded_rectangle([25.4 * s, 4.6 * s, 26.6 * s, 8 * s], radius=0.5 * s, fill=WHITE)
        d.ellipse([25.4 * s, 8.6 * s, 26.6 * s, 9.8 * s], fill=WHITE)

    return smooth(w, h, draw, "guard_detected", out=(56, 56))


# ------------------------------------------------------------- Automod
# Automod's own look (3.1.9, the user: "i want a redo for /automod just like
# bot guard got"). Drawn the same smooth way as Bot Guard's, with its own
# emblem: an eye that watches, in a ring of the Admin+ colours.

def lens_points(cx, cy, half_w, half_h, n=24):
    """An almond: two arcs that meet at points left and right."""
    top = [(cx - half_w + 2 * half_w * i / n, cy - half_h * math.sin(math.pi * i / n)) for i in range(n + 1)]
    bottom = [(cx + half_w - 2 * half_w * i / n, cy + half_h * math.sin(math.pi * i / n)) for i in range(1, n)]
    return top + bottom


def automod_eye(off=False):
    """The emblem: a ring aqua to pink round a dark disc, an open eye inside
    with an aqua iris. Off, the ring is grey and the eye is shut, so a
    switched-off Automod looks asleep."""
    w = h = 44
    ring = (rgb("5c6375"), rgb("3a3f4c")) if off else (AQUA, PINK)

    def draw(img, d, s):
        W, H = img.size
        cx, cy = W / 2, H / 2
        r = min(W, H) / 2 - s * 0.5
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        img.paste(vertical_gradient(W, H, *ring), (0, 0), mask)
        inner = r - s * 3
        d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=DARK)
        half_w, half_h = inner * 0.72, inner * 0.42
        if off:
            # A shut eye: the lower lid's curve, and three short lashes under it.
            lid = [(cx - half_w + 2 * half_w * i / 24, cy + half_h * 0.35 * math.sin(math.pi * i / 24)) for i in range(25)]
            d.line(lid, fill=rgb("6b7285"), width=max(1, round(s * 1.6)), joint="curve")
            for dx in (-0.45, 0, 0.45):
                x = cx + half_w * dx
                y = cy + half_h * 0.35 * math.sin(math.pi * (0.5 + dx / 2))
                d.line([(x, y), (x + dx * s * 1.5, y + s * 2.2)], fill=rgb("6b7285"), width=max(1, round(s * 1.2)))
            return
        d.polygon(lens_points(cx, cy, half_w, half_h), fill=WHITE)
        iris = half_h * 0.92
        d.ellipse([cx - iris, cy - iris, cx + iris, cy + iris], fill=AQUA)
        pupil = iris * 0.48
        d.ellipse([cx - pupil, cy - pupil, cx + pupil, cy + pupil], fill=DARK)
        shine = iris * 0.22
        sx, sy = cx + iris * 0.38, cy - iris * 0.38
        d.ellipse([sx - shine, sy - shine, sx + shine, sy + shine], fill=WHITE)

    return smooth(w, h, draw, "automod_eye_off" if off else "automod_eye")


def automod_banner():
    """The banner behind Automod's status: faintly violet at the eye's end, plain dark at the other."""
    return gradient(blend(TILE, PURPLE, 0.14), TILE, "automod_banner", 64, 1)


def automod_glow():
    """A soft violet glow behind the eye, to pulse."""
    w = h = 64
    img = Image.new("RGBA", (w, h), CLEAR)
    mid = (w - 1) / 2
    for x in range(w):
        for y in range(h):
            d = ((x - mid) ** 2 + (y - mid) ** 2) ** 0.5 / mid
            if d < 1:
                img.putpixel((x, y), PURPLE[:3] + (round(150 * (1 - d) ** 2),))
    return save(img, "automod_glow")


def automod_sweep():
    """The light that sweeps the banner: a soft pink band with a white core, fading at its sides and ends."""
    w, h = 24, 64
    img = Image.new("RGBA", (w, h), CLEAR)
    mid = (w - 1) / 2
    for x in range(w):
        t = 1 - abs(x - mid) / mid
        colour = blend(PINK, WHITE, max(0, t - 0.7) / 0.3)
        for y in range(h):
            fade = min(1, min(y, h - 1 - y) / 10)
            img.putpixel((x, y), colour[:3] + (round(120 * t ** 2 * fade),))
    return save(img, "automod_sweep")


def automod_icon_bots():
    """Bot Guard's card: its shield, ringed aqua to pink, with the robot inside."""
    w = h = 32

    def draw(img, d, s):
        W, H = img.size
        sw, sh = 26 * s, 29 * s
        ox, oy = (W - sw) / 2, (H - sh) / 2
        outer = [(ox + x, oy + y) for x, y in shield_points(sw, sh, inset=s * 0.5)]
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).polygon(outer, fill=255)
        img.paste(vertical_gradient(W, H, AQUA, PINK), (0, 0), mask)
        d.polygon([(ox + x, oy + y) for x, y in shield_points(sw, sh, inset=s * 2.4)], fill=DARK)
        robot(d, W / 2, oy + sh * 0.47, sw * 0.46, WHITE, AQUA, PINK)

    return smooth(w, h, draw, "automod_bots", out=(56, 56))


def automod_icon_chat():
    """Chat Moderation's card: a speech bubble with three dots, aqua, pink and gold."""
    w = h = 32

    def draw(img, d, s):
        d.rounded_rectangle([3 * s, 5 * s, 29 * s, 22 * s], radius=6 * s, fill=WHITE)
        d.polygon([(8 * s, 21 * s), (8 * s, 28 * s), (15 * s, 21 * s)], fill=WHITE)
        for i, colour in enumerate([AQUA, PINK, GOLD]):
            x = (10 + i * 6) * s
            d.ellipse([x - 2.2 * s, 13.5 * s - 2.2 * s, x + 2.2 * s, 13.5 * s + 2.2 * s], fill=colour)

    return smooth(w, h, draw, "automod_chat", out=(56, 56))


# ------------------------------------------------------- Chat Moderation
# Chat Moderation's own look (3.1.9, the user: "everything in and past
# /automod should be enhanced to the fullest with simple and cleanness").
# The same family: a ring round a dark disc, a speech bubble inside.

def chat_bubble(off=False):
    """The emblem: a ring aqua to pink, a white speech bubble with three
    coloured dots. Off, greys and a flat line, so a switched-off Chat
    Moderation looks quiet."""
    w = h = 44
    ring = (rgb("5c6375"), rgb("3a3f4c")) if off else (AQUA, PINK)

    def draw(img, d, s):
        W, H = img.size
        cx, cy = W / 2, H / 2
        r = min(W, H) / 2 - s * 0.5
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        img.paste(vertical_gradient(W, H, *ring), (0, 0), mask)
        inner = r - s * 3
        d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=DARK)
        bw, bh = inner * 1.15, inner * 0.78
        top = cy - bh * 0.62
        face = rgb("6b7285") if off else WHITE
        d.rounded_rectangle([cx - bw / 2, top, cx + bw / 2, top + bh], radius=bh * 0.38, fill=face)
        d.polygon([(cx - bw * 0.28, top + bh - s), (cx - bw * 0.30, top + bh + bh * 0.42), (cx - bw * 0.02, top + bh - s)], fill=face)
        mid = top + bh / 2
        if off:
            d.rounded_rectangle([cx - bw * 0.26, mid - s * 0.9, cx + bw * 0.26, mid + s * 0.9], radius=s * 0.9, fill=rgb("3a3f4c"))
            return
        dot = bh * 0.15
        for i, colour in enumerate([AQUA, PINK, GOLD]):
            x = cx + (i - 1) * bw * 0.26
            d.ellipse([x - dot, mid - dot, x + dot, mid + dot], fill=colour)

    return smooth(w, h, draw, "chat_bubble_off" if off else "chat_bubble")


def chat_banner():
    """The banner behind Chat Moderation's status: faintly pink at the bubble's end, plain dark at the other."""
    return gradient(blend(TILE, PINK, 0.12), TILE, "chat_banner", 64, 1)


def chat_glow():
    """A soft pink glow behind the bubble, to pulse."""
    w = h = 64
    img = Image.new("RGBA", (w, h), CLEAR)
    mid = (w - 1) / 2
    for x in range(w):
        for y in range(h):
            d = ((x - mid) ** 2 + (y - mid) ** 2) ** 0.5 / mid
            if d < 1:
                img.putpixel((x, y), PINK[:3] + (round(140 * (1 - d) ** 2),))
    return save(img, "chat_glow")


def chat_icon_test():
    """Test a message's card: a magnifying glass over a line of chat."""
    w = h = 32

    def draw(img, d, s):
        for i, width in enumerate([18, 12]):
            y = (21 + i * 5) * s
            d.rounded_rectangle([3 * s, y - s, (3 + width) * s, y + s], radius=s, fill=STEEL)
        cx, cy, r = 19 * s, 12 * s, 7.5 * s
        d.line([(cx + r * 0.7, cy + r * 0.7), (29 * s, 26 * s)], fill=WHITE, width=round(3.2 * s))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=AQUA)
        d.ellipse([cx - r + 2.4 * s, cy - r + 2.4 * s, cx + r - 2.4 * s, cy + r - 2.4 * s], fill=DARK)
        d.ellipse([cx - 3.4 * s, cy - 3.6 * s, cx - 1.2 * s, cy - 1.4 * s], fill=WHITE)

    return smooth(w, h, draw, "chat_test", out=(56, 56))


def chat_icon_held():
    """Held messages' card: an hourglass, gold, with pink sand: they wait for staff."""
    w = h = 32

    def draw(img, d, s):
        d.rounded_rectangle([7 * s, 3 * s, 25 * s, 6 * s], radius=1.2 * s, fill=GOLD)
        d.rounded_rectangle([7 * s, 26 * s, 25 * s, 29 * s], radius=1.2 * s, fill=GOLD)
        glass = [(9 * s, 6 * s), (23 * s, 6 * s), (17.2 * s, 16 * s), (23 * s, 26 * s), (9 * s, 26 * s), (14.8 * s, 16 * s)]
        d.polygon(glass, fill=WHITE)
        d.polygon([(11.5 * s, 8.5 * s), (20.5 * s, 8.5 * s), (16 * s, 14.5 * s)], fill=PINK)
        d.polygon([(16 * s, 19 * s), (21.5 * s, 24.5 * s), (10.5 * s, 24.5 * s)], fill=PINK)

    return smooth(w, h, draw, "chat_held", out=(56, 56))


def main():
    made = [
        flat(rgb("ffffff"), "white"),
        flat(TILE, "tile"),
        flat(TILE_HOVER, "tile_hover"),
        flat(TILE_PRESSED, "tile_pressed"),
        gradient(AQUA, PINK, "gradient", 128, 1),
        gradient(PANEL_TOP, PANEL_BOTTOM, "panel", 4, 64, horizontal=False),
    ]
    for key, (icon, stripe) in TILES.items():
        made.append(tile_texture(key, icon, stripe))
    for key, colour in STRIPES.items():
        made.append(flat(rgb(colour), f"stripe_{key}"))
    for key, (icon, colour) in LOG_ICONS.items():
        made.append(log_dot(key, icon, colour))
    made.append(flow_texture())
    made += [guard_shield(), guard_shield(off=True), guard_banner(), guard_glow(), guard_scan(),
             guard_icon_moderation(), guard_icon_detected()]
    made += [automod_eye(), automod_eye(off=True), automod_banner(), automod_glow(), automod_sweep(),
             automod_icon_bots(), automod_icon_chat()]
    made += [chat_bubble(), chat_bubble(off=True), chat_banner(), chat_glow(), chat_icon_test(), chat_icon_held()]
    print(f"{len(made)} textures in {OUT}")
    for name in made:
        print(f"  {name}.png")


if __name__ == "__main__":
    main()
