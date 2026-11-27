"""A small window showing how far the archive labelling has got.

    pythonw tools/toxicity/watch_labels.py [labels file]
    python tools/toxicity/watch_labels.py --once      # print the same numbers and exit

Counts only. It reads the labeller's output (severities and timings) and
counts the archive's lines, and never shows a chat line: other players wrote
the archive.
"""
import json
import sys
import time
import tkinter as tk
from pathlib import Path
from tkinter import ttk

ROOT = Path(__file__).resolve().parents[2]
args = [a for a in sys.argv[1:] if not a.startswith("--")]
LABELS = Path(args[0]) if args else ROOT / "notes" / "chat-archive" / "labels" / "qwen2.5vl-7b-p1.jsonl"
ARCHIVE = ROOT / "notes" / "chat-archive" / "chat.jsonl"
SHOWN = ["hostility", "profanity", "sexual", "discrimination", "toxic"]
STALL = 90   # seconds without a new line before it says the labeller may have stopped


def total_lines():
    with open(ARCHIVE, encoding="utf-8") as fh:
        return sum(1 for line in fh if line.strip())


def state(total):
    keys, bad, secs, flagged = set(), 0, [], dict.fromkeys(SHOWN, 0)
    if LABELS.exists():
        with open(LABELS, encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:   # the line being written right now
                    continue
                if r["key"] in keys:
                    continue
                keys.add(r["key"])
                secs.append(r.get("seconds") or 0)
                if not r.get("ok"):
                    bad += 1
                    continue
                for k in SHOWN:
                    if r["labels"].get(k, 0) >= 2:
                        flagged[k] += 1
    done = len(keys)
    recent = secs[-200:]
    pace = sum(recent) / len(recent) if recent else 0
    left_min = (total - done) * pace / 60
    idle = time.time() - LABELS.stat().st_mtime if LABELS.exists() else None
    if done >= total:
        status = "Done. Every line is labelled."
    elif idle is not None and idle > STALL:
        status = f"No new line for {idle / 60:.0f} min. The labeller may have stopped; rerun it to pick up where it left off."
    else:
        status = "Running."
    return {
        "done": done, "total": total,
        "lines": f"{done:,} of {total:,} lines ({100 * done / max(total, 1):.1f}%)",
        "pace": f"{pace:.2f} s a line, about {left_min:.0f} min left" if done < total else f"{pace:.2f} s a line",
        "flagged": "Clear or severe so far: " + ", ".join(f"{k} {v}" for k, v in flagged.items()),
        "bad": f"Unreadable replies: {bad}",
        "status": status,
    }


TOTAL = total_lines()
if "--once" in sys.argv:
    s = state(TOTAL)
    print("\n".join([s["lines"], s["pace"], s["flagged"], s["bad"], s["status"]]))
    sys.exit(0)

BG, FG, DIM = "#111111", "#ffffff", "#bbbbbb"
root = tk.Tk()
root.title("Admin+ labelling")
root.configure(bg=BG)
root.resizable(False, False)
style = ttk.Style(root)
style.theme_use("clam")
style.configure("Bar.Horizontal.TProgressbar", troughcolor="#2a2a2a", background=FG,
                bordercolor="#2a2a2a", lightcolor=FG, darkcolor=FG, thickness=18)

frame = tk.Frame(root, bg=BG, padx=20, pady=16)
frame.pack()
tk.Label(frame, text="Labelling the chat archive", bg=BG, fg=FG, font=("Segoe UI", 14, "bold")).pack(anchor="w")
tk.Label(frame, text="Qwen 2.5 VL 7B on this PC. Counts only, no chat lines.", bg=BG, fg=DIM,
         font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 10))
bar = ttk.Progressbar(frame, style="Bar.Horizontal.TProgressbar", length=460, maximum=TOTAL)
bar.pack(anchor="w", pady=(0, 10))
rows = {}
for key, size in [("lines", 12), ("pace", 10), ("flagged", 10), ("bad", 10), ("status", 10)]:
    rows[key] = tk.Label(frame, text="", bg=BG, fg=FG if key in ("lines", "status") else DIM,
                         font=("Segoe UI", size, "bold" if key == "lines" else "normal"),
                         wraplength=460, justify="left")
    rows[key].pack(anchor="w", pady=1)


def refresh():
    try:
        s = state(TOTAL)
        bar["value"] = s["done"]
        for key in rows:
            rows[key]["text"] = s[key]
    except Exception as e:     # keep the window alive while files are busy
        rows["status"]["text"] = f"Couldn't read the labels just now ({type(e).__name__}). Trying again."
    root.after(1500, refresh)


refresh()
root.mainloop()
