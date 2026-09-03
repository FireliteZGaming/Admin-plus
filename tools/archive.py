"""Keep a copy of the current build, named with its version.

    python tools/archive.py

`Admin+.mcaddon` in the project root is whatever mcpack.py produced last, and it
is overwritten in place. That is fine while testing and wrong when uploading: by
the time a storefront's upload form is open, the file may already be a different
build than the one that was played. This drops a stamped copy into releases/ so
there is always something stable to point at.

It only copies. It never builds, and it never overwrites a stamp that already
exists unless you pass --force.
"""
import io
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "Admin+.mcaddon"
OUT = ROOT / "releases"


def version():
    manifest = json.load(io.open(ROOT / "Admin+ BP/manifest.json", encoding="utf-8"))
    return ".".join(str(n) for n in manifest["header"]["version"])


def main():
    force = "--force" in sys.argv

    if not BUILD.exists():
        print("No Admin+.mcaddon in the project root. Run: python mcpack.py")
        return 1

    v = version()
    target = OUT / f"Admin+ v{v}.mcaddon"
    OUT.mkdir(exist_ok=True)

    if target.exists() and not force:
        same = target.stat().st_size == BUILD.stat().st_size
        print(f"releases/{target.name} already exists ({'same size' if same else 'DIFFERENT size'}).")
        print("Bump the version first, or pass --force to overwrite it.")
        return 1

    shutil.copy2(BUILD, target)
    print(f"archived -> releases/{target.name}  ({target.stat().st_size // 1024} KB)")

    kept = sorted(OUT.glob("*.mcaddon"))
    if len(kept) > 1:
        print(f"{len(kept)} builds kept: {', '.join(p.stem.replace('Admin+ ', '') for p in kept)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
