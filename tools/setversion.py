"""Set the Admin+ version everywhere, from one place.

    python tools/setversion.py 1.0.0

Touches, in lockstep:
  * Admin+ BP/scripts/config.js   ADMINPLUS_VERSION
  * both manifests: the header version AND every module/dependency version array
  * both manifest header NAMES, which carry the version so it is visible in the
    in-game pack list without opening anything

Doing this by hand is how the six version arrays drift apart, and a manifest
whose arrays disagree is a pack that will not load. The @minecraft/server
dependency versions are STRINGS, not arrays, and are deliberately untouched:
those are API versions and have nothing to do with ours.
"""
import io
import json
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Shown in Settings > Behaviour/Resource Packs. Formatting codes render there,
# so the version can sit alongside in grey without shouting.
NAMES = {
    "Admin+ BP": "§bAdmin§d+§r §7v{v} §8[BP]",
    "Admin+ RP": "§bAdmin§d+§r §7v{v} §8[RP]",
}


def parse(text):
    parts = text.strip().lstrip("v").split(".")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        raise SystemExit(f"version must be x.y.z, got {text!r}")
    return [int(p) for p in parts]


def set_manifest(folder, version):
    path = ROOT / folder / "manifest.json"
    doc = json.load(io.open(path, encoding="utf-8"))

    doc["header"]["version"] = list(version)
    for module in doc.get("modules", []):
        module["version"] = list(version)
    for dep in doc.get("dependencies", []):
        # Only OUR pack-to-pack links are arrays; API deps are strings.
        if isinstance(dep.get("version"), list):
            dep["version"] = list(version)

    doc["header"]["name"] = NAMES[folder].format(v=".".join(map(str, version)))

    io.open(path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(doc, indent=4, ensure_ascii=False) + "\n")
    return doc["header"]["name"]


def set_config(version):
    path = ROOT / "Admin+ BP/scripts/config.js"
    text = ".".join(map(str, version))
    raw = io.open(path, encoding="utf-8").read()
    new, n = re.subn(r'(ADMINPLUS_VERSION = ")[\d.]+(")', rf"\g<1>{text}\g<2>", raw)
    if n != 1:
        raise SystemExit("config.js: could not find ADMINPLUS_VERSION")
    io.open(path, "w", encoding="utf-8", newline="\n").write(new)
    return text


def current():
    """What config.js says right now, as a tuple."""
    raw = io.open(ROOT / "Admin+ BP/scripts/config.js", encoding="utf-8").read()
    found = re.search(r'ADMINPLUS_VERSION = "([\d.]+)"', raw)
    return parse(found.group(1)) if found else (0, 0, 0)


def guard_size(old, new):
    """Refuse a minor or major bump that has not been argued for.

    CLAUDE.md is explicit and has been since 2.0.0: **a minor is a whole new
    SECTION behind its own toggle** — the troll section is the archetype — and a
    major is a milestone. Everything else, which is nearly everything, is a
    patch: a command, a fix, a tweak.

    It was ignored four times in one day anyway. The Orbital Strike took 2.2.0
    while being one item INSIDE the existing troll section; a leak fix took
    2.3.0; automod changing its mind took 2.4.0; the console parser took 2.5.0.
    Each felt big while it was being written, and "felt big" is not the rule.

    So the rule stops being something to remember. A minor or major bump now
    needs --section or --milestone, which is a sentence you have to be willing
    to write down rather than a habit you can drift into.
    """
    if new[0] > old[0]:
        if "--milestone" not in sys.argv:
            raise SystemExit(
                f"refusing {'.'.join(map(str, new))}: a MAJOR is a milestone, not a big day.\n"
                "  If it truly is one, say so: tools/setversion.py X.0.0 --milestone")
        return
    if new[1] > old[1]:
        if "--section" not in sys.argv:
            raise SystemExit(
                f"refusing {'.'.join(map(str, new))}: a MINOR is a whole new SECTION behind its\n"
                "  own toggle (the troll section is the archetype) — not a feature, not a fix,\n"
                "  not a policy change. Nearly everything is a patch.\n"
                f"  Did you mean {old[0]}.{old[1]}.{old[2] + 1}?\n"
                "  If it really is a new section: tools/setversion.py X.Y.0 --section")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    version = parse(args[0])
    guard_size(current(), version)
    text = set_config(version)
    print(f"config.js       -> {text}")
    for folder in NAMES:
        print(f"{folder:<16}-> {set_manifest(folder, version)}")
    print("\nRun npm test, then tools/verify.py, before shipping.")


if __name__ == "__main__":
    main()
