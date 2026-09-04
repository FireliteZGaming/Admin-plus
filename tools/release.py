"""Cut a release, or refuse to.

    python tools/release.py --alpha     # built and tested, never run in game
    python tools/release.py --beta      # played here, not by anyone else
    python tools/release.py             # stable: it has actually been run
    python tools/release.py --promote   # an alpha/beta that survived, made stable
    python tools/release.py --check     # say what would happen, do nothing

A release is the one thing here that other people see, and it had drifted badly:
the source reached 1.15.0 while the releases page still ended at 1.7.3 and the
CurseForge listing sat on 1.10.2 — a version whose storage bug was only half
fixed. Nobody decided that. It happened because shipping was a checklist held in
somebody's head, and checklists held in heads get skipped when the work is
interesting.

CHANNELS
--------
CurseForge files carry a type — Alpha, Beta, Release — and the same three words
already describe how sure we are that something works:

    alpha    the tests pass. The engine has never seen it.
    beta     it ran in a world here and did what it should.
    stable   it has been played, by somebody who was not the person who wrote it.

A Bedrock manifest version is three integers with nowhere to put a suffix, so
the channel is not in the number. It is in the release: alpha and beta go up as
GitHub PRE-releases, which sit under the big green Latest button rather than on
it. Nothing ever gets renumbered on the way to stable — it gets PROMOTED, same
tag, same file, prerelease flag flipped, once it has earned it.

The stable gate is not a promise, it is a search: this exact version has to
appear in a content log, meaning the game genuinely loaded it at least once.
That is the whole reason a half-fixed build reached the storefront.

WHERE THINGS GO
---------------
GitHub is ours and takes every channel. CurseForge and MCPEDL are the user's to
upload, and MCPEDL mirrors CurseForge — which makes CurseForge the widest
audience, not the narrowest. So an alpha stays on GitHub, where whoever wants it
goes looking; beta and stable are worth uploading. This prints the file to hand
over and stops there.
"""
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "Admin+.mcaddon"
CHANGELOG = ROOT / "CHANGELOG.md"
LOGS = pathlib.Path(os.environ.get("APPDATA", "")) / "Minecraft Bedrock/logs"

CHANNELS = {
    "alpha": dict(prerelease=True, label="alpha",
                  gate=False, store="GitHub only — keep it off CurseForge"),
    "beta": dict(prerelease=True, label="beta",
                 gate=True, store="CurseForge file type: Beta"),
    "stable": dict(prerelease=False, label="",
                   gate=True, store="CurseForge file type: Release"),
}

problems = []
warnings = []


def fail(msg):
    problems.append(msg)
    print(f"  FAIL  {msg}")


def warn(msg):
    warnings.append(msg)
    print(f"  warn  {msg}")


def okline(msg):
    print(f"  ok    {msg}")


def head(text):
    print(f"\n{text}")


def run(*args, cwd=ROOT, shell=False, check=False):
    cmd = " ".join(args) if shell else list(args)
    out = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                         timeout=600, shell=shell)
    if check and out.returncode != 0:
        print((out.stdout or "") + (out.stderr or ""))
        raise SystemExit(f"command failed: {cmd}")
    return out


# --------------------------------------------------------------------- version

def check_version():
    head("version")
    raw = io.open(ROOT / "Admin+ BP/scripts/config.js", encoding="utf-8").read()
    hit = re.search(r'ADMINPLUS_VERSION = "([\d.]+)"', raw)
    if not hit:
        fail("config.js: no ADMINPLUS_VERSION")
        return None
    version = hit.group(1)

    for folder in ("Admin+ BP", "Admin+ RP"):
        doc = json.load(io.open(ROOT / folder / "manifest.json", encoding="utf-8"))
        header = ".".join(str(n) for n in doc["header"]["version"])
        if header != version:
            fail(f"{folder}: header {header}, config.js {version}")
        arrays = [m.get("version") for m in doc.get("modules", [])]
        arrays += [d.get("version") for d in doc.get("dependencies", [])
                   if isinstance(d.get("version"), list)]
        for arr in arrays:
            if ".".join(str(n) for n in arr) != version:
                fail(f"{folder}: an array says {arr}, header says {version}")
        if version not in doc["header"]["name"]:
            fail(f"{folder}: pack name {doc['header']['name']!r} lacks {version}")

    if not problems:
        okline(f"{version} everywhere — config, both manifests, both pack names")
    return version


# ------------------------------------------------------------------- changelog

def section_for(version):
    """The changelog body for one version, without its heading."""
    if not CHANGELOG.exists():
        return None
    text = io.open(CHANGELOG, encoding="utf-8").read()
    pattern = re.compile(r"^## +" + re.escape(version) + r"\b.*$", re.M)
    start = pattern.search(text)
    if not start:
        return None
    rest = text[start.end():]
    nxt = re.search(r"^## ", rest, re.M)
    body = (rest[:nxt.start()] if nxt else rest).strip()
    return body or None


def check_changelog(version):
    head("changelog")
    body = section_for(version)
    if not body:
        fail(f"CHANGELOG.md has no section for {version}. Write it first — notes "
             f"reconstructed afterwards are how versions stop meaning anything.")
        return None
    opener = body.splitlines()[0].strip().lstrip("-* ").replace("**", "")
    okline(f"{version}: {len(body.splitlines())} lines, opens \"{opener[:52]}\"")
    return body


# ------------------------------------------------------------- ran in the game

def sessions_with(version):
    """Content logs in which this exact version reported itself loaded."""
    found = []
    try:
        for log in sorted(LOGS.glob("ContentLog*.txt"), key=lambda p: p.stat().st_mtime):
            body = io.open(log, encoding="utf-8", errors="replace").read()
            if re.search(r"\[Admin\+\] v" + re.escape(version) + r" loaded", body):
                errs = [l for l in body.splitlines()
                        if "[Admin+]" in l and ("error" in l.lower() or "warn" in l.lower())]
                found.append((log.name, len(errs)))
    except Exception as e:
        warn(f"could not read content logs: {e}")
    return found


def check_played(version, channel):
    head("ran in the game")
    seen = sessions_with(version)
    if not seen:
        msg = (f"no content log shows v{version} loading. It has never run in "
               f"Minecraft, so it cannot be called {channel}.")
        if CHANNELS[channel]["gate"]:
            fail(msg + "  Ship it as --alpha, play it, then --promote.")
        else:
            okline(f"never run in game — which is what alpha means")
        return
    name, errs = seen[-1]
    okline(f"loaded in {len(seen)} session(s), last {name}")
    if errs:
        warn(f"that session logged {errs} Admin+ error/warning line(s) — read it "
             f"before calling this {channel or 'stable'}")


# ----------------------------------------------------------------- the gauntlet

def check_tests():
    head("tests")
    out = run("npm", "--silent", "test", shell=True)
    hits = re.findall(r"(\d+) passed, (\d+) failed", out.stdout or "")
    if not hits:
        fail("could not run npm test")
        return
    failed = sum(int(f) for _, f in hits)
    passed = sum(int(p) for p, _ in hits)
    if failed or out.returncode != 0:
        fail(f"{failed} failing assertion(s) across {len(hits)} suites")
    else:
        okline(f"{len(hits)} suites, {passed} assertions, all green")


def check_verify():
    head("verifier")
    out = run(sys.executable, str(ROOT / "tools/verify.py"))
    tail = [l for l in (out.stdout or "").splitlines() if "problems" in l]
    if out.returncode != 0:
        for line in (out.stdout or "").splitlines():
            if "FAIL" in line:
                print(f"        {line.strip()}")
        fail(tail[-1].strip() if tail else "verify.py reported problems")
    else:
        okline(tail[-1].strip() if tail else "no problems")


def check_git(version, promoting):
    head("git")
    dirty = [l for l in run("git", "status", "--porcelain").stdout.splitlines() if l.strip()]
    if dirty:
        fail(f"{len(dirty)} uncommitted change(s) — a tag must point at committed work")
        for line in dirty[:6]:
            print(f"        {line}")
    else:
        okline("working tree clean")

    ahead = (run("git", "rev-list", "--count", "@{u}..HEAD").stdout or "0").strip()
    if ahead not in ("", "0"):
        fail(f"{ahead} unpushed commit(s) — push before tagging")
    else:
        okline("nothing unpushed")

    tag = f"v{version}"
    exists = bool(run("git", "tag", "--list", tag).stdout.strip())
    if promoting and not exists:
        fail(f"tag {tag} does not exist — there is nothing to promote")
    elif exists and not promoting:
        fail(f"tag {tag} already exists — bump the version first")
    else:
        okline(f"tag {tag} {'exists, as it must' if promoting else 'is free'}")
    return tag


# ---------------------------------------------------------------------- github

def repo_slug():
    url = run("git", "remote", "get-url", "origin").stdout.strip()
    hit = re.search(r"github\.com[:/](.+?)(?:\.git)?$", url)
    return hit.group(1) if hit else None


def token():
    out = subprocess.run(["git", "credential", "fill"], cwd=ROOT, text=True,
                         input="protocol=https\nhost=github.com\n\n",
                         capture_output=True, timeout=60)
    hit = re.search(r"^password=(.+)$", out.stdout or "", re.M)
    return hit.group(1).strip() if hit else None


def api(url, tok, data=None, content_type="application/json", method=None):
    body = None
    if data is not None:
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body,
                                 method=method or ("POST" if body else "GET"))
    req.add_header("Authorization", f"token {tok}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "adminplus-release")
    if body:
        req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode() or "{}")


def release_title(version, channel):
    label = CHANNELS[channel]["label"]
    return f"Admin+ v{version}" + (f" ({label})" if label else "")


def publish(version, tag, notes, channel):
    slug, tok = repo_slug(), token()
    if not slug or not tok:
        print(f"  no {'remote' if not slug else 'GitHub credential'} — "
              f"the tag is pushed, create the release by hand")
        return

    asset = ROOT / "releases" / f"Admin+ v{version}.mcaddon"
    upload_name = f"Admin+-v{version}.mcaddon"

    try:
        rel = api(f"https://api.github.com/repos/{slug}/releases", tok, {
            "tag_name": tag,
            "name": release_title(version, channel),
            "body": notes,
            "draft": False,
            "prerelease": CHANNELS[channel]["prerelease"],
        })
    except urllib.error.HTTPError as e:
        raise SystemExit(f"could not create the release: {e.read().decode()[:400]}")

    print(f"  released  {rel['html_url']}")
    if CHANNELS[channel]["prerelease"]:
        print(f"  marked    pre-release — the Latest button still points at the last stable")

    try:
        url = (f"https://uploads.github.com/repos/{slug}/releases/{rel['id']}/assets"
               f"?name={urllib.parse.quote(upload_name, safe='')}")
        api(url, tok, asset.read_bytes(), "application/zip")
        print(f"  attached  {upload_name}  ({asset.stat().st_size // 1024} KB)")
    except urllib.error.HTTPError as e:
        print(f"  asset upload FAILED: {e.read().decode()[:300]}")
        print(f"  attach it by hand: {asset}")


def promote(version, tag, notes):
    slug, tok = repo_slug(), token()
    if not slug or not tok:
        raise SystemExit("no GitHub credential — cannot promote")
    try:
        rel = api(f"https://api.github.com/repos/{slug}/releases/tags/{tag}", tok)
    except urllib.error.HTTPError:
        raise SystemExit(f"no GitHub release on tag {tag} to promote")
    if not rel.get("prerelease"):
        print(f"  {tag} is already a full release — nothing to do")
        return
    api(f"https://api.github.com/repos/{slug}/releases/{rel['id']}", tok, {
        "name": release_title(version, "stable"),
        "body": notes,
        "prerelease": False,
        "make_latest": "true",
    }, method="PATCH")
    print(f"  promoted  {rel['html_url']}")
    print(f"  the same file, the same tag — only the claim about it changed")


# ------------------------------------------------------------------------ main

def main():
    argv = sys.argv[1:]
    check_only = "--check" in argv or "--dry-run" in argv
    promoting = "--promote" in argv
    channel = "alpha" if "--alpha" in argv else "beta" if "--beta" in argv else "stable"
    if promoting:
        channel = "stable"

    verb = "promote" if promoting else f"release ({channel})"
    print(f"Admin+ - {verb}" + ("  [checking only]" if check_only else ""))

    version = check_version()
    if not version:
        return 1
    notes = check_changelog(version)
    if not promoting:
        check_tests()
        check_verify()
    check_played(version, channel)
    tag = check_git(version, promoting)

    head("summary")
    if problems:
        print(f"  {len(problems)} problem(s) — nothing was shipped")
        for p in problems:
            print(f"    - {p}")
        return 1
    for w in warnings:
        print(f"  warning: {w}")
    print(f"  v{version} is clear to ship as {channel}")
    if check_only:
        print("  (--check, so it was not)")
        return 0

    if promoting:
        head("github")
        promote(version, tag, notes)
        head("still yours to upload")
        print(f"  releases/Admin+ v{version}.mcaddon")
        print(f"  {CHANNELS['stable']['store']}")
        return 0

    head("building")
    run(sys.executable, str(ROOT / "mcpack.py"), check=True)
    print(f"  Admin+.mcaddon  {BUILD.stat().st_size // 1024} KB")
    run(sys.executable, str(ROOT / "tools/archive.py"), check=True)
    print(f"  archived  releases/Admin+ v{version}.mcaddon")

    head("tagging")
    run("git", "tag", "-a", tag, "-m", f"Admin+ {tag}"
        + (f" ({channel})" if channel != "stable" else ""), check=True)
    run("git", "push", "origin", tag, check=True)
    print(f"  {tag} pushed")

    head("github")
    publish(version, tag, notes, channel)

    head("still yours to upload")
    print(f"  releases/Admin+ v{version}.mcaddon")
    print(f"  {CHANNELS[channel]['store']}")
    if channel == "alpha":
        print("  MCPEDL mirrors CurseForge, so a CurseForge alpha is not a quiet one")
    else:
        print("  MCPEDL mirrors CurseForge; nothing to do there")
    if channel != "stable":
        print(f"\n  When it has been played: python tools/release.py --promote")
    return 0


if __name__ == "__main__":
    sys.exit(main())
