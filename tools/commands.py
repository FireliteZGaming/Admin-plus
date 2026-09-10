"""Render every vanilla passthrough: its name, the command it really is, its
declared grammar, and whether that grammar has been CHECKED against Microsoft's
reference.

    python tools/commands.py            # the whole table
    python tools/commands.py --todo     # only the rows nobody has verified
    python tools/commands.py --md       # markdown, for pasting somewhere

Why this exists: every test in this project checked the SHAPE of a row — eight
parameters or fewer, mandatory before optional, enums that exist — and none
checked whether the shape was the RIGHT one. `/tp` therefore spent its whole
life declaring `facing` as a position when `facing` is a literal keyword, and
emitted text that was not a valid command. It looked fine from every angle
except the one that mattered.

So the verified column is the point of this tool, and an unverified row is
stated as unverified rather than left to look the same as a checked one.
"""
import io
import os
import pathlib
import re
import sys

os.chdir(pathlib.Path(__file__).resolve().parent.parent)
SRC = io.open("Admin+ BP/scripts/core/vanillaparams.js", encoding="utf-8").read()

TYPE = re.compile(r"P\.([A-Za-z]+)")


def slice_between(start, end=None):
    a = SRC.index(start)
    b = SRC.index(end) if end else len(SRC)
    return SRC[a:b]


def codenames():
    blk = slice_between("export const CODENAME", "export const GAME_OWNED")
    return dict(re.findall(r'\["([a-z]+)",\s*"([a-z]+)"\]', blk))


def checked():
    blk = slice_between("export const CHECKED")
    return dict(re.findall(r'\["([a-z]+)",\s*"([\d-]+)"\]', blk))


def rows():
    """(vanilla name, fixed words, [(param, type, optional)])"""
    blk = slice_between("export const COMMANDS", "export const CODENAME")
    out = []
    for m in re.finditer(
            r'\{\s*name:\s*"([a-z]+)",\s*help:\s*"([^"]*)",(.*?)params:\s*\[(.*?)\]\s*\}',
            blk, re.S):
        name, help_text, middle, params = m.groups()
        fixed = re.findall(r'"([a-z.]+)"', middle) if "fixed" in middle else []
        ps = []
        for p in re.finditer(r'\["([A-Za-z0-9_.]+)",\s*P\.([A-Za-z]+)(,\s*(true|false))?', params):
            ps.append((p.group(1), p.group(2), p.group(4) == "true"))
        out.append((name, help_text, fixed, ps))
    return out


def grammar(name, fixed, params):
    parts = [f"/{name}"] + list(fixed)
    for pname, ptype, optional in params:
        short = {"EntitySelector": "target", "PlayerSelector": "player",
                 "Location": "x y z", "ItemType": "item", "BlockType": "block",
                 "EntityType": "entity", "Integer": "int", "Float": "float",
                 "Boolean": "bool", "String": "str", "Enum": "enum"}.get(ptype, ptype)
        parts.append(f"[{pname}:{short}]" if optional else f"<{pname}:{short}>")
    return " ".join(parts)


def main(argv):
    todo_only = "--todo" in argv
    as_md = "--md" in argv
    cn, ck, data = codenames(), checked(), rows()

    # A name in CHECKED that is not a real row means the table moved and this
    # record did not — the exact drift the file warns about.
    stale = [n for n in ck if n not in {r[0] for r in data}]
    if stale:
        print(f"!! CHECKED names with no row in the table: {stale}\n")

    data.sort(key=lambda r: cn.get(r[0], r[0]))
    shown = [r for r in data if not (todo_only and r[0] in ck)]

    if as_md:
        print("| command | vanilla | verified | grammar |")
        print("|---|---|---|---|")
        for name, _, fixed, params in shown:
            mark = f"yes {ck[name]}" if name in ck else "**no**"
            print(f"| `/{cn.get(name, name)}` | `{name}` | {mark} | "
                  f"`{grammar(name, fixed, params)}` |")
    else:
        for name, _, fixed, params in shown:
            mark = "  ok  " if name in ck else " TODO "
            print(f"[{mark}] /{cn.get(name, name):<12} {grammar(name, fixed, params)}")

    done = sum(1 for r in data if r[0] in ck)
    print(f"\n{done} of {len(data)} verified against Microsoft's reference; "
          f"{len(data) - done} still written from memory.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
