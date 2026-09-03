"""Build the MCPEDL / CurseForge listing thumbnail.

The problem it solves: in a grid of cards, the pack icon alone says nothing.
Every competing listing shouts its name in huge type, and a dark shield on a
dark card reads as "some addon". This puts the NAME and the ONE-LINE PITCH on
the image at a size that survives being shrunk to a thumbnail.

Deliberately not shouting back. The neighbours are loud and most of them look
cheap; the way to stand out in that row is to be the one that looks like a
finished product and can still be read at 270px wide.

ONE PIL TRAP, PAID FOR ONCE: ImageDraw with an RGBA fill drawn straight onto an
RGBA image REPLACES those pixels, alpha and all - it does not blend. A fill of
(232,169,61,26) meant as a faint tint came out a solid gold slab that buried the
text on top of it. Every translucent shape here is drawn on its own layer and
alpha_composited in. Opaque text is drawn directly, which is fine.
"""
import pathlib
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = pathlib.Path(r"c:\Users\gabri\OneDrive\Desktop\Side Projects\Minecraft Mods\Admin+\releases")
LOGO = pathlib.Path(r"c:\Users\gabri\OneDrive\Desktop\Side Projects\Minecraft Mods\Admin+\Admin+ BP\pack_icon.png")

W, H = 1280, 720

# The pack's own colours: §b aqua and §d light purple, the two it writes its
# name in. Everything else is a neutral built from them so nothing clashes.
AQUA = (86, 214, 222)
VIOLET = (200, 140, 255)
GOLD = (232, 169, 61)
INK = (243, 241, 250)
MUTED = (176, 171, 200)
BG_TOP = (20, 19, 32)
BG_BOT = (10, 10, 18)

F_BLACK = "C:/Windows/Fonts/seguibl.ttf"    # Segoe UI Black - the wordmark
F_BOLD = "C:/Windows/Fonts/segoeuib.ttf"    # Segoe UI Bold  - supporting text

MARGIN = 56


def font(path, size):
    return ImageFont.truetype(path, size)


def gradient(w, h, top, bottom):
    base = Image.new("RGB", (1, h))
    px = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return base.resize((w, h))


def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def glow(img, centre, colour, radius, alpha):
    """A soft coloured light, for depth. Composited, never drawn in place."""
    lay = layer()
    d = ImageDraw.Draw(lay)
    x, y = centre
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=colour + (alpha,))
    return Image.alpha_composite(img, lay.filter(ImageFilter.GaussianBlur(radius * 0.55)))


def width_of(draw, s, f):
    box = draw.textbbox((0, 0), s, font=f)
    return box[2] - box[0]


def shadowed(d, xy, s, f, fill, offset=3, shadow=(0, 0, 0, 170)):
    d.text((xy[0] + offset, xy[1] + offset), s, font=f, fill=shadow)
    d.text(xy, s, font=f, fill=fill)


def build():
    img = gradient(W, H, BG_TOP, BG_BOT).convert("RGBA")
    img = glow(img, (330, 300), AQUA, 300, 60)
    img = glow(img, (980, 470), VIOLET, 340, 45)

    # ---- every translucent shape, on one layer -------------------------
    lay = layer()
    ld = ImageDraw.Draw(lay)
    ld.rectangle([14, 14, W - 15, H - 15], outline=(255, 255, 255, 30), width=2)

    x = 560
    right = W - MARGIN

    # Chips: measured first, and trimmed until the row actually fits. A label
    # sliced in half by the canvas edge is worse than one fewer label.
    f_chip = font(F_BOLD, 28)
    chips = ["RANKS", "MODERATION", "WARPS", "TPA", "CHAT"]
    pad, gap = 15, 14

    def row_width(items):
        return sum(width_of(ld, c, f_chip) + pad * 2 for c in items) + gap * (len(items) - 1)

    while len(chips) > 2 and x + row_width(chips) > right:
        chips.pop()

    cx = x
    boxes = []
    for label in chips:
        w = width_of(ld, label, f_chip) + pad * 2
        ld.rounded_rectangle([cx, 438, cx + w, 492], radius=27,
                             fill=(255, 255, 255, 20), outline=(255, 255, 255, 55))
        boxes.append((cx + pad, label))
        cx += w + gap

    # The hook: the one sentence separating this from every other "essentials"
    # pack in the row. Sized to its own text rather than a guessed width.
    f_hook = font(F_BOLD, 38)
    hook = "No operator needed"
    hw = width_of(ld, hook, f_hook)
    ld.rounded_rectangle([x, 538, x + hw + 52, 606], radius=12,
                         fill=GOLD + (30,), outline=GOLD + (150,), width=2)

    img = Image.alpha_composite(img, lay)

    # ---- the shield, left ----------------------------------------------
    logo = Image.open(LOGO).convert("RGBA").resize((430, 430), Image.LANCZOS)
    shadow = layer()
    shadow.paste(logo, (95, 155), logo)
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(26)))
    img.paste(logo, (80, 140), logo)

    # ---- opaque text, drawn straight on ---------------------------------
    d = ImageDraw.Draw(img)

    # "Admin" aqua, "+" violet: exactly how the pack writes its own name in
    # chat, so the image and the game agree.
    f_mark = font(F_BLACK, 168)
    shadowed(d, (x, 170), "Admin", f_mark, AQUA)
    shadowed(d, (x + width_of(d, "Admin", f_mark), 170), "+", f_mark, VIOLET)

    f_line = font(F_BOLD, 46)
    shadowed(d, (x, 362), "The admin toolkit for Bedrock", f_line, INK, offset=2)

    for cx, label in boxes:
        d.text((cx, 450), label, font=f_chip, fill=MUTED)

    d.text((x + 26, 550), hook, font=f_hook, fill=GOLD)

    out = OUT / "MCPEDL.png"
    img.convert("RGB").save(out, "PNG", optimize=True)
    print(f"wrote {out}")
    print(f"  {img.size[0]}x{img.size[1]}  {out.stat().st_size // 1024} KB  chips kept: {len(chips)}")


if __name__ == "__main__":
    build()
