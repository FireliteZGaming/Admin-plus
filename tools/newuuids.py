"""Give both packs brand-new UUIDs. FOR A PUBLISH, NEVER FOR A DEPLOY.

    python tools/newuuids.py --confirm

Read this before using it, because it is not the usual way to ship an update.

WHAT IT DOES
  Replaces the header and module UUIDs in both manifests and re-points the
  behaviour pack's dependency at the resource pack's new id, so the pair stays
  linked.

WHAT THAT MEANS FOR PLAYERS
  Minecraft identifies a pack by UUID, not by name. A new UUID is therefore a
  NEW PACK, sitting alongside the old one:

    + Importing it can never collide with, or be blocked by, the old copy.
    - Existing worlds keep running the OLD version. A world stores the pack's
      UUID in its own list, so it does not follow the rename - the owner has to
      go into world settings and swap packs by hand.
    - Deleting the old pack breaks any world still pointing at it.

  The ordinary way to ship an update is the opposite: KEEP the UUIDs and raise
  the version (tools/setversion.py). Bedrock then replaces the installed pack on
  import, and every world using it picks up the new version with nothing to
  delete and nothing to re-select.

  So reach for this only when a clean break is what you actually want - a 2.0
  that should not silently replace someone's 1.x, or a pack whose identity you
  need to separate from an earlier release.

The old UUIDs are printed and written to tools/uuid-history.txt, because once
they are gone you cannot get back to a world that still refers to them.
"""
import io
import json
import pathlib
import sys
import uuid
import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
HISTORY = ROOT / "tools/uuid-history.txt"


def main():
    if "--confirm" not in sys.argv:
        raise SystemExit(__doc__ + "\nRe-run with --confirm once you have read the above.")

    manifests = {}
    for folder in ("Admin+ BP", "Admin+ RP"):
        path = ROOT / folder / "manifest.json"
        manifests[folder] = (path, json.load(io.open(path, encoding="utf-8")))

    old_rp = manifests["Admin+ RP"][1]["header"]["uuid"]
    lines = [f"# rotated {datetime.datetime.now().isoformat(timespec='seconds')}"]
    new_rp = None

    for folder, (path, doc) in manifests.items():
        version = ".".join(map(str, doc["header"]["version"]))
        lines.append(f"{folder} v{version}")
        lines.append(f"  header  {doc['header']['uuid']}  ->  ")

        doc["header"]["uuid"] = str(uuid.uuid4())
        lines[-1] += doc["header"]["uuid"]
        if folder == "Admin+ RP":
            new_rp = doc["header"]["uuid"]

        for module in doc.get("modules", []):
            before = module["uuid"]
            module["uuid"] = str(uuid.uuid4())
            lines.append(f"  module  {before}  ->  {module['uuid']}")

    # Re-link: the behaviour pack points at the resource pack by id.
    bp_path, bp = manifests["Admin+ BP"]
    relinked = 0
    for dep in bp.get("dependencies", []):
        if dep.get("uuid") == old_rp:
            dep["uuid"] = new_rp
            relinked += 1
    if not relinked:
        print("warning: the BP did not reference the RP by uuid; nothing to re-link")

    for folder, (path, doc) in manifests.items():
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(doc, indent=4, ensure_ascii=False) + "\n")

    io.open(HISTORY, "a", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n\n")

    print("\n".join(lines))
    print(f"\nrelinked {relinked} dependency reference(s)")
    print(f"old ids appended to {HISTORY.relative_to(ROOT)}")
    print("\nEvery existing world still points at the OLD ids and will keep the old\n"
          "version until its owner swaps packs by hand.")


if __name__ == "__main__":
    main()
