"""Draw the textures for Admin+'s own look (the Beta UI, 2.11.0).

    python tools/genlook.py

Writes PNGs into Admin+ RP/textures/ui/adminplus/. Everything here is drawn
from scratch: flat colours, two gradients, and 8x8 pixel icons taken from the
concept the user approved on 2026-11-13 ("Yes the UI is perfect"). No game
texture is copied. Run it again after changing a colour or an icon; the output
is the same every time.

The colours are the concept's (Obsidian > Admin+ > UI Overhaul).
"""
import pathlib
from PIL import Image

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
}

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
    print(f"{len(made)} textures in {OUT}")
    for name in made:
        print(f"  {name}.png")


if __name__ == "__main__":
    main()
