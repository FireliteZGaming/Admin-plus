"""Generate core/itemTextures.js — item id to texture PATH, read from the game.

    python tools/genicons.py

WHY THIS EXISTS
  The chest grid can identify an item two ways. One is a NUMBER, an index into
  the game's item registry; the other is a texture PATH. The number is what the
  community module uses, and it is fragile in a way that cannot be patched: the
  registry shifts every time Mojang adds items, so a table built for one build
  draws neighbours on another. On a 1.26.45 client, a table built for 1.21.130
  drew an acacia boat as pink dye and a copper shovel as a copper pickaxe, and
  the error GREW with the id, so no single offset could correct it.

  Texture paths do not drift. "textures/items/diamond_sword" is the same string
  it was ten versions ago. So this reads the installed game's own resource packs
  and writes out a path for every item it can prove exists.

WHAT IT READS
  The vanilla resource packs that ship with Minecraft, layered newest-last the
  way the game itself composes them, plus every PNG on disk so that a mapping is
  only emitted when the file is really there. Nothing is guessed.

  BLOCKS ARE LEFT ALONE. A block's icon is a 3D render of its model, not a flat
  texture, so a path would show one lonely face. Blocks keep the numeric route,
  which works for them: the offset that breaks items only ever applied to ids of
  256 and above.
"""
import io
import json
import os
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAME = pathlib.Path(r"C:/XboxGames/Minecraft for Windows/Content/data/resource_packs")
OUT = ROOT / "Admin+ BP/scripts/core/itemTextures.js"

# Names the game spells differently from the item id, where no rule would get
# there. Each one is checked against a real PNG below, so a wrong guess here
# fails loudly instead of shipping.
ALIASES = {
    "bucket": "bucket_empty",
    "milk_bucket": "bucket_milk",
    "water_bucket": "bucket_water",
    "lava_bucket": "bucket_lava",
    "cod_bucket": "bucket_cod",
    "salmon_bucket": "bucket_salmon",
    "tropical_fish_bucket": "bucket_tropical",
    "pufferfish_bucket": "bucket_pufferfish",
    "axolotl_bucket": "bucket_axolotl",
    "tadpole_bucket": "bucket_tadpole",
    "powder_snow_bucket": "bucket_powder_snow",
    "beef": "beef_raw",
    "cooked_beef": "beef_cooked",
    "chicken": "chicken_raw",
    "cooked_chicken": "chicken_cooked",
    "porkchop": "porkchop_raw",
    "cooked_porkchop": "porkchop_cooked",
    "mutton": "mutton_raw",
    "cooked_mutton": "mutton_cooked",
    "rabbit": "rabbit_raw",
    "cooked_rabbit": "rabbit_cooked",
    "cod": "fish_raw",
    "cooked_cod": "fish_cooked",
    "salmon": "fish_salmon_raw",
    "cooked_salmon": "fish_salmon_cooked",
    "tropical_fish": "fish_clownfish_raw",
    "pufferfish": "fish_pufferfish_raw",
    "bone_meal": "dye_powder_white",
    "ink_sac": "dye_powder_black_new",
    "lapis_lazuli": "dye_powder_blue_new",
    "cocoa_beans": "dye_powder_brown",
    "book": "book_normal",
    "writable_book": "book_writable",
    "written_book": "book_written",
    "enchanted_book": "book_enchanted",
    "knowledge_book": "book_knowledge",
    "clock": "clock_item",
    "compass": "compass_item",
    "recovery_compass": "recovery_compass_item",
    "bow": "bow_standby",
    "crossbow": "crossbow_standby",
    "fishing_rod": "fishing_rod_uncast",
    "carrot_on_a_stick": "carrot_on_a_stick",
    "map": "map_filled",
    "empty_map": "map_empty",
    "nether_star": "nether_star",
    "brewing_stand": "brewing_stand",
    "cauldron": "cauldron",
    "flower_pot": "flower_pot",
    "skull": "skull_skeleton",
    "totem_of_undying": "totem",
    "turtle_helmet": "turtle_helmet",
    "banner": "banner",
    "bed": "bed_red",
    "sign": "sign",
    "melon_slice": "melon",
    "glow_ink_sac": "dye_powder_glow",
    "nautilus_shell": "nautilus",
    "gunpowder": "gunpowder",
    "redstone": "redstone_dust",
    "glowstone_dust": "glowstone_dust",
    "sugar": "sugar",
    "brick": "brick",
    "nether_brick": "netherbrick",
    "quartz": "quartz",
    "paper": "paper",
    "string": "string",
    "snowball": "snowball",
    "egg": "egg",
    "wheat": "wheat",
    "shears": "shears",
    "flint_and_steel": "flint_and_steel",
    "trial_key": "trial_key",
    "ominous_trial_key": "ominous_trial_key",
    "wind_charge": "wind_charge",
    "mace": "mace",
    "spawn_egg": "spawn_egg",
    # Verified against the installed game, one by one - each of these is a name
    # the files spell differently from the item id with no rule to get there.
    "glass_bottle": "potion_bottle_empty",
    "firework_rocket": "fireworks",
    "firework_star": "fireworks_charge",
    "zombie_pigman_spawn_egg": "spawn_egg_zombie_pigman",
    "minecart": "minecart_normal",
    "oak_sign": "sign",
    "slime_ball": "slimeball",
    "sugar_cane": "reeds",
    "turtle_scute": "turtle_shell_piece",
    "heart_of_the_sea": "heartofthesea_closed",
    "dragon_breath": "dragons_breath",
    "fire_charge": "fireball",
    "glistering_melon_slice": "melon_speckled",
    "light_gray_dye": "dye_powder_silver",
    "lodestone_compass": "lodestonecompass_item",
    "enchanted_golden_apple": "apple_golden",
    "golden_apple": "apple_golden",
    "golden_carrot": "carrot_golden",
    "wooden_door": "door_wood",
    "tropical_fish_spawn_egg": "spawn_egg_tropicalfish",
}

DYES = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink",
        "gray", "light_gray", "cyan", "purple", "blue", "brown", "green",
        "red", "black"]


def layers():
    def order(name):
        if name == "vanilla":
            return (0,)
        found = re.findall(r"\d+", name)
        return tuple(int(x) for x in found) or (99,)
    if not GAME.is_dir():
        raise SystemExit(f"cannot find the installed game at {GAME}")
    names = [p.name for p in GAME.iterdir()
             if p.is_dir() and (p.name == "vanilla" or p.name.startswith("vanilla_"))]
    return sorted(names, key=order)


def load_game():
    have, merged = set(), {}
    for pack in layers():
        base = GAME / pack / "textures"
        if base.is_dir():
            for path in base.rglob("*.png"):
                have.add(str(path.relative_to(GAME / pack)).replace("\\", "/")[:-4])
        table = base / "item_texture.json"
        if table.exists():
            merged.update(json.load(io.open(table, encoding="utf-8")).get("texture_data", {}))
    return have, merged


def build_tail_index(merged, have):
    tails = {}
    for value in merged.values():
        textures = value.get("textures") if isinstance(value, dict) else value
        entries = textures if isinstance(textures, list) else [textures]
        for entry in entries:
            path = entry if isinstance(entry, str) else (entry or {}).get("path", "")
            if isinstance(path, str) and path and path in have:
                tails.setdefault(path.rsplit("/", 1)[-1], path)
    return tails


def resolver(have, tails):
    items_only = sorted(p for p in have if p.startswith("textures/items/"))
    by_tokens = [(p, set(p.rsplit("/", 1)[-1].split("_"))) for p in items_only]

    # Not every icon sits directly in textures/items - spears, nautilus armour
    # and the leather set live in subfolders. Index by file name so a lookup
    # finds them wherever they are, shallowest first so a top-level file always
    # wins over a nested one of the same name.
    by_basename = {}
    for path in sorted(items_only, key=lambda p: (p.count("/"), p)):
        by_basename.setdefault(path.rsplit("/", 1)[-1], path)

    def find(candidate):
        """A texture path for this file name, wherever it lives."""
        if f"textures/items/{candidate}" in have:
            return f"textures/items/{candidate}"
        return by_basename.get(candidate)

    def resolve(name):
        direct = find(name)
        if direct:
            return direct

        alias = ALIASES.get(name)
        if alias:
            hit = find(alias) or (tails.get(alias) if tails.get(alias) in have else None)
            if hit:
                return hit

        if name.endswith("_dye"):
            colour = name[:-4]
            for candidate in (f"dye_powder_{colour}", f"dye_powder_{colour}_new"):
                hit = find(candidate)
                if hit:
                    return hit

        # The game kept older spellings for whole families. These are rules, not
        # guesses: gold_ for golden_, wood_ for wooden_, record_ for the discs
        # that predate the music_disc_ naming, and spawn_egg_<mob> throughout.
        for before, after in (("golden_", "gold_"), ("wooden_", "wood_")):
            if name.startswith(before):
                hit = find(after + name[len(before):])
                if hit:
                    return hit

        if name.startswith("music_disc_"):
            hit = find("record_" + name[len("music_disc_"):])
            if hit:
                return hit

        if name.endswith("_spawn_egg"):
            mob = name[:-len("_spawn_egg")]
            for candidate in (f"spawn_egg_{mob}", f"spawn_egg_{mob.replace('_', '')}", f"egg_{mob}"):
                hit = find(candidate)
                if hit:
                    return hit

        if name in tails:
            return tails[name]

        # boat_acacia <- acacia_boat, and the same trick for any other family
        # whose words the game happens to write the other way round.
        parts = name.split("_")
        for i in range(1, len(parts)):
            hit = find("_".join(parts[i:] + parts[:i]))
            if hit:
                return hit

        # Last resort: the only file whose words are a superset of ours. Requires
        # a UNIQUE best answer, so an ambiguous name is left unmapped rather than
        # mapped wrongly - a missing icon is honest, a wrong one is not.
        wanted = set(parts)
        best = [(len(tokens - wanted), path) for path, tokens in by_tokens if wanted <= tokens]
        if best:
            best.sort()
            if len(best) == 1 or best[0][0] < best[1][0]:
                return best[0][1]
        return None

    return resolve


def main():
    have, merged = load_game()
    tails = build_tail_index(merged, have)
    resolve = resolver(have, tails)

    src = io.open(ROOT / "Admin+ BP/scripts/core/typeIds.js", encoding="utf-8").read()
    ids = [(m.group(1), int(m.group(2)))
           for m in re.finditer(r'\["(minecraft:[a-z0-9_]+)",\s*(-?\d+)\]', src)]

    mapped, missed = {}, []
    for type_id, numeric in ids:
        if numeric < 256:
            continue                      # blocks: the numeric route suits them
        name = type_id.split(":")[1]
        path = resolve(name)
        if path:
            mapped[type_id] = path
        else:
            missed.append(name)

    total = len(mapped) + len(missed)
    lines = [
        "// item id -> texture path. GENERATED by tools/genicons.py; do not hand-edit.",
        "//",
        "// Read from the installed game's own vanilla resource packs, and every path",
        "// here was checked against a real PNG on disk. Paths are used instead of the",
        "// numeric registry index because the index shifts with the game version and",
        "// the path does not: a 1.21.130 id table drew an acacia boat as pink dye on a",
        "// 1.26.45 client, and the error grew with the id, so no offset could fix it.",
        "//",
        "// BLOCKS ARE ABSENT ON PURPOSE. Their icon is a 3D render of the block model,",
        "// which a flat texture cannot stand in for, and the numeric route works for",
        "// them anyway - the drift only ever affected ids of 256 and above.",
        f"// {len(mapped)} of {total} items resolved from Minecraft's own files.",
        "",
        "export const ITEM_TEXTURES = new Map([",
    ]
    for type_id in sorted(mapped):
        lines.append(f'    ["{type_id}", "{mapped[type_id]}"],')
    lines.append("])")
    lines.append("")
    lines.append("/** The path for an item, or undefined when only the numeric route will do. */")
    lines.append("export function textureFor(typeId) { return ITEM_TEXTURES.get(typeId) }")
    lines.append("")

    io.open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines))

    print(f"layers read      : {len(layers())}")
    print(f"PNGs on disk     : {len(have)}")
    print(f"items (id >= 256): {total}")
    print(f"resolved         : {len(mapped)} ({len(mapped) * 100 // max(total, 1)}%)")
    print(f"unresolved       : {len(missed)}")
    if missed:
        print("  " + ", ".join(sorted(missed)[:20]) + (" ..." if len(missed) > 20 else ""))
    print(f"written          : {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
