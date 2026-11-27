"""The label check: a person rates a sample of chat lines, on this PC.

    python tools/toxicity/review.py            # open the page and label (the user runs this)
    python tools/toxicity/review.py sample     # pick the lines to check (counts only)
    python tools/toxicity/review.py report     # how the labeller and the model did (counts only)

Why: on the server's own chat the model and the local labeller (Qwen 2.5 VL
7B) disagree, and only a person can say which is right. The user chose to
check the lines themselves, on a page that stays on this PC (2026-11-26).

The sample (research notes, Obsidian > Admin+ > Research, llm_labelling.md,
section 4): 300 random lines for the whole archive in miniature; for every
model compared (--scores, from tools/toxicity/score_archive.mjs), every line
it would hold at High and the 25 highest of each output that can hold; every
line the labeller rated clear or severe, and up to 40 mild ones per
category; and every line the word list holds. Shuffled, so no slice
can be told from another, and label blind: the page shows neither model's
answer.

The page shows one line at a time, with up to four earlier lines of the same
session. Keys: 0 fine, W only swearing, 1 mild, 2 clear, 3 severe, U can't
tell. After 1 to 3: the kind (D discrimination, S sexual, H hostility,
W swearing, O something else), who it's aimed at (N, P, G), then Enter.
Answers save as they're given, to notes/chat-archive/labels/human-check-v1.jsonl,
so stopping and coming back loses nothing.

Privacy: the server listens on 127.0.0.1 only and refuses any other Host
header, the page loads nothing from the internet, and the console prints
counts only. Other players wrote the archive; it never leaves this PC.
"""
import argparse
import json
import random
import re
import statistics
import sys
import webbrowser
from collections import Counter, defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
LABELS = ROOT / "notes" / "chat-archive" / "labels"
KEYS = ["toxic", "discrimination", "sexual", "hostility", "profanity"]
LEVELS = ["low", "medium", "high"]
CONTEXT = 4
SEED = 20261126
SAMPLE_VERSION = 1
KIND_OF = {"D": "discrimination", "S": "sexual", "H": "hostility", "W": "profanity"}


def read_jsonl(path):
    if not path.exists():
        return []
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:   # a line being written right now
                    continue
    return out


def key_of(row):
    return f"{row['source']}:{row['line']}"


def plain(text):
    """Chat text as a player saw it: colour codes taken out."""
    return re.sub("§.", "", str(text or ""))


def latest(path):
    """The last answer for each line: going back to change one appends a new record."""
    out = {}
    for r in read_jsonl(path):
        out[r["key"]] = r
    return out


# ------------------------------------------------------------------ sample

def meta_of(scores_path):
    return json.loads(scores_path.with_suffix("").with_suffix(".meta.json").read_text(encoding="utf-8"))


def make_sample(a):
    rows = read_jsonl(a.archive)
    keys = [key_of(r) for r in rows]
    where = {k: i for i, k in enumerate(keys)}
    teacher = {r["key"]: r["labels"] for r in read_jsonl(a.teacher) if r.get("ok")}
    rng = random.Random(SEED)

    slices = defaultdict(set)
    slices["random"] = set(rng.sample(keys, min(300, len(keys))))
    # Every model compared: all it would hold at High, and its top 25 per
    # output that can hold. So each model's held lines are ALL checked, and
    # the report's precision for each is exact.
    names = []
    for path in a.scores:
        scores = {r["key"]: r for r in read_jsonl(path)}
        meta = meta_of(path)
        names.append(meta["name"])
        for k in keys:
            if scores.get(k, {}).get("held"):
                slices["model"].add(k)
        for name in meta["holds"]:
            j = meta["outputs"].index(name)
            top = sorted((k for k in keys if k in scores), key=lambda k: -scores[k]["s"][j])[:25]
            slices["model"].update(top)
        for k in keys:
            if scores.get(k, {}).get("list"):
                slices["wordlist"].add(k)
    for k in keys:
        lab = teacher.get(k)
        if lab and any(lab.get(c, 0) >= 2 for c in KEYS):
            slices["teacher"].add(k)
    for c in KEYS:
        mild = [k for k in keys if teacher.get(k, {}).get(c) == 1]
        slices["teacher"].update(rng.sample(mild, min(40, len(mild))))

    chosen = sorted(set().union(*slices.values()), key=where.get)
    rng.shuffle(chosen)
    items = [{"key": k, "slices": sorted(s for s, ks in slices.items() if k in ks)} for k in chosen]
    a.sample.parent.mkdir(parents=True, exist_ok=True)
    a.sample.write_text(json.dumps({
        "version": SAMPLE_VERSION, "made": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "models": names, "teacher": a.teacher.name, "items": items
    }, indent=1) + "\n", encoding="utf-8")
    print(f"{len(rows):,} archive lines; {len(teacher):,} with the labeller's answer; models: {', '.join(names)}")
    for name in ["random", "model", "teacher", "wordlist"]:
        print(f"   {name:9} {len(slices[name]):4} lines")
    print(f"{len(items)} lines to check, after overlaps -> {a.sample}")
    print(f"at about 3 seconds a line, roughly {round(len(items) * 3 / 60)} minutes")


# ------------------------------------------------------------------- serve

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label check</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1d1d1b; --muted: #6b6a66; --line: #d9d6cf; --card: #ffffff;
        --accent: #2f6f5e; --pick: #1d1d1b; --pickfg: #ffffff; --warn: #9a3b2e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #151514; --fg: #ecebe7; --muted: #9c9a94; --line: #34332f; --card: #1f1f1d;
          --accent: #7cc4ae; --pick: #ecebe7; --pickfg: #151514; --warn: #e5927f; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 28px 24px 48px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
h1 { font-size: 18px; margin: 0; font-weight: 600; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 14px; }
.bar { height: 4px; background: var(--line); border-radius: 2px; margin: 12px 0 28px; overflow: hidden; }
.bar > div { height: 100%; background: var(--accent); width: 0; transition: width .2s; }
.context { color: var(--muted); font-size: 15px; margin-bottom: 10px; }
.context div { white-space: pre-wrap; overflow-wrap: anywhere; }
.context .none { font-style: italic; }
.name { font-weight: 600; }
.target { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 20px 24px;
          font-size: 26px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; }
.target .name { font-size: 15px; display: block; color: var(--muted); margin-bottom: 4px; }
section { margin-top: 22px; }
.q { font-size: 14px; color: var(--muted); margin-bottom: 8px; }
.keys { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; font-size: 15px; color: var(--fg); background: var(--card); border: 1px solid var(--line);
         border-radius: 8px; padding: 8px 12px; cursor: pointer; }
button:hover { border-color: var(--muted); }
kbd { font: 600 13px ui-monospace, Consolas, monospace; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
button kbd { margin-right: 6px; }
button.on { background: var(--pick); color: var(--pickfg); border-color: var(--pick); }
button.on kbd { border-color: var(--pickfg); }
button.go { border-color: var(--accent); }
[hidden] { display: none !important; }
.hint { color: var(--muted); font-size: 13px; margin-top: 12px; }
.note { color: var(--accent); font-size: 14px; margin-top: 14px; min-height: 1.4em; }
.note.error { color: var(--warn); }
details { margin-top: 32px; color: var(--muted); font-size: 14px; }
details li { margin: 4px 0; }
.done { font-size: 20px; padding: 32px 0; }
</style>
</head>
<body>
<main>
<header><h1>Label check</h1><div class="count" id="count">Loading</div></header>
<div class="bar"><div id="bar"></div></div>
<div id="work" hidden>
  <div class="context" id="context"></div>
  <div class="target" id="target"></div>
  <section>
    <div class="q">How much would a moderator want to see this line?</div>
    <div class="keys" id="step1">
      <button data-a="0"><kbd>0</kbd>Fine</button>
      <button data-a="W"><kbd>W</kbd>Only swearing</button>
      <button data-a="1"><kbd>1</kbd>Mild</button>
      <button data-a="2"><kbd>2</kbd>Clear</button>
      <button data-a="3"><kbd>3</kbd>Severe</button>
      <button data-a="U"><kbd>U</kbd>Can't tell</button>
    </div>
  </section>
  <section id="step2" hidden>
    <div class="q">What kind? Press every one that fits.</div>
    <div class="keys" id="kinds">
      <button data-k="D"><kbd>D</kbd>Discrimination</button>
      <button data-k="S"><kbd>S</kbd>Sexual</button>
      <button data-k="H"><kbd>H</kbd>Hostility</button>
      <button data-k="W"><kbd>W</kbd>Swearing</button>
      <button data-k="O"><kbd>O</kbd>Something else</button>
    </div>
    <div class="q" style="margin-top:14px">Aimed at</div>
    <div class="keys" id="aimed">
      <button data-t="none"><kbd>N</kbd>No one</button>
      <button data-t="player"><kbd>P</kbd>A player</button>
      <button data-t="group"><kbd>G</kbd>A group</button>
    </div>
    <div class="keys" style="margin-top:14px"><button class="go" id="save"><kbd>Enter</kbd>Save and go on</button></div>
    <div class="hint"><kbd>Esc</kbd> goes back to the first question.</div>
  </section>
  <div class="note" id="note"></div>
  <div class="hint"><kbd>&larr;</kbd> previous line &nbsp; <kbd>&rarr;</kbd> next line. Every answer saves at once, so you can close this tab and come back later.</div>
</div>
<div id="finished" class="done" hidden>
  Every line is checked. Thank you. You can close this tab and tell Claude it's done.
  <div class="keys" style="margin-top:16px"><button id="review">Look back over your answers</button></div>
</div>
<details>
  <summary>How to rate</summary>
  <ul>
    <li><b>Judge only the big line.</b> The grey lines above it are the same session's earlier chat, for context.</li>
    <li><b>0 Fine:</b> nothing a moderator needs to see.</li>
    <li><b>W Only swearing:</b> swear words and nothing else, like cursing at lava or lag.</li>
    <li><b>1 Mild:</b> rude, or friendly trash talk both sides are joking about. Not worth acting on.</li>
    <li><b>2 Clear:</b> an insult, threat or harassment aimed at someone, a slur, or sexual content a moderator would act on.</li>
    <li><b>3 Severe:</b> hateful slurs, real threats, telling someone to hurt or kill themselves, sexual harassment.</li>
    <li><b>Game talk isn't a threat:</b> killing mobs, "kill the wither", PvP talk like "1v1 me" or "you're dead".</li>
    <li><b>Dying, losing and raging at bad luck</b> aren't hostility.</li>
    <li>Not sure? Press <kbd>U</kbd>. A quick honest answer beats a slow perfect one.</li>
  </ul>
</details>
</main>
<script>
const $ = id => document.getElementById(id)
const NAMES = { "0": "Fine", W: "Only swearing", "1": "Mild", "2": "Clear", "3": "Severe", U: "Can't tell" }
const KINDS = { D: "discrimination", S: "sexual", H: "hostility", W: "swearing", O: "something else" }
const AIMED = { none: "aimed at no one", player: "aimed at a player", group: "aimed at a group" }
let cur = null, answer = null, kinds = new Set(), aimed = "none", shownAt = 0, busy = false, total = 0

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  if (!r.ok) throw new Error("The page couldn't reach the label check (" + r.status + "). Is it still running in its window?")
  return r.json()
}

function note(text, error) { const n = $("note"); n.textContent = text || ""; n.className = error ? "note error" : "note" }

function progress(done, pace) {
  $("bar").style.width = (total ? 100 * done / total : 0) + "%"
  const left = total - done
  let text = (cur ? "Line " + (cur.i + 1) + " of " + total : total + " lines") + " · " + done + " done"
  if (pace && left > 0) text += " · about " + Math.max(1, Math.round(left * pace / 60000)) + " min left"
  $("count").textContent = text
}

function mark(selector, on) { for (const b of document.querySelectorAll(selector)) b.classList.toggle("on", on(b)) }
function paintStep2() {
  mark("#kinds button", b => kinds.has(b.dataset.k))
  mark("#aimed button", b => b.dataset.t === aimed)
}

function describe(saved) {
  if (!saved) return ""
  let text = NAMES[saved.answer] || saved.answer
  const k = (saved.kinds || []).map(x => KINDS[x]).filter(Boolean)
  if (k.length) text += ", " + k.join(", ")
  if (["1", "2", "3"].includes(saved.answer)) text += ", " + AIMED[saved.aimed || "none"]
  return text
}

function textLine(name, message) {
  const d = document.createElement("div")
  const n = document.createElement("span")
  n.className = "name"
  n.textContent = name
  d.append(n, document.createTextNode(message))
  return d
}

function show(item) {
  cur = item
  answer = null
  kinds = new Set()
  aimed = "none"
  $("step2").hidden = true
  const ctx = $("context")
  ctx.replaceChildren()
  if (!item.context.length) {
    const d = document.createElement("div")
    d.className = "none"
    d.textContent = "The first line of its session."
    ctx.append(d)
  }
  for (const c of item.context) ctx.append(textLine(c.name + ": ", c.message))
  const t = $("target")
  t.replaceChildren()
  const n = document.createElement("span")
  n.className = "name"
  n.textContent = item.target.name
  t.append(n, document.createTextNode(item.target.message))
  mark("#step1 button", b => !!item.saved && b.dataset.a === item.saved.answer)
  note(item.saved ? "Already answered: " + describe(item.saved) + ". Answer again to change it." : "")
  $("work").hidden = false
  $("finished").hidden = true
  shownAt = performance.now()
  progress(item.done, item.pace)
}

async function go(i) {
  if (busy) return
  busy = true
  try { show(await api("/api/item?i=" + (((i % total) + total) % total))) }
  catch (e) { note(e.message, true) }
  finally { busy = false }
}

function pick(a) {
  answer = a
  mark("#step1 button", b => b.dataset.a === a)
  if (cur.saved && ["1", "2", "3"].includes(cur.saved.answer) && kinds.size === 0) {
    kinds = new Set(cur.saved.kinds || [])
    aimed = cur.saved.aimed || "none"
  }
  $("step2").hidden = false
  paintStep2()
}

function unpick() {
  answer = null
  $("step2").hidden = true
  mark("#step1 button", b => !!cur.saved && b.dataset.a === cur.saved.answer)
}

async function save(a) {
  if (busy || !cur) return
  busy = true
  const body = { i: cur.i, key: cur.key, answer: a, kinds: ["1", "2", "3"].includes(a) ? [...kinds] : [],
                 aimed: ["1", "2", "3"].includes(a) ? aimed : "none", ms: Math.round(performance.now() - shownAt) }
  let r
  try { r = await api("/api/label", body) }
  catch (e) { note(e.message, true); busy = false; return }
  busy = false
  if (r.next < 0) return finish(r)
  return go(r.next)
}

function finish(r) {
  cur = null
  $("work").hidden = true
  $("finished").hidden = false
  progress(r.done, 0)
}

document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || !cur) return
  // While the next line loads, a key would land on the one just answered.
  if (busy) { e.preventDefault(); return }
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (k === "ArrowLeft") { e.preventDefault(); return go(cur.i - 1) }
  if (k === "ArrowRight") { e.preventDefault(); return go(cur.i + 1) }
  if (answer === null) {
    if (["0", "W", "U"].includes(k)) return save(k)
    if (["1", "2", "3"].includes(k)) return pick(k)
    return
  }
  if (k === "Escape") return unpick()
  if (k === "Enter") { e.preventDefault(); return save(answer) }
  if (["1", "2", "3"].includes(k)) return pick(k)
  if (k === "0" || k === "U") return save(k)
  if (KINDS[k]) { kinds.has(k) ? kinds.delete(k) : kinds.add(k); return paintStep2() }
  if (k === "N") { aimed = "none"; return paintStep2() }
  if (k === "P") { aimed = "player"; return paintStep2() }
  if (k === "G") { aimed = "group"; return paintStep2() }
})

for (const b of document.querySelectorAll("#step1 button")) b.addEventListener("click", () => {
  if (!cur || busy) return
  const a = b.dataset.a
  return ["1", "2", "3"].includes(a) ? pick(a) : save(a)
})
for (const b of document.querySelectorAll("#kinds button")) b.addEventListener("click", () => {
  const k = b.dataset.k
  kinds.has(k) ? kinds.delete(k) : kinds.add(k)
  paintStep2()
})
for (const b of document.querySelectorAll("#aimed button")) b.addEventListener("click", () => { aimed = b.dataset.t; paintStep2() })
$("save").addEventListener("click", () => answer && save(answer))
$("review").addEventListener("click", () => go(0))

;(async () => {
  try {
    const s = await api("/api/start")
    total = s.total
    if (!total) { $("count").textContent = "There are no lines to check."; return }
    if (s.next < 0) return finish(s)
    go(s.next)
  } catch (e) { $("count").textContent = e.message }
})()
</script>
</body>
</html>
"""


def labels_for(answer, kinds, aimed):
    """A page answer in the labeller's own shape, so the two compare directly."""
    labels = dict.fromkeys(KEYS, 0)
    labels["aimed"] = "none"
    if answer == "W":
        labels["profanity"] = 1
    elif answer in ("1", "2", "3"):
        sev = int(answer)
        labels["toxic"] = sev
        for k in kinds:
            if k in KIND_OF:
                labels[KIND_OF[k]] = sev
        labels["aimed"] = aimed if aimed in ("none", "player", "group") else "none"
    return labels


class Check:
    """The sample, the archive and the answers, held for the page."""

    def __init__(self, a):
        self.a = a
        self.rows = read_jsonl(a.archive)
        self.where = {key_of(r): i for i, r in enumerate(self.rows)}
        sample = json.loads(a.sample.read_text(encoding="utf-8"))
        self.items = [it for it in sample["items"] if it["key"] in self.where]
        self.answers = latest(a.human)

    def done(self):
        return sum(1 for it in self.items if it["key"] in self.answers)

    def pace(self):
        """Milliseconds a line, from the last 50 answers, a long break counted as a minute."""
        recent = [min(int(r.get("ms") or 0), 60000) for r in list(self.answers.values())[-50:] if r.get("ms")]
        return int(statistics.median(recent)) if recent else 3000

    def next_after(self, i):
        n = len(self.items)
        for step in range(1, n + 1):
            j = (i + step) % n
            if self.items[j]["key"] not in self.answers:
                return j
        return -1

    def item(self, i):
        key = self.items[i]["key"]
        at = self.where[key]
        row = self.rows[at]
        context = [self.rows[j] for j in range(max(0, at - CONTEXT), at) if self.rows[j]["source"] == row["source"]]
        saved = self.answers.get(key)
        return {
            "i": i, "total": len(self.items), "done": self.done(), "pace": self.pace(), "key": key,
            "context": [{"name": c.get("name", "?"), "message": plain(c.get("message"))} for c in context],
            "target": {"name": row.get("name", "?"), "message": plain(row.get("message"))},
            "saved": {"answer": saved["answer"], "kinds": saved.get("kinds", []), "aimed": saved.get("aimed", "none")} if saved else None,
        }

    def save(self, body):
        i, key, answer = int(body["i"]), str(body["key"]), str(body["answer"])
        if not (0 <= i < len(self.items)) or self.items[i]["key"] != key or answer not in ("0", "W", "1", "2", "3", "U"):
            raise ValueError("that answer doesn't match a line in the sample")
        kinds = sorted({str(k) for k in body.get("kinds", []) if str(k) in "DSHWO" and len(str(k)) == 1})
        aimed = str(body.get("aimed", "none"))
        record = {
            "key": key, "answer": answer, "kinds": kinds, "aimed": aimed if answer in ("1", "2", "3") else "none",
            "unsure": answer == "U", "labels": None if answer == "U" else labels_for(answer, kinds, aimed),
            "ms": max(0, int(body.get("ms") or 0)), "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "sample": SAMPLE_VERSION,
        }
        self.a.human.parent.mkdir(parents=True, exist_ok=True)
        with open(self.a.human, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps(record, ensure_ascii=True) + "\n")
        self.answers.pop(key, None)       # keep the newest last, for the pace
        self.answers[key] = record
        return {"done": self.done(), "total": len(self.items), "next": self.next_after(i)}


def serve(a):
    check = Check(a)
    if not check.items:
        print("No sample yet. Ask Claude to run: python tools/toxicity/review.py sample")
        return
    allowed = {f"127.0.0.1:{a.port}", f"localhost:{a.port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):   # paths only, but keep the console to counts
            pass

        def send(self, code, body, kind="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(data)

        def guarded(self):
            # Only this PC's own browser, by the address it was given: a page
            # elsewhere can't reach the archive by renaming itself.
            if self.headers.get("Host") not in allowed:
                self.send(403, {"error": "this page only answers on 127.0.0.1"})
                return False
            return True

        def do_GET(self):
            if not self.guarded():
                return
            url = urlparse(self.path)
            if url.path == "/":
                return self.send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
            if url.path == "/api/start":
                done = check.done()
                nxt = -1 if done >= len(check.items) else (check.next_after(-1))
                return self.send(200, {"total": len(check.items), "done": done, "next": nxt})
            if url.path == "/api/item":
                try:
                    i = int(parse_qs(url.query).get("i", ["0"])[0])
                    return self.send(200, check.item(i % len(check.items)))
                except (ValueError, IndexError):
                    return self.send(400, {"error": "no such line"})
            self.send(404, {"error": "not found"})

        def do_POST(self):
            if not self.guarded():
                return
            if urlparse(self.path).path != "/api/label":
                return self.send(404, {"error": "not found"})
            try:
                size = int(self.headers.get("Content-Length") or 0)
                if size > 10000:
                    raise ValueError("too big")
                return self.send(200, check.save(json.loads(self.rfile.read(size) or b"{}")))
            except (ValueError, KeyError, json.JSONDecodeError) as e:
                return self.send(400, {"error": str(e)})

    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    url = f"http://127.0.0.1:{a.port}/"
    print(f"Label check: {check.done()} of {len(check.items)} lines done.")
    print(f"Open {url} in your browser. It stays on this PC.")
    print("Press Ctrl+C here to stop. Every answer is already saved.")
    if not a.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print(f"Stopped at {check.done()} of {len(check.items)} lines.")


# ------------------------------------------------------------------ report

def kappa(pairs):
    """Cohen's kappa for yes/no pairs, with raw agreement. None when undefined."""
    n = len(pairs)
    if not n:
        return None, None
    tp = sum(1 for x, y in pairs if x and y)
    tn = sum(1 for x, y in pairs if not x and not y)
    fp = sum(1 for x, y in pairs if x and not y)
    fn = sum(1 for x, y in pairs if not x and y)
    po = (tp + tn) / n
    pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n)
    return (None if pe == 1 else (po - pe) / (1 - pe)), po


def pr(pairs):
    """Precision and recall of the first against the second, with the counts."""
    tp = sum(1 for x, y in pairs if x and y)
    flagged = sum(1 for x, _ in pairs if x)
    real = sum(1 for _, y in pairs if y)
    return tp, flagged, real


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else "-"


def report(a):
    sample = json.loads(a.sample.read_text(encoding="utf-8"))
    human = {k: r for k, r in latest(a.human).items() if not r.get("unsure") and r.get("labels")}
    unsure = sum(1 for r in latest(a.human).values() if r.get("unsure"))
    teacher = {r["key"]: r["labels"] for r in read_jsonl(a.teacher) if r.get("ok")}
    # One entry per model compared: its scores and what they mean.
    models = [(meta_of(path), {r["key"]: r for r in read_jsonl(path)}) for path in a.scores]
    holds = models[0][0]["holds"]
    first = models[0][1]
    items = [it for it in sample["items"] if it["key"] in human]
    in_slice = defaultdict(list)
    for it in items:
        for s in it["slices"]:
            in_slice[s].append(it["key"])
    total = len(sample["items"])
    print(f"Checked {len(items)} of {total} lines ({unsure} marked can't tell). Slices: "
          + ", ".join(f"{s} {len(in_slice[s])}" for s in ["random", "model", "teacher", "wordlist"]))
    if not items:
        return

    hold_cats = [c for c in holds]
    person = {k: {c: human[k]["labels"][c] >= 2 for c in KEYS} for k in human}
    for k in person:
        person[k]["any"] = any(person[k][c] for c in hold_cats)
    held_rank = {"low": 0, "medium": 1, "high": 2}

    def model_holds(model, k, level, output=None):
        meta, scores = model
        r = scores.get(k)
        if not r:
            return False
        if output is None:
            return bool(r["held"]) and held_rank[r["held"]] <= held_rank[level]
        line = (meta["levels"].get(output) or {}).get(level)
        return line is not None and r["s"][meta["outputs"].index(output)] >= line

    def list_holds(k, output=None):
        cat = first.get(k, {}).get("list", "")
        wanted = {"discrimination": "discrimination", "sexual": "sexual", "hostility": "aggression", "profanity": "profanity"}
        if output is None:
            return cat in ("discrimination", "sexual", "aggression")
        return cat == wanted[output]

    keys = [it["key"] for it in items]
    rand = in_slice["random"]

    print("\nHow often a person says a line should be held (clear or severe), on the random lines:")
    print(f"   any of {', '.join(hold_cats)}: {sum(person[k]['any'] for k in rand)} of {len(rand)}"
          f" ({pct(sum(person[k]['any'] for k in rand), len(rand))})")
    for c in KEYS:
        print(f"   {c:15} {sum(person[k][c] for k in rand):4} of {len(rand)}")

    print("\nThe labeller against the person, clear or severe (2+), every checked line:")
    print("   category        flagged  right  precision  person's  caught  recall  kappa  agreement")
    for c in KEYS:
        pairs = [(teacher.get(k, {}).get(c, 0) >= 2, person[k][c]) for k in keys if k in teacher]
        tp, flagged, real = pr(pairs)
        kp, po = kappa(pairs)
        print(f"   {c:15} {flagged:7} {tp:6}  {pct(tp, flagged):>9}  {real:8} {tp:7}  {pct(tp, real):>6}"
              f"  {('-' if kp is None else f'{kp:.2f}'):>5}  {pct(po * len(pairs), len(pairs)) if po is not None else '-':>9}")

    print("\nThe labeller's severity (rows) against the person's (columns), toxic:")
    grid = Counter((teacher[k]["toxic"], human[k]["labels"]["toxic"]) for k in keys if k in teacher)
    print("        " + "".join(f"{p:>6}" for p in range(4)))
    for t in range(4):
        print(f"   {t:>3}  " + "".join(f"{grid[(t, p)]:6}" for p in range(4)))

    print("\nThe models and the word list, against the person. Held lines are complete (every")
    print("line any of them would hold is in the sample), so precision is exact; recall is")
    print("over the random lines a person says should be held, so it's rough.")
    real_rand = [k for k in rand if person[k]["any"]]
    print("   who                            held  right  precision   random: caught of " + str(len(real_rand)))
    for model in models:
        for level in LEVELS:
            held = [k for k in keys if model_holds(model, k, level)]
            right = sum(person[k]["any"] for k in held)
            caught = sum(1 for k in real_rand if model_holds(model, k, level))
            print(f"   {model[0]['name']:16} {level:12} {len(held):5} {right:6}  {pct(right, len(held)):>9}   {caught:>14}")
    held = [k for k in keys if list_holds(k)]
    right = sum(person[k]["any"] for k in held)
    caught = sum(1 for k in real_rand if list_holds(k))
    print(f"   {'word list':29} {len(held):5} {right:6}  {pct(right, len(held)):>9}   {caught:>14}")

    print("\nEach model's outputs, one at a time (held for that output / right for that output):")
    for model in models:
        for output in hold_cats:
            cells = []
            for level in LEVELS:
                held = [k for k in keys if model_holds(model, k, level, output)]
                right = sum(person[k][output] for k in held)
                cells.append(f"{level} {right}/{len(held)}")
            print(f"   {model[0]['name']:16} {output:15} " + "   ".join(cells))

    print("\nLines a person says should be held that each one misses, every checked line:")
    real_all = [k for k in keys if person[k]["any"]]
    print(f"   a person says hold: {len(real_all)}")
    for model in models:
        for level in LEVELS:
            print(f"   {model[0]['name']:16} {level:7} misses {sum(1 for k in real_all if not model_holds(model, k, level))}")
    print(f"   word list                misses {sum(1 for k in real_all if not list_holds(k))}")
    print(f"   labeller (2+)            misses {sum(1 for k in real_all if k in teacher and not any(teacher[k].get(c, 0) >= 2 for c in hold_cats))}")


def main():
    ap = argparse.ArgumentParser(description="The label check: a person rates a sample of chat lines, on this PC.")
    ap.add_argument("what", nargs="?", default="serve", choices=["serve", "sample", "report"])
    ap.add_argument("--archive", type=Path, default=ROOT / "notes" / "chat-archive" / "chat.jsonl")
    ap.add_argument("--teacher", type=Path, default=LABELS / "qwen2.5vl-7b-p1.jsonl")
    # Every model to compare; the sample covers what each would hold.
    ap.add_argument("--scores", type=Path, nargs="+",
                    default=[LABELS / "scores-b16-e2-bpsn.jsonl", LABELS / "scores-b16-e2-game2.jsonl"])
    ap.add_argument("--sample", type=Path, default=LABELS / f"human-sample-v{SAMPLE_VERSION}.json")
    ap.add_argument("--human", type=Path, default=LABELS / f"human-check-v{SAMPLE_VERSION}.jsonl")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    if a.what == "sample":
        make_sample(a)
    elif a.what == "report":
        report(a)
    else:
        serve(a)


if __name__ == "__main__":
    sys.exit(main())
