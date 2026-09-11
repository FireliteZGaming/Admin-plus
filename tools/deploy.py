"""Replace the INSTALLED Admin+ packs with the current build.

The user imports the .mcaddon once; after that the game reads these folders, so
an update means replacing their contents. Run this after a completed update, not
mid-iteration.

Safety: each target is checked against our manifest header UUID before anything
is deleted. A folder that is not Admin+ is never touched, so a wrong path fails
loudly instead of wiping something else.

Run:  python tools/deploy.py
"""
import hashlib
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

# What went out last time, so an unbumped change can be refused. Kept beside
# the project rather than in com.mojang: it is a fact about this working copy.
STAMP = os.path.join(BASE, ".deployed.json")


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


def source_fingerprint():
    """A hash of everything that ships, so a silent change can be noticed."""
    digest = hashlib.sha1()
    for pack, _ in PAIRS:
        root = os.path.join(BASE, pack)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for fn in sorted(filenames):
                if fn in SKIP_FILES:
                    continue
                path = os.path.join(dirpath, fn)
                digest.update(os.path.relpath(path, BASE).replace("\\", "/").encode())
                with open(path, "rb") as fh:
                    digest.update(fh.read())
    return digest.hexdigest()


def check_bumped(version, fingerprint):
    """Refuse to deploy changed content under a version already deployed.

    CLAUDE.md has said "bump before deploying" from the beginning, and it got
    broken anyway: 2.1.15 was deployed, four more changes were made on top, and
    all of them went out still stamped 2.1.15. The pack list is the only place
    the user can see what they are running, so a version that means two
    different builds makes it a liar — and the symptom is somebody reloading the
    world, seeing the same number, and reasonably concluding nothing deployed.

    A rule in a document did not stop that. A tool that refuses does. This is
    the same shape as release.py refusing an unplayed build.
    """
    if not os.path.isfile(STAMP):
        return
    try:
        with open(STAMP, encoding="utf-8") as fh:
            last = json.load(fh)
    except Exception:
        return                                  # unreadable stamp is not a reason to block
    if last.get("version") != version:
        return                                  # bumped: nothing to say
    if last.get("fingerprint") == fingerprint:
        return                                  # same build, re-deploying: fine

    raise SystemExit(
        f"refusing to deploy: v{version} is already installed, and what is here now\n"
        f"is NOT what went out under that number.\n\n"
        f"  installed  v{version}  {last.get('fingerprint', '?')[:12]}\n"
        f"  here       v{version}  {fingerprint[:12]}\n\n"
        f"The pack list is the only place the version is visible in game, so two\n"
        f"different builds must not share one. Run:\n\n"
        f"    python tools/setversion.py <next version>\n\n"
        f"then write the CHANGELOG section and deploy again."
    )


def main():
    if not os.path.isdir(INSTALL_ROOT):
        raise SystemExit(f"Minecraft data folder not found: {INSTALL_ROOT}")

    version = ".".join(map(str, json.load(
        open(os.path.join(BASE, PAIRS[0][0], "manifest.json"), encoding="utf-8")
    )["header"]["version"]))
    fingerprint = source_fingerprint()
    check_bumped(version, fingerprint)

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
        # NOT `version` — that holds the dotted string the stamp is written
        # from, and rebinding it to a list here put the wrong shape in the file,
        # which would have made every future comparison fail open.
        shipped = json.load(open(os.path.join(source, "manifest.json"), encoding="utf-8"))["header"]["version"]
        print(f"deployed {pack} -> {target}  ({count} files, v{'.'.join(map(str, shipped))})")

    with open(STAMP, "w", encoding="utf-8") as fh:
        json.dump({"version": version, "fingerprint": fingerprint}, fh, indent=2)

    print(f"done — {total} files installed")
    print("Reload the world (or rejoin) for the scripts to re-run.")


if __name__ == "__main__":
    main()
