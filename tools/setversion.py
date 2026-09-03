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


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    version = parse(sys.argv[1])
    text = set_config(version)
    print(f"config.js       -> {text}")
    for folder in NAMES:
        print(f"{folder:<16}-> {set_manifest(folder, version)}")
    print("\nRun npm test, then tools/verify.py, before shipping.")


if __name__ == "__main__":
    main()
