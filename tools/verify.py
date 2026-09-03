"""Full pre-release verification for Admin+. Reports problems, exits non-zero."""
import io, json, os, re, subprocess, sys, zipfile, hashlib, pathlib

os.chdir(pathlib.Path(__file__).resolve().parent.parent)
BP, RP = pathlib.Path("Admin+ BP"), pathlib.Path("Admin+ RP")
problems, notes = [], []

def head(t): print("\n" + t); print("-" * len(t))
def fail(t): problems.append(t); print("  PROBLEM  " + t)
def okline(t): print("  ok       " + t)
def note(t): notes.append(t); print("  note     " + t)

# ---------------------------------------------------------------- manifests
head("manifests")
mans = {}
for p in (BP / "manifest.json", RP / "manifest.json"):
    d = json.load(io.open(p, encoding="utf-8"))
    mans[p] = d
    vers = {tuple(d["header"]["version"])}
    for m in d.get("modules", []):
        vers.add(tuple(m["version"]))
    for dep in d.get("dependencies", []):
        if isinstance(dep.get("version"), list):
            vers.add(tuple(dep["version"]))
    if len(vers) != 1:
        fail(f"{p.name}: version arrays disagree {sorted(vers)}")
    else:
        okline(f"{p.parent.name}: every version array is {'.'.join(map(str, vers.pop()))}")
    if not d["header"].get("min_engine_version"):
        fail(f"{p.name}: no min_engine_version")

bpv = mans[BP / "manifest.json"]["header"]["version"]
rpv = mans[RP / "manifest.json"]["header"]["version"]
if bpv != rpv:
    fail(f"BP {bpv} and RP {rpv} disagree")
else:
    okline("BP and RP versions match")

for p, d in mans.items():
    name = d["header"]["name"]
    want = ".".join(map(str, d["header"]["version"]))
    if want not in name:
        fail(f"{p.parent.name}: pack name {name!r} does not carry version {want}")
    else:
        okline(f"{p.parent.name}: name shows v{want} in the pack list")

src = io.open(BP / "scripts/config.js", encoding="utf-8").read()
cv = re.search(r'ADMINPLUS_VERSION = "([\d.]+)"', src).group(1)
if cv != ".".join(map(str, bpv)):
    fail(f"config.js says {cv}, manifest says {'.'.join(map(str, bpv))}")
else:
    okline(f"config.js agrees: {cv}")

# uuid sanity: every uuid in both manifests distinct
uuids = []
for d in mans.values():
    uuids.append(d["header"]["uuid"])
    uuids += [m["uuid"] for m in d.get("modules", [])]
if len(uuids) != len(set(uuids)):
    fail("a UUID is reused between header/modules")
else:
    okline(f"{len(uuids)} UUIDs, all distinct")

# RP dependency points at the BP? (or vice versa)
deps = [dep.get("uuid") for d in mans.values() for dep in d.get("dependencies", []) if dep.get("uuid")]
okline(f"{len(deps)} pack-to-pack dependency link(s)")

# ------------------------------------------------------------------- syntax
head("javascript")
js = sorted(BP.rglob("*.js"))
bad = 0
for f in js:
    r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
    if r.returncode:
        fail(f"{f}: {r.stderr.strip().splitlines()[-1] if r.stderr else 'syntax error'}")
        bad += 1
if not bad:
    okline(f"{len(js)} scripts parse")

# imports resolve
missing = 0
for f in js:
    body = io.open(f, encoding="utf-8").read()
    for m in re.finditer(r'from\s+"(\.[^"]+)"', body):
        target = (f.parent / m.group(1)).resolve()
        if not target.exists():
            fail(f"{f.name} imports missing {m.group(1)}")
            missing += 1
if not missing:
    okline("every relative import resolves")

# ---------------------------------------------------------------------- json
head("json")
jf = sorted(list(BP.rglob("*.json")) + list(RP.rglob("*.json")))
bad = 0
for f in jf:
    try:
        json.load(io.open(f, encoding="utf-8"))
    except Exception as e:
        fail(f"{f}: {e}")
        bad += 1
if not bad:
    okline(f"{len(jf)} json files parse")

# --------------------------------------------------------------- mcfunctions
head("functions")
fns = sorted(BP.rglob("*.mcfunction"))
bad = 0
for f in fns:
    for i, line in enumerate(io.open(f, encoding="utf-8").read().splitlines(), 1):
        t = line.strip()
        if not t or t.startswith("#"):
            continue
        if re.search(r"(^|[ =,{])#", t):
            fail(f"{f.name}:{i} uses a Java-style #fakeplayer: {t[:60]}")
            bad += 1
if not bad:
    okline(f"{len(fns)} functions, no # targets")

tick = json.load(io.open(BP / "functions/tick.json", encoding="utf-8"))
for name in tick["values"]:
    if not (BP / "functions" / (name + ".mcfunction")).exists():
        fail(f"tick.json lists {name}, which does not exist")
    else:
        okline(f"tick.json -> {name} exists")

# referenced sub-functions exist
for f in fns:
    for m in re.finditer(r"(?m)^\s*(?:execute .*run )?function ([a-z0-9_/\-]+)", io.open(f, encoding="utf-8").read()):
        if not (BP / "functions" / (m.group(1) + ".mcfunction")).exists():
            fail(f"{f.name} calls function {m.group(1)}, which does not exist")

# ------------------------------------------------------------------ entities
head("entities & assets")
for f in sorted(BP.glob("entities/*.json")):
    d = json.load(io.open(f, encoding="utf-8"))
    ident = d["minecraft:entity"]["description"]["identifier"]
    used = any(ident in io.open(j, encoding="utf-8").read() for j in js)
    okline(f"{ident} {'referenced by scripts' if used else 'NOT referenced'}")
    if not used:
        fail(f"{ident} is shipped but nothing uses it")

# textures referenced by the UI exist (ours only; vanilla paths are fine)
ui_files = list(RP.glob("ui/*.json"))
for f in ui_files:
    body = io.open(f, encoding="utf-8").read()
    for m in re.finditer(r'"(textures/ui/[a-z0-9_]+)"', body):
        p = RP / (m.group(1) + ".png")
        if not p.exists():
            note(f"{f.name} -> {m.group(1)} not in our pack (vanilla fallback assumed)")

# ------------------------------------------------------------------ commands
head("commands")
LIMIT = 8
cmds = []
for f in js:
    body = io.open(f, encoding="utf-8").read()
    for m in re.finditer(r"command\(\{(.*?)\n\}\)", body, re.S):
        blk = m.group(1)
        name = re.search(r'name:\s*"([^"]+)"', blk)
        if not name:
            continue
        def n(kind):
            b = re.search(kind + r":\s*\[(.*?)\]", blk, re.S)
            return len(re.findall(r"\{\s*name:", b.group(1))) if b else 0
        total = n("mandatory") + n("optional")
        if "EXTRA_WORDS" in blk:
            total = 2 + int(re.search(r"const EXTRA_WORDS = (\d+)", body).group(1))
        cmds.append((name.group(1), total))
        if total > LIMIT:
            fail(f"/{name.group(1)} declares {total} parameters; Bedrock allows {LIMIT}")
dupes = [c for c in {n for n, _ in cmds} if [n for n, _ in cmds].count(c) > 1]
if dupes:
    fail(f"duplicate command names: {dupes}")
okline(f"{len(cmds)} commands, max {max(t for _, t in cmds)} parameters, no duplicates")

# ------------------------------------------------------------------ packaging
head("packaging")
subprocess.run([sys.executable, "mcpack.py"], capture_output=True)
z = zipfile.ZipFile("Admin+.mcaddon")
names = z.namelist()
okline(f"mcaddon holds {len(names)} files")
for needed in ("Admin+ BP/manifest.json", "Admin+ RP/manifest.json",
               "Admin+ BP/scripts/main.js", "Admin+ BP/functions/tick.json",
               "Admin+ BP/entities/floating_text.json", "Admin+ RP/ui/server_form.json"):
    if needed not in names:
        fail(f"mcaddon is missing {needed}")
if not any(n.endswith("pack_icon.png") for n in names):
    fail("no pack_icon.png in the mcaddon")
else:
    okline("pack icons present")
bad = z.testzip()
if bad:
    fail(f"corrupt entry in the mcaddon: {bad}")
else:
    okline("archive integrity ok")
junk = [n for n in names if "/node_modules/" in n or n.endswith(".pyc") or "/.git" in n]
if junk:
    fail(f"junk shipped: {junk[:3]}")
else:
    okline("no node_modules, .git or build junk shipped")

# ------------------------------------------------------------------ deployed
head("deployed copy")
dst = pathlib.Path(os.environ["APPDATA"]) / "Minecraft Bedrock/Users/Shared/games/com.mojang/behavior_packs/Admin+BP"
if dst.exists():
    dv = json.load(io.open(dst / "manifest.json", encoding="utf-8"))["header"]["version"]
    same = dv == bpv
    (okline if same else note)(
        f"deployed {'.'.join(map(str, dv))} vs source {'.'.join(map(str, bpv))}"
        + ("" if same else " — NOT yet deployed"))
else:
    note("no deployed copy found")

# ---------------------------------------------------------------------- done
head("summary")
print(f"  {len(problems)} problems, {len(notes)} notes")
sys.exit(1 if problems else 0)
