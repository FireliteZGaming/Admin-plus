"""Label the private chat archive with a local model in Ollama, on this PC.

    python tools/toxicity/label_archive.py                  # every line, resumable
    python tools/toxicity/label_archive.py --limit 20 --out dryrun.jsonl

Reads notes/chat-archive/chat.jsonl and appends one JSON object per line to
notes/chat-archive/labels/<out> (gitignored, next to the archive). Stop it at
any time; a rerun skips lines already labelled. It prints counts and timings,
never a chat line: other players wrote the archive and it stays on this PC.

How it asks (research notes, Obsidian > Admin+ > Research, llm_labelling.md):
a fixed codebook, the previous lines of the same session for context, only
the TARGET line judged, Minecraft exceptions spelled out with examples, one
compact JSON object in a fixed schema, temperature 0, a fixed seed, and no
thinking mode. Keep PROMPT_VERSION in step with any change to the prompt:
small edits flip labels, so labels from two prompts must never be mixed.
"""
import argparse
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

PROMPT_VERSION = 1
ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "notes" / "chat-archive" / "chat.jsonl"
KEYS = ["toxic", "discrimination", "sexual", "hostility", "profanity"]

CODEBOOK = """You label Minecraft server chat for a moderation tool. You will see a few earlier chat lines for context, then one TARGET line. Judge ONLY the target line.

Give each category a severity: 0 none, 1 mild, 2 clear, 3 severe.
- discrimination: attacks on, or slurs about, a group of people by race, ethnicity, nationality, religion, gender, sexuality or disability, including slurs used as insults. Saying you belong to a group, or mentioning one neutrally, is 0.
- sexual: sexual content, innuendo, requests or comments about someone's body or sex life.
- hostility: insults, threats, harassment or bullying aimed at a person or a group, and telling someone to hurt or kill themselves ("kys" is 3).
- profanity: swear words, whoever they are aimed at.
- toxic: overall, would a moderator want to see this line? Swearing alone is at most 1.
Also say who the line is aimed at: "none", "player" (one person, "you", or a name) or "group".

Minecraft rules:
- Game actions are not threats: killing mobs, "kill the wither", PvP talk such as "kill him", "1v1 me", "you're dead", "I'll get you", raiding and bases. These are 0.
- Swearing at the game, the lag or yourself ("oh shit lava", "fuck this creeper") is profanity only, hostility 0.
- Friendly trash talk that both sides joke about ("you're so bad lol", "noob") is hostility 1 at most. Use the context lines to tell banter from bullying.
- Dying, losing and rage at bad luck are not hostility.

Answer with the JSON object only."""

# PURPOSE: sample lines for the local labelling model, hateful and sexual ones
# included on purpose. It has to see what "severe" looks like to rate it, so
# that Admin+'s chat filter can learn to hold such lines before players see
# them. Labelling data only.
EXAMPLES = [
    (["Steve: anyone wanna fight the wither"], "Alex: kill the wither first then we raid", {"toxic": 0, "discrimination": 0, "sexual": 0, "hostility": 0, "profanity": 0, "aimed": "none"}),
    (["Sam: lava got me"], "Sam: oh shit i lost everything", {"toxic": 0, "discrimination": 0, "sexual": 0, "hostility": 0, "profanity": 1, "aimed": "none"}),
    (["Kai: gg", "Rin: rematch?"], "Kai: ur so bad lol 1v1 again", {"toxic": 0, "discrimination": 0, "sexual": 0, "hostility": 1, "profanity": 0, "aimed": "player"}),
    (["Max: stop following me", "Lee: why"], "Lee: nobody wants you here just leave idiot", {"toxic": 2, "discrimination": 0, "sexual": 0, "hostility": 2, "profanity": 0, "aimed": "player"}),
    (["Jo: i lost my diamonds"], "Ash: kys", {"toxic": 3, "discrimination": 0, "sexual": 0, "hostility": 3, "profanity": 0, "aimed": "player"}),
    (["Mia: happy pride month everyone"], "Ty: im gay too lol", {"toxic": 0, "discrimination": 0, "sexual": 0, "hostility": 0, "profanity": 0, "aimed": "none"}),
    (["Bo: whos online"], "Zed: all those people are subhuman and should be banned from everything", {"toxic": 3, "discrimination": 3, "sexual": 0, "hostility": 2, "profanity": 0, "aimed": "group"}),
    (["Pip: nice skin"], "Gus: send me pics of you in the shower", {"toxic": 3, "discrimination": 0, "sexual": 3, "hostility": 1, "profanity": 0, "aimed": "player"}),
]

SCHEMA = {
    "type": "object",
    "properties": {**{k: {"type": "integer", "minimum": 0, "maximum": 3} for k in KEYS},
                   "aimed": {"type": "string", "enum": ["none", "player", "group"]}},
    "required": KEYS + ["aimed"],
}


def say(context, target):
    lines = "\n".join(context) if context else "(no earlier lines)"
    return f"Earlier lines:\n{lines}\n\nTARGET line:\n{target}"


def messages_for(context, target):
    msgs = [{"role": "system", "content": CODEBOOK}]
    for ctx, tgt, ans in EXAMPLES:
        msgs.append({"role": "user", "content": say(ctx, tgt)})
        msgs.append({"role": "assistant", "content": json.dumps(ans)})
    msgs.append({"role": "user", "content": say(context, target)})
    return msgs


def ask(url, model, msgs, seed):
    body = json.dumps({"model": model, "messages": msgs, "stream": False, "format": SCHEMA,
                       "keep_alive": "10m",
                       "options": {"temperature": 0, "seed": seed, "num_ctx": 4096, "num_predict": 120}}).encode()
    req = urllib.request.Request(url + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def valid(obj):
    return (isinstance(obj, dict) and all(isinstance(obj.get(k), int) and 0 <= obj[k] <= 3 for k in KEYS)
            and obj.get("aimed") in ("none", "player", "group"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="qwen2.5vl:7b")
    ap.add_argument("--url", default="http://localhost:11434")
    ap.add_argument("--context", type=int, default=4, help="earlier lines of the same session to show")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many new lines (0 = all)")
    ap.add_argument("--out", default="")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    out = ROOT / "notes" / "chat-archive" / "labels" / (args.out or f"{args.model.replace(':', '-')}-p{PROMPT_VERSION}.jsonl")
    out.parent.mkdir(parents=True, exist_ok=True)

    rows = [json.loads(l) for l in ARCHIVE.read_text(encoding="utf-8").splitlines() if l.strip()]
    done = set()
    if out.exists():
        for l in out.read_text(encoding="utf-8").splitlines():
            if l.strip():
                done.add(json.loads(l)["key"])
    print(f"{len(rows):,} archive lines, {len(done):,} already labelled in {out.name}")

    tally, bad, new, spent = Counter(), 0, 0, 0.0
    with open(out, "a", encoding="utf-8", newline="\n") as fh:
        for i, r in enumerate(rows):
            key = f"{r['source']}:{r['line']}"
            if key in done:
                continue
            context = [f"{p['name']}: {p['message']}" for p in rows[max(0, i - args.context):i]
                       if p["source"] == r["source"]]
            t = time.time()
            try:
                reply = ask(args.url, args.model, messages_for(context, f"{r['name']}: {r['message']}"), args.seed)
                labels = json.loads(reply["message"]["content"])
                ok = valid(labels)
            except Exception as e:     # a bad reply is recorded, never guessed
                reply, labels, ok = {}, {"error": type(e).__name__}, False
            spent += time.time() - t
            new += 1
            bad += not ok
            if ok:
                for k in KEYS:
                    if labels[k] >= 2:
                        tally[k] += 1
                tally["aimed " + labels["aimed"]] += 1
            fh.write(json.dumps({"key": key, "ok": ok, "labels": labels, "model": args.model,
                                 "prompt": PROMPT_VERSION, "seed": args.seed,
                                 "eval_tokens": reply.get("eval_count"), "seconds": round(time.time() - t, 2)}) + "\n")
            fh.flush()
            if new % 50 == 0:
                left = sum(1 for x in rows if f"{x['source']}:{x['line']}" not in done) - new
                print(f"   {new:,} done, {spent / new:.2f} s a line, about {left * spent / new / 3600:.1f} h left, {bad} unreadable")
            if args.limit and new >= args.limit:
                break
    if new:
        print(f"labelled {new:,} lines in {spent:.0f} s ({spent / new:.2f} s a line), {bad} unreadable")
        print("lines at severity 2 or more:", dict(tally))


if __name__ == "__main__":
    main()
