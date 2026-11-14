"""One screen of orientation. Run this first, every session.

    python tools/state.py

After a context reset — a new session, or a compaction mid-session — the
expensive thing to rebuild is not what the code says but where everything
STANDS: which version is live in the game versus on disk, whether the tests are
green, whether there is uncommitted work, what shipped last, and what is still
untested. Reading files answers none of that. This does, in about a second.

It only reports. It changes nothing.
"""
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BP = ROOT / "Admin+ BP"
DEPLOY = pathlib.Path(os.environ.get("APPDATA", "")) / \
    "Minecraft Bedrock/Users/Shared/games/com.mojang/behavior_packs/Admin+BP"
LOGS = pathlib.Path(os.environ.get("APPDATA", "")) / "Minecraft Bedrock/logs"

# Plain text on purpose. Some of the consoles this runs in print the escape
# codes literally, which turns an orientation screen into noise.
DIM = BOLD = OFF = ""


def run(*args, cwd=ROOT, shell=False):
    try:
        cmd = " ".join(args) if shell else args
        out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                             timeout=180, shell=shell)
        return (out.stdout or "").strip()
    except Exception:
        return ""


def version(manifest):
    try:
        return ".".join(map(str, json.load(io.open(manifest, encoding="utf-8"))["header"]["version"]))
    except Exception:
        return "?"


def head(text):
    print(f"\n{BOLD}{text}{OFF}")


def main():
    # notes/UNTESTED.md has arrows and § in it, which a Windows console's
    # default code page can't print (it crashed here on "↔", 2026-11-13).
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    print("Admin+ - state")

    # ---------------------------------------------------------------- versions
    head("versions")
    source = version(BP / "manifest.json")
    deployed = version(DEPLOY / "manifest.json") if DEPLOY.exists() else None
    print(f"  source    {source}")
    if deployed is None:
        print("  deployed  (not installed)")
    elif deployed == source:
        print(f"  deployed  {deployed}  in sync")
    else:
        print(f"  deployed  {deployed}  <- the game is running an OLDER build")

    # **The user installs by opening Admin+.mcaddon, not through deploy.py.**
    # The game unpacks each import into a folder named after the pack, with
    # (1), (2) ... for repeats, so the deploy folder above can sit at 2.7.7
    # while the game runs 2.12.7. Found 2026-11-14, after this screen had said
    # the game was "running an OLDER build" about a world that ran the newest.
    # Matched by the pack's own uuid, which every version shares.
    try:
        uuid = json.load(io.open(BP / "manifest.json", encoding="utf-8"))["header"]["uuid"]
        copies = []
        for manifest in DEPLOY.parent.glob("*/manifest.json"):
            try:
                header = json.load(io.open(manifest, encoding="utf-8-sig"))["header"]
            except Exception:
                continue
            if header.get("uuid") == uuid:
                copies.append((tuple(header["version"]), manifest.stat().st_mtime, manifest.parent.name))
        if copies:
            newest = max(copies)
            import time
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(newest[1]))
            note = "in sync" if ".".join(map(str, newest[0])) == source else "older than source"
            print(f"  imported  {'.'.join(map(str, newest[0]))}  ({newest[2]}, {when}, {note}; {len(copies)} copies in the game)")
    except Exception as e:
        print(f"  imported  could not read the game's packs: {e}")

    # ------------------------------------------------------------------- tests
    head("tests")
    out = run("npm", "--silent", "test", shell=True)   # npm is npm.cmd here
    hits = re.findall(r"(\d+) passed, (\d+) failed", out)
    if hits:
        suites = len(hits)
        passed = sum(int(p) for p, _ in hits)
        failed = sum(int(f) for _, f in hits)
        mark = "all green" if failed == 0 else f"{failed} FAILING"
        print(f"  {suites} suites, {passed} assertions, {mark}")
        if failed:
            for line in out.splitlines():
                if "FAIL" in line:
                    print(f"    {line.strip()}")
    else:
        print("  could not run npm test")

    # --------------------------------------------------------------------- git
    head("git")
    branch = run("git", "branch", "--show-current") or "?"
    dirty = [l for l in run("git", "status", "--porcelain").splitlines() if l.strip()]
    ahead = run("git", "rev-list", "--count", "@{u}..HEAD") or "0"
    print(f"  branch    {branch}")
    print(f"  working   {'clean' if not dirty else str(len(dirty)) + ' uncommitted'}")
    for line in dirty[:8]:
        print(f"            {line}")
    print(f"  unpushed  {ahead} commit(s)")
    last = run("git", "log", "-1", "--format=%h %s")
    if last:
        print(f"  last      {last}")
    tag = run("git", "describe", "--tags", "--abbrev=0")
    if tag:
        since = run("git", "rev-list", "--count", f"{tag}..HEAD")
        print(f"  last tag  {tag}" + (f"  ({since} commit(s) since)" if since != "0" else ""))

    # ------------------------------------------------------------------- build
    head("build")
    pack = ROOT / "Admin+.mcaddon"
    if pack.exists():
        with zipfile.ZipFile(pack) as z:
            count = len(z.namelist())
        print(f"  Admin+.mcaddon  {count} files, {pack.stat().st_size // 1024} KB")
    else:
        print("  Admin+.mcaddon  not built")

    # --------------------------------------------------------------- game logs
    head("last game session")
    try:
        logs = sorted(LOGS.glob("ContentLog*.txt"), key=lambda p: p.stat().st_mtime)

        # The NEWEST log is not the newest log that ran Admin+. Minecraft writes
        # one per session whatever is loaded, so a world opened without the pack
        # buries the session that matters — and the answer here was "(no Admin+
        # startup line)" about a build that had in fact run fine hours earlier.
        newest = None
        for candidate in reversed(logs):
            body = io.open(candidate, encoding="utf-8", errors="replace").read()
            if "[Admin+] v" in body:
                newest = candidate
                break
        skipped = len(logs) - 1 - logs.index(newest) if newest else 0

        if newest:
            loaded = re.findall(r"\[Admin\+\] v([\d.]+) loaded", body)
            lines = body.splitlines()

            # The 28 "cannot be used in early execution" warnings are EXPECTED:
            # a Table is built while modules evaluate, which is a restricted
            # context, and each one retries on the first tick. The proof that
            # the retry worked is a line of our own further down. Counting them
            # as problems drowned the report in noise that a real error would
            # have hidden in — which is how the storage bug stayed invisible for
            # six versions.
            #
            # So they are only discounted when that proof is actually present.
            # Without it they are the most important lines in the file.
            recovered = re.search(r"storage: all (\d+) tables read", body)
            early = [l for l in lines if "early execution" in l and "[Admin+]" in l]

            # Errors about OUR entities count too. The disguise look files'
            # 33 [Geometry] and [Molang] errors on 2026-11-14 named
            # "adminplus:disguise_..." and nothing else, so this screen said
            # "problems none" about them.
            problems = [l for l in lines
                        if (("[Admin+]" in l and ("error" in l.lower() or "warn" in l.lower()))
                            or "Scripting][error]" in l
                            or ("][error]" in l and "adminplus:" in l))
                        and not (recovered and "early execution" in l)]

            print(f"  {newest.name}" + (f"  ({skipped} newer log(s) without Admin+)" if skipped else ""))
            print(f"  ran       {loaded[-1] if loaded else '(no Admin+ startup line)'}")
            if early and recovered:
                print(f"  storage   {len(early)} early-execution retries, all {recovered.group(1)} tables recovered")
            elif early:
                print(f"  storage   {len(early)} early-execution failures and NO recovery line — read this first")

            # Name collisions are a standing fact, not an incident: the game owns
            # tp, msg and me, so ours answer to a: only. Worth stating rather
            # than listing as three warnings every single run.
            taken = re.findall(r"Custom Command alias \[(\w+)\] already in use", body)
            if taken:
                print(f"  aliases   the game owns {', '.join(sorted(set(taken)))} — ours are a:-only there")
            problems = [l for l in problems if "already in use" not in l]

            if problems:
                print(f"  {len(problems)} problem line(s), last few:")
                for line in problems[-3:]:
                    print(f"    {line.strip()[:110]}")
            else:
                print("  problems  none")
        else:
            print(f"  {len(logs)} content log(s), none of them ran Admin+")
    except Exception as e:
        print(f"  could not read logs: {e}")

    # ------------------------------------------------------------------- notes
    head("still untested in game")
    todo = ROOT / "notes/UNTESTED.md"
    if todo.exists():
        shown = 0
        for line in io.open(todo, encoding="utf-8").read().splitlines():
            # Everything below the second heading is the CONFIRMED half; stop
            # there or the list reports working features as outstanding.
            if line.startswith("## "):
                break
            if line.strip().startswith("- "):
                print(f"  {line.strip()}")
                shown += 1
        if not shown:
            print("  nothing outstanding")
    else:
        print("  (notes/UNTESTED.md missing)")

    print(f"\n{DIM}CLAUDE.md holds the standing rules. notes/DECISIONS.md holds why.{OFF}")


if __name__ == "__main__":
    main()
