"""Write Admin+'s disguises (2.12.8, Beta): one harmless entity per mob that looks
like the game's own, for /disguise.

    python tools/gendisguise.py            write the files
    python tools/gendisguise.py --report   say what each look keeps and drops

The user, 2026-11-14: "add a /disguise that lets you disguise as anything.
Sorta like a morph mod ... skip flying mobs."

Why a separate entity and not the real mob: a script can't switch a vanilla
mob's AI off. A real creeper beside players hisses and explodes, a skeleton
shoots, a zombie burns at noon and none of them exist on Peaceful. So each
disguise is Admin+'s own entity with no AI that can't be hurt, and the script
moves it along with the player (features/disguise.js).

How it looks like the mob: its look file points at the game's own model,
textures, materials, animations and render controllers BY NAME, read here out
of the installed game's vanilla packs (the way tools/genicons.py reads texture
paths). No model, texture or animation file of Mojang's is copied. What the
look file does carry are the short formulas (molang) that feed those
animations, because they only work with them.

What changes from the game's own look, and why:
  1. The identifier is adminplus:disguise_<mob>.
  2. A minecraft:* entity property (a pig's climate, an armadillo rolled up)
     can't exist on a custom entity, so in the look's own formulas it reads as
     that mob's default ("temperate", "unrolled"), from the game's behaviour
     files. The game's own animation files can't be changed, so one that reads
     such a property is left out, and a mob whose render controller reads one
     uses the plain look (controller.render.adminplus_disguise).
  3. Variables the game fills in for its own mobs (attack_time, swim_amount
     and the like) start at resting values: reading one that was never set is
     an error, and the animation it feeds would stop.
  4. An animation the game no longer ships is left out.
  5. (2.12.9) A geometry a disguise never draws (a baby, a sheared sheep, a
     cow's warm and cold coats) points at the default one, and three looks
     get the extra names the game asks for. Both come from the content log
     of the first world that loaded these files (2026-11-14, game 1.26.63);
     see NEVER_DRAWN and GAME_ASKS_FOR below.

The entity has gravity and collision, with a hitbox too small to snag on
anything, so the game itself knows when it stands on the ground: rabbits,
foxes, axolotls and turtles check that inside the game's own animation files,
which can't be changed.

Run it after a game update, as with genicons.py. The output is committed, so a
machine without the game can still build the pack.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from vanillaui import entries  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
BP = ROOT / "Admin+ BP"
RP = ROOT / "Admin+ RP"
GAME_RP = pathlib.Path(r"C:/XboxGames/Minecraft for Windows/Content/data/resource_packs")
GAME_BP = pathlib.Path(r"C:/XboxGames/Minecraft for Windows/Content/data/behavior_packs")

PREFIX = "adminplus:disguise_"
SIMPLE_RENDER = "controller.render.adminplus_disguise"

# Every mob that walks or swims. Flying mobs are left out, as the user asked
# ("Phantoms would be interesting since it requires a flying thing so skip
# flying mobs"): allay, bat, bee, blaze, ender dragon, ghast, happy ghast,
# parrot, phantom, vex and wither. So are things that aren't creatures (armour
# stand, agent, NPC) and the shulker, which never moves.
#
# (our id, the game's look, the name players read, scale)
MOBS = [
    ("armadillo", "armadillo", "Armadillo", 1),
    ("axolotl", "axolotl", "Axolotl", 1),
    ("bogged", "bogged", "Bogged", 1),
    ("breeze", "breeze", "Breeze", 1),
    ("camel", "camel", "Camel", 1),
    ("camel_husk", "camel_husk", "Camel Husk", 1),
    ("cat", "cat", "Cat", 1),
    ("cave_spider", "cave_spider", "Cave Spider", 1),
    ("chicken", "chicken", "Chicken", 1),
    ("copper_golem", "copper_golem", "Copper Golem", 1),
    ("cow", "cow", "Cow", 1),
    ("creaking", "creaking", "Creaking", 1),
    ("creeper", "creeper", "Creeper", 1),
    ("donkey", "donkey", "Donkey", 1),
    ("drowned", "drowned", "Drowned", 1),
    ("enderman", "enderman", "Enderman", 1),
    ("endermite", "endermite", "Endermite", 1),
    ("evoker", "evocation_illager", "Evoker", 1),
    ("fox", "fox", "Fox", 1),
    ("frog", "frog", "Frog", 1),
    ("goat", "goat", "Goat", 1),
    ("hoglin", "hoglin", "Hoglin", 1),
    ("horse", "horse", "Horse", 1),
    ("husk", "husk", "Husk", 1),
    ("iron_golem", "iron_golem", "Iron Golem", 1),
    ("llama", "llama", "Llama", 1),
    ("magma_cube", "magma_cube", "Magma Cube", 2),
    ("mooshroom", "mooshroom", "Mooshroom", 1),
    ("mule", "mule", "Mule", 1),
    ("ocelot", "ocelot", "Ocelot", 1),
    ("panda", "panda", "Panda", 1),
    ("parched", "parched", "Parched", 1),
    ("pig", "pig", "Pig", 1),
    ("piglin", "piglin", "Piglin", 1),
    ("piglin_brute", "piglin_brute", "Piglin Brute", 1),
    ("pillager", "pillager", "Pillager", 1),
    ("polar_bear", "polar_bear", "Polar Bear", 1),
    ("rabbit", "rabbit", "Rabbit", 1),
    ("ravager", "ravager", "Ravager", 1),
    ("sheep", "sheep", "Sheep", 1),
    ("silverfish", "silverfish", "Silverfish", 1),
    ("skeleton", "skeleton", "Skeleton", 1),
    ("skeleton_horse", "skeleton_horse", "Skeleton Horse", 1),
    ("slime", "slime", "Slime", 2),
    ("sniffer", "sniffer", "Sniffer", 1),
    ("snow_golem", "snow_golem", "Snow Golem", 1),
    ("spider", "spider", "Spider", 1),
    ("stray", "stray", "Stray", 1),
    ("strider", "strider", "Strider", 1),
    ("sulfur_cube", "sulfur_cube", "Sulfur Cube", 1),
    ("trader_llama", "trader_llama", "Trader Llama", 1),
    ("turtle", "turtle", "Turtle", 1),
    ("villager", "villager_v2", "Villager", 1),
    ("vindicator", "vindicator", "Vindicator", 1),
    ("wandering_trader", "wandering_trader", "Wandering Trader", 1),
    ("warden", "warden", "Warden", 1),
    ("witch", "witch", "Witch", 1),
    ("wither_skeleton", "wither_skeleton", "Wither Skeleton", 1),
    ("wolf", "wolf", "Wolf", 1),
    ("zoglin", "zoglin", "Zoglin", 1),
    ("zombie", "zombie", "Zombie", 1),
    ("zombie_horse", "zombie_horse", "Zombie Horse", 1),
    ("zombie_villager", "zombie_villager_v2", "Zombie Villager", 1),
    ("zombified_piglin", "zombie_pigman", "Zombified Piglin", 1),
    # In the water they swim along with you; on land they glide.
    ("cod", "cod", "Cod", 1),
    ("dolphin", "dolphin", "Dolphin", 1),
    ("elder_guardian", "elder_guardian", "Elder Guardian", 1),
    ("glow_squid", "glow_squid", "Glow Squid", 1),
    ("guardian", "guardian", "Guardian", 1),
    ("nautilus", "nautilus", "Nautilus", 1),
    ("pufferfish", "pufferfish", "Pufferfish", 1),
    ("salmon", "salmon", "Salmon", 1),
    ("squid", "squid", "Squid", 1),
    ("tadpole", "tadpole", "Tadpole", 1),
    ("tropical_fish", "tropicalfish", "Tropical Fish", 1),
    ("zombie_nautilus", "zombie_nautilus", "Zombie Nautilus", 1),
]

# Resting values for variables the game supplies to its own mobs. Anything not
# listed starts at 0. A divisor must never be 0: humanoids divide by this one.
RESTING = {"gliding_speed_value": "1.0"}

# Geometries a disguise never draws, pointed at the default one (2.12.9).
#
# The game works out a neck point (armor_offset.default_neck) for every
# geometry a look lists, and when two disagree it logs, once per world load:
#   "model already has a locator armor_offset.default_neck that doesn't
#   exactly match the one wanting to be added - skipping new definition in
#   default(geometry.pig.v3)"
# 30 of the 76 looks did that on 2026-11-14, nearly all because the baby's
# neck sits lower than the grown-up's. No vanilla file defines that point (it
# isn't in any of the game's models), so the only cure is fewer different
# geometries. A disguise is always the grown-up mob in its default variant, so:
#   baby       every look; the render controllers ask query.is_baby, never true
#   the rest   below, each with what keeps it from ever being drawn
# The plain look (SIMPLE_RENDER) draws Geometry.default only, so every other
# geometry of a plain-look mob points at it too.
NEVER_DRAWN_EVERYWHERE = ("baby",)
NEVER_DRAWN = {
    "cow": ("warm", "cold"),   # the coat is chosen by its climate, read as the default, temperate
    "sheep": ("sheared",),     # Array.geos[query.is_sheared], never sheared
}

# Names the game asks for that none of its own files define (2.12.9). The
# content log, 2026-11-14:
#   warden      controller.render.warden_bioluminescent_layer (and the spots,
#               tendrils and heart) | Geometries | 'geometry.default_bioluminescent' not found
#   creaking    controller.render.creaking_eyes | Geometries | 'geometry.eyes' not found
#   magma_cube  controller.render.magma_cube | Materials | 'material.opaque' / 'material.glow' not found
# The render controllers in the game's files ask for Geometry.default and
# Material.default there, so the game itself must swap the names in when it
# draws them; neither the files nor the game program contain them as text. So
# each missing name is given the part the game's file asks for, which is what
# the game drew before. Missing, the layer isn't drawn: no glowing spots or
# heart on the warden, no eyes on the creaking, maybe no magma cube at all.
# (part, missing name, the existing name it copies)
GAME_ASKS_FOR = {
    "warden": [("geometry", "default_bioluminescent", "default")],
    "creaking": [("geometry", "eyes", "default")],
    "magma_cube": [("materials", "opaque", "default"), ("materials", "glow", "default")],
}

VAR_READ = re.compile(r"\b(?:variable|v)\.([a-z_][a-z0-9_]*)", re.I)
VAR_SET = re.compile(r"\b(?:variable|v)\.([a-z_][a-z0-9_]*)\s*=(?!=)", re.I)
MC_PROPERTY = re.compile(r"\b(?:query|q)\.property\(\s*['\"]minecraft:", re.I)
MC_PROPERTY_CALL = re.compile(r"\b(?:query|q)\.property\(\s*['\"](minecraft:[a-z0-9_]+)['\"]\s*\)", re.I)
PASSTHROUGH = ("enable_attachables", "hide_armor", "held_item_ignores_lighting", "particle_effects", "sound_effects", "locators")


def version_key(name):
    if name == "vanilla":
        return (0,)
    m = re.match(r"vanilla_(\d+)\.(\d+)(?:\.(\d+))?$", name)
    return (1,) + tuple(int(x or 0) for x in m.groups()) if m else None


def lenient(text):
    return json.loads(re.sub(r"^\s*//.*$", "", text, flags=re.M))


def load_game():
    """The vanilla look definitions, merged across the versioned packs (newest wins)."""
    if not GAME_RP.is_dir():
        raise SystemExit(f"cannot find the installed game at {GAME_RP}")
    packs = sorted((p.name for p in GAME_RP.iterdir() if version_key(p.name)), key=version_key)
    clients, anims, ctrls, renders = {}, {}, {}, {}
    for pack in packs:
        for kind in ("entity", "animations", "animation_controllers", "render_controllers"):
            arc = GAME_RP / pack / "__brarchive" / f"{kind}.brarchive"
            if not arc.exists():
                continue
            for _name, body in entries(arc.read_bytes()):
                try:
                    data = lenient(body.decode("utf8"))
                except Exception:
                    continue
                if kind == "entity" and "minecraft:client_entity" in data:
                    ce = data["minecraft:client_entity"]
                    clients[ce["description"]["identifier"]] = (data.get("format_version", "1.10.0"), ce["description"])
                elif kind == "animations":
                    anims.update(data.get("animations") or {})
                elif kind == "animation_controllers":
                    ctrls.update(data.get("animation_controllers") or {})
                elif kind == "render_controllers":
                    renders.update(data.get("render_controllers") or {})
    return clients, anims, ctrls, renders


def load_property_defaults():
    """{entity id: {property: molang literal}} from the game's behaviour files."""
    out = {}
    if not GAME_BP.is_dir():
        raise SystemExit(f"cannot find the installed game at {GAME_BP}")
    packs = sorted((p.name for p in GAME_BP.iterdir() if version_key(p.name)), key=version_key)
    for pack in packs:
        arc = GAME_BP / pack / "__brarchive" / "entities.brarchive"
        if not arc.exists():
            continue
        for _name, body in entries(arc.read_bytes()):
            try:
                desc = lenient(body.decode("utf8"))["minecraft:entity"]["description"]
            except Exception:
                continue
            props = {}
            for name, spec in (desc.get("properties") or {}).items():
                kind, default = spec.get("type"), spec.get("default")
                if kind == "enum":
                    value = default if isinstance(default, str) else (spec.get("values") or [""])[0]
                    props[name] = f"'{value}'"
                elif kind == "bool":
                    props[name] = "1.0" if default is True else "0.0"
                else:
                    props[name] = str(default) if isinstance(default, (int, float)) and not isinstance(default, bool) else "0.0"
            out[desc["identifier"]] = props
    return out


def strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)


def reads_mc_property(node):
    return any(MC_PROPERTY.search(s) for s in strings(node))


class Rewriter:
    """A game-only property, read as the mob's default (point 2 above)."""

    def __init__(self, defaults):
        self.defaults = defaults
        self.unknown = set()

    def __call__(self, text):
        def literal(match):
            name = match.group(1).lower()
            if name not in self.defaults:
                self.unknown.add(name)
                return "0.0"
            return self.defaults[name]
        return MC_PROPERTY_CALL.sub(literal, text)

    def all(self, node):
        if isinstance(node, str):
            return self(node)
        if isinstance(node, list):
            return [self.all(v) for v in node]
        if isinstance(node, dict):
            return {self(k): self.all(v) for k, v in node.items()}
        return node


def controller_animations(body):
    """The animation short names a controller's states play."""
    names = set()
    for state in (body.get("states") or {}).values():
        for entry in state.get("animations") or []:
            names.update(entry.keys() if isinstance(entry, dict) else [entry])
    return names


def build(mob_id, vanilla, game, defaults):
    clients, anims, ctrls, renders = game
    found = clients.get(f"minecraft:{vanilla}")
    if not found:
        raise SystemExit(f"the game has no look called minecraft:{vanilla} (for {mob_id})")
    format_version, desc = found
    dropped = []
    rewrite = Rewriter(defaults)

    # Animations and controllers, by the names this look gives them.
    animations = {}
    for short, ref in (desc.get("animations") or {}).items():
        body = ctrls.get(ref) if ref.startswith("controller.") else anims.get(ref)
        if body is None:
            dropped.append(f"{short} ({ref}): not in the game")
        elif reads_mc_property(body):
            dropped.append(f"{short} ({ref}): reads a minecraft: property")
        else:
            animations[short] = ref
    # A controller may only play animations that are still here.
    for short, ref in list(animations.items()):
        if ref.startswith("controller.") and not controller_animations(ctrls[ref]) <= set(animations):
            dropped.append(f"{short} ({ref}): plays an animation that was left out")
            del animations[short]
    old_style = []
    for entry in desc.get("animation_controllers") or []:
        pairs = entry.items() if isinstance(entry, dict) else [(entry, entry)]
        for short, ref in pairs:
            body = ctrls.get(ref)
            if body is None or reads_mc_property(body) or not controller_animations(body) <= set(animations):
                dropped.append(f"{short} ({ref}): controller left out")
            else:
                old_style.append({short: ref})

    # The render controllers, or the plain look when one reads a game-only property.
    render_list = desc.get("render_controllers") or []
    refs = [r for e in render_list for r in (e.keys() if isinstance(e, dict) else [e])]
    plain = any(r not in renders or reads_mc_property(renders[r]) for r in refs)
    if plain:
        dropped.append("render controllers: plain look (one reads a minecraft: property)")
        render_list = [SIMPLE_RENDER]
        if "default" not in (desc.get("geometry") or {}) or "default" not in (desc.get("textures") or {}):
            raise SystemExit(f"{mob_id}: the plain look needs a default geometry and texture")

    # Scripts: the formulas that feed the animations, with a game-only
    # property read as the mob's default.
    scripts_in = desc.get("scripts") or {}
    scripts = {}
    for key in ("initialize", "pre_animation"):
        if scripts_in.get(key):
            scripts[key] = [rewrite(line) for line in scripts_in[key]]
    animate = []
    for entry in scripts_in.get("animate") or []:
        name, condition = (next(iter(entry.items())) if isinstance(entry, dict) else (entry, None))
        if name in animations:
            animate.append({name: rewrite(str(condition))} if condition is not None else name)
    if animate:
        scripts["animate"] = animate
    for key, value in scripts_in.items():
        if key not in ("initialize", "pre_animation", "animate"):
            scripts[key] = rewrite.all(value)
    render_list = rewrite.all(render_list)
    if rewrite.unknown:
        raise SystemExit(f"{mob_id}: the game's behaviour files give no default for {sorted(rewrite.unknown)}")

    # Every variable something here reads must be set by something here.
    texts = list(strings(scripts)) + list(strings(render_list))
    for ref in animations.values():
        texts += list(strings(ctrls.get(ref) if ref.startswith("controller.") else anims.get(ref)))
    for entry in old_style:
        texts += list(strings(ctrls[next(iter(entry.values()))]))
    for ref in (r for e in render_list for r in (e.keys() if isinstance(e, dict) else [e])):
        texts += list(strings(renders.get(ref, {})))
    read = {m.group(1).lower() for t in texts for m in VAR_READ.finditer(t)}
    written = {m.group(1).lower() for t in texts for m in VAR_SET.finditer(t)}
    resting = sorted(read - written)
    if resting:
        scripts["pre_animation"] = [f"variable.{name} = {RESTING.get(name, '0.0')};" for name in resting] + scripts.get("pre_animation", [])

    out = {"identifier": f"{PREFIX}{mob_id}"}
    for key in ("materials", "textures", "geometry"):
        if desc.get(key):
            out[key] = dict(desc[key])  # a copy: the game's own table is read again for the report

    # Point 5: geometries never drawn share the default's, and names the game
    # asks for are given the part its own file asks for.
    geometry = out.get("geometry") or {}
    if "default" in geometry:
        never = set(NEVER_DRAWN_EVERYWHERE) | set(NEVER_DRAWN.get(mob_id, ()))
        if plain:
            never |= set(geometry) - {"default"}
        for name in sorted(never & set(geometry)):
            if geometry[name] != geometry["default"]:
                geometry[name] = geometry["default"]
                dropped.append(f"geometry {name}: drawn as the default (never shown on a disguise)")
    for part, name, same_as in GAME_ASKS_FOR.get(mob_id, []):
        table = out.get(part) or {}
        if same_as not in table:
            raise SystemExit(f"{mob_id}: the game asks for {part} '{name}', and there is no '{same_as}' to give it")
        if name not in table:
            table[name] = table[same_as]
            dropped.append(f"{part} {name}: the game asks for it; given the {same_as} one")
    if animations:
        out["animations"] = animations
    if old_style:
        out["animation_controllers"] = old_style
    out["render_controllers"] = render_list
    if scripts:
        out["scripts"] = scripts
    for key in PASSTHROUGH:
        if key in desc:
            out[key] = desc[key]
    return {"format_version": format_version, "minecraft:client_entity": {"description": out}}, dropped, resting


def behaviour(mob_id, scale):
    """The entity itself: no AI, can't be hurt, can't be pushed, never collides."""
    components = {
        "minecraft:type_family": {"family": ["adminplus_disguise", "inanimate"]},
        # Tiny, so a hit passes through to the hidden player inside.
        "minecraft:collision_box": {"width": 0.01, "height": 0.01},
        "minecraft:damage_sensor": {"triggers": {"cause": "all", "deals_damage": False}},
        "minecraft:fire_immune": True,
        "minecraft:breathable": {"breathes_air": True, "breathes_water": True, "breathes_lava": True, "breathes_solids": True, "suffocate_time": 0, "total_supply": 15},
        # Gravity and collision, so the game knows when it stands on the ground.
        # The script moves it every tick, so it never wanders off.
        "minecraft:physics": {"has_gravity": True, "has_collision": True},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
        "minecraft:push_through": {"value": 1},
        "minecraft:knockback_resistance": {"value": 1.0},
        "minecraft:health": {"value": 1, "max": 1},
        "minecraft:movement": {"value": 0.25},
        "minecraft:nameable": {"always_show": False, "allow_name_tag_renaming": False},
    }
    if scale != 1:
        components["minecraft:scale"] = {"value": scale}
    return {
        "format_version": "1.20.80",
        "minecraft:entity": {
            "description": {
                "identifier": f"{PREFIX}{mob_id}",
                "is_spawnable": False,
                "is_summonable": True,
                "is_experimental": False,
            },
            "components": components,
        },
    }


SIMPLE = {
    "format_version": "1.10.0",
    "render_controllers": {
        SIMPLE_RENDER: {
            "geometry": "Geometry.default",
            "materials": [{"*": "Material.default"}],
            "textures": ["Texture.default"],
        }
    },
}


def script_list():
    rows = ",\n".join(f'    {{ id: "{m}", entity: "{PREFIX}{m}", look: "{v}", name: "{n}" }}' for m, v, n, _ in MOBS)
    return (
        "// Written by tools/gendisguise.py. Change the list there and run it again.\n"
        "//\n"
        "// Every mob /disguise can turn a player into: its id, the game's own mob\n"
        "// whose look it borrows (minecraft:<look>), and the name players read.\n"
        "// The entity is adminplus:disguise_<id>.\n"
        f'export const DISGUISE_PREFIX = "{PREFIX}"\n'
        "export const DISGUISES = Object.freeze([\n" + rows + "\n].map(Object.freeze))\n"
    )


LANG_START = "## Disguises (tools/gendisguise.py)"


def lang_lines():
    return [LANG_START] + [f"entity.{PREFIX}{m}.name={n}" for m, _, n, _ in MOBS]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8", newline="\n")


def main():
    report = "--report" in sys.argv
    game = load_game()
    defaults = load_property_defaults()
    ids = [m[0] for m in MOBS]
    if len(ids) != len(set(ids)):
        raise SystemExit("a mob is listed twice")
    built = {}
    for mob_id, vanilla, _name, scale in MOBS:
        client, dropped, resting = build(mob_id, vanilla, game, defaults.get(f"minecraft:{vanilla}", {}))
        built[mob_id] = (client, behaviour(mob_id, scale))
        if report:
            print(f"{mob_id:18} dropped {len(dropped)}, resting {len(resting)}")
            for line in dropped:
                print(f"{'':20}- {line}")
    if report:
        return
    bp_dir, rp_dir = BP / "entities" / "disguise", RP / "entity" / "disguise"
    for folder in (bp_dir, rp_dir):
        if folder.is_dir():
            for old in folder.glob("*.json"):
                old.unlink()
    for mob_id, (client, entity) in built.items():
        write_json(rp_dir / f"{mob_id}.entity.json", client)
        write_json(bp_dir / f"{mob_id}.json", entity)
    write_json(RP / "render_controllers" / "disguise.render_controllers.json", SIMPLE)
    (BP / "scripts" / "core" / "disguises.js").write_text(script_list(), encoding="utf8", newline="\n")

    lang = RP / "texts" / "en_US.lang"
    text = lang.read_text(encoding="utf8")
    if LANG_START in text:
        text = text[:text.index(LANG_START)].rstrip("\n") + "\n"
    lang.write_text(text.rstrip("\n") + "\n\n" + "\n".join(lang_lines()) + "\n", encoding="utf8", newline="\n")
    print(f"{len(built)} disguises written")


if __name__ == "__main__":
    main()
