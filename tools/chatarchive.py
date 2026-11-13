"""Keep every chat line from the game's content logs.

Admin+ writes each chat line to the content log, in one of three shapes:

    HH:MM:SS[Scripting][inform]-[Admin+] [General] Steve: hello
    HH:MM:SS[Scripting][inform]-[Admin+] [General] * Steve waves
    HH:MM:SS[Scripting][inform]-[Admin+] [prchat] Steve -> Alex: hi

Minecraft does not keep its logs forever, so this copies the chat out to
notes/chat-archive/chat.jsonl (notes/ is gitignored): one JSON line per
message, never twice, nothing filtered or cleaned. The user wants all of it,
harassment included, as training data for moderation later (2026-11-12).
Other players wrote it, so it stays on this PC and is never published.

Run it after a playtest:

    python tools/chatarchive.py
"""

import json
import os
import re
import sys
from pathlib import Path

LOGS = Path(os.environ.get("APPDATA", "")) / "Minecraft Bedrock" / "logs"
OUT_DIR = Path(__file__).resolve().parent.parent / "notes" / "chat-archive"
OUT = OUT_DIR / "chat.jsonl"

PREFIX = re.compile(r"^(\d\d:\d\d:\d\d)\[Scripting\]\[inform\]-\[Admin\+\] \[([^\]]+)\] (.*)$")
PRIVATE = re.compile(r"^(.+?) -> (.+?): (.*)$")
SPOKEN = re.compile(r"^(.+?): (.*)$")
FILE_DATE = re.compile(r"ContentLog(\d{4}-\d{2}-\d{2})_")


def parse(line):
    """One log line to a record, or None when it isn't chat."""
    found = PREFIX.match(line.rstrip("\r\n"))
    if not found:
        return None
    time, room, rest = found.groups()
    private = PRIVATE.match(rest)
    if private and " -> " in rest.split(": ", 1)[0]:
        sender, to, message = private.groups()
        return {"time": time, "room": room, "kind": "private", "name": sender, "to": to, "message": message}
    if rest.startswith("* "):
        return {"time": time, "room": room, "kind": "emote", "name": "", "message": rest[2:]}
    spoken = SPOKEN.match(rest)
    if spoken:
        sender, message = spoken.groups()
        return {"time": time, "room": room, "kind": "chat", "name": sender, "message": message}
    return None


def main():
    if not LOGS.is_dir():
        print(f"No game logs at {LOGS}")
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    seen = set()
    if OUT.exists():
        with OUT.open(encoding="utf-8") as existing:
            for row in existing:
                try:
                    record = json.loads(row)
                    seen.add((record["source"], record["line"]))
                except (ValueError, KeyError):
                    continue

    added = 0
    files = sorted(LOGS.glob("ContentLog*.txt"))
    with OUT.open("a", encoding="utf-8") as archive:
        for log in files:
            date = FILE_DATE.search(log.name)
            with log.open(encoding="utf-8", errors="replace") as source:
                for number, line in enumerate(source, start=1):
                    if (log.name, number) in seen:
                        continue
                    record = parse(line)
                    if not record:
                        continue
                    record = {"date": date.group(1) if date else "", **record, "source": log.name, "line": number}
                    archive.write(json.dumps(record, ensure_ascii=False) + "\n")
                    seen.add((log.name, number))
                    added += 1

    print(f"Read {len(files)} game logs. Added {added} chat lines. {len(seen)} kept in total.")
    print(f"Archive: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
