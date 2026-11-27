"""Turn the labelled chat archive into one PRIVATE file with folds.

    python tools/toxicity/prep_archive.py [labels file] [out dir]

Defaults: notes/chat-archive/labels/qwen2.5vl-7b-p1.jsonl and
C:/Users/gabri/Datasets/admin-plus-toxicity/private (outside the repo and
outside OneDrive). Writes archive_all.jsonl in the same shape as
prepared/*.jsonl, plus "f", a fold number from 0 to 4.

Every line of one session (the content-log file it came from) gets the same
fold, and train.py --folds trains one model per fold with that fold held out,
so every archive line is scored by a model that never saw its session.
Flagged lines bunch up in a few sessions, so sessions are dealt out to give
each fold about the same number of flagged lines, then of lines.

Severity becomes a soft label: 0 none = 0, 1 mild = 0.3, 2 clear = 0.8,
3 severe = 1, so "flagged" (0.5 or more) means clear or severe.

Other players wrote the archive. It stays on this PC, this file stays out of
git, and this prints counts only, never a line.
"""
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
labels_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "notes" / "chat-archive" / "labels" / "qwen2.5vl-7b-p1.jsonl"
out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("C:/Users/gabri/Datasets/admin-plus-toxicity/private")
archive = ROOT / "notes" / "chat-archive" / "chat.jsonl"
KEYS = ["toxic", "discrimination", "sexual", "hostility", "profanity"]
SOFT = {0: 0.0, 1: 0.3, 2: 0.8, 3: 1.0}
FOLDS = 5

if str(out_dir.resolve()).lower().startswith(str(ROOT.resolve()).lower()):
    sys.exit("refusing to write the archive inside the repo")
out_dir.mkdir(parents=True, exist_ok=True)

rows = [json.loads(l) for l in archive.read_text(encoding="utf-8").splitlines() if l.strip()]
labels = {}
for l in labels_path.read_text(encoding="utf-8").splitlines():
    if l.strip():
        try:
            r = json.loads(l)
        except json.JSONDecodeError:   # a line still being written by the labeller
            continue
        if r.get("ok"):
            labels[r["key"]] = r["labels"]

by_source = defaultdict(list)
for r in rows:
    key = f"{r['source']}:{r['line']}"
    if key in labels and str(r.get("message", "")).strip():
        lab = labels[key]
        by_source[r["source"]].append({"id": key, "s": "arc", "t": r["message"],
                                       "y": [SOFT[int(lab[k])] for k in KEYS], "w": 1.0,
                                       "aimed": lab.get("aimed")})


def flagged(items):
    return sum(any(v >= 0.5 for v in it["y"]) for it in items)


# Most-flagged sessions first, each to the fold with the fewest flagged lines so far.
fold_flags, fold_lines, fold_of = [0] * FOLDS, [0] * FOLDS, {}
for s in sorted(by_source, key=lambda s: (-flagged(by_source[s]), -len(by_source[s]), s)):
    f = min(range(FOLDS), key=lambda i: (fold_flags[i], fold_lines[i]))
    fold_of[s] = f
    fold_flags[f] += flagged(by_source[s])
    fold_lines[f] += len(by_source[s])

out = []
for s, items in by_source.items():
    for it in items:
        it["f"] = fold_of[s]
        out.append(it)
random.Random(20261126).shuffle(out)
with open(out_dir / "archive_all.jsonl", "w", encoding="utf-8", newline="\n") as fh:
    for r in out:
        fh.write(json.dumps(r, ensure_ascii=True) + "\n")

for f in range(FOLDS):
    items = [r for r in out if r["f"] == f]
    counts = {k: sum(r["y"][i] >= 0.5 for r in items) for i, k in enumerate(KEYS)}
    sessions = sum(1 for s in fold_of if fold_of[s] == f)
    print(f"fold {f}: {len(items):,} lines from {sessions} sessions; clear or severe: {counts}")
print(f"{len(out):,} lines with labels, of {len(rows):,} in the archive")
