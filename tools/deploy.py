"""Replace the INSTALLED Admin+ packs with the current build.

The user imports the .mcaddon once; after that the game reads these folders, so
an update means replacing their contents. Run this after a completed update, not
mid-iteration.

Safety: each target is checked against our manifest header UUID before anything
is deleted. A folder that is not Admin+ is never touched, so a wrong path fails
loudly instead of wiping something else.

Run:  python tools/deploy.py
"""
import json
import os
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALL_ROOT = os.path.join(
    os.environ.get("APPDATA", ""),
    "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang"
)

PAIRS = [
    ("Admin+ BP", os.path.join(INSTALL_ROOT, "behavior_packs", "Admin+BP")),
    ("Admin+ RP", os.path.join(INSTALL_ROOT, "resource_packs", "Admin+RP")),
]

SKIP_DIRS = {".git", "node_modules", "__pycache__"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}


def header_uuid(manifest_path):
    with open(manifest_path, encoding="utf-8") as fh:
        return json.load(fh)["header"]["uuid"]


def copy_pack(src, dst):
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel = os.path.relpath(dirpath, src)
        target_dir = dst if rel == "." else os.path.join(dst, rel)
        os.makedirs(target_dir, exist_ok=True)
        for fn in filenames:
            if fn in SKIP_FILES:
                continue
            shutil.copy2(os.path.join(dirpath, fn), os.path.join(target_dir, fn))


def main():
    if not os.path.isdir(INSTALL_ROOT):
        raise SystemExit(f"Minecraft data folder not found: {INSTALL_ROOT}")

    total = 0
    for pack, target in PAIRS:
        source = os.path.join(BASE, pack)
        if not os.path.isdir(source):
            raise SystemExit(f"missing source pack: {source}")

        source_uuid = header_uuid(os.path.join(source, "manifest.json"))

        if os.path.isdir(target):
            installed_manifest = os.path.join(target, "manifest.json")
            if not os.path.isfile(installed_manifest):
                raise SystemExit(f"refusing to replace {target}: no manifest.json there")
            if header_uuid(installed_manifest) != source_uuid:
                raise SystemExit(
                    f"refusing to replace {target}: header UUID is not Admin+'s\n"
                    f"  installed: {header_uuid(installed_manifest)}\n"
                    f"  ours:      {source_uuid}"
                )
            try:
                shutil.rmtree(target)
            except PermissionError as exc:
                raise SystemExit(
                    f"could not clear {target} — is Minecraft running with the pack loaded?\n  {exc}"
                )

        copy_pack(source, target)
        count = sum(len(files) for _, _, files in os.walk(target))
        total += count
        version = json.load(open(os.path.join(source, "manifest.json"), encoding="utf-8"))["header"]["version"]
        print(f"deployed {pack} -> {target}  ({count} files, v{'.'.join(map(str, version))})")

    print(f"done — {total} files installed")
    print("Reload the world (or rejoin) for the scripts to re-run.")


if __name__ == "__main__":
    main()
