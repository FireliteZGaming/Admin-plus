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
        if logs:
            newest = logs[-1]
            body = io.open(newest, encoding="utf-8", errors="replace").read()
            loaded = re.findall(r"\[Admin\+\] v([\d.]+) loaded", body)
            problems = [l for l in body.splitlines()
                        if ("[Admin+]" in l and ("error" in l.lower() or "warn" in l.lower()))
                        or "Scripting][error]" in l]
            print(f"  {newest.name}")
            print(f"  ran       {loaded[-1] if loaded else '(no Admin+ startup line)'}")
            if problems:
                print(f"  {len(problems)} problem line(s), last few:")
                for line in problems[-3:]:
                    print(f"    {line.strip()[:110]}")
            else:
                print("  problems  none")
        else:
            print("  no content logs found")
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
