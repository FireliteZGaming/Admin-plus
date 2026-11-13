"""Unpack the game's own menu files (JSON UI) so they can be read.

    python tools/vanillaui.py               # every file, into notes/vanilla-ui/
    python tools/vanillaui.py server_form.json ui_common.json

Since 1.26 the installed game keeps its UI JSON packed in one archive,
`data/resource_packs/vanilla/__brarchive/ui.brarchive`, so there is no
`ui/server_form.json` to open any more. Admin+'s resource pack overrides that
file and leans on others (common_buttons, common_dialogs, settings_common), so
after a game update read the new copies here before trusting the old shapes.

The output goes to notes/, which is never committed: these are Mojang's files.

Layout of a .brarchive, worked out on 2026-11-13 from the 1.26.45 install:
an 8-byte magic, a u32 entry count, a u32 version (1), then one 256-byte entry
per file (a 1-byte name length, the name padded to 247 bytes, a u32 offset and
a u32 size), then the data. Offsets count from the end of the entry table.
"""
import pathlib
import struct
import sys

GAME = pathlib.Path(r"C:/XboxGames/Minecraft for Windows/Content/data/resource_packs/vanilla/__brarchive/ui.brarchive")
OUT = pathlib.Path(__file__).resolve().parent.parent / "notes" / "vanilla-ui"


def entries(data):
    count, _version = struct.unpack_from("<II", data, 8)
    base = 16 + count * 256
    for i in range(count):
        at = 16 + i * 256
        length = data[at]
        name = data[at + 1:at + 1 + length].decode("utf8")
        offset, size = struct.unpack_from("<II", data, at + 248)
        yield name, data[base + offset:base + offset + size]


def main():
    wanted = set(sys.argv[1:])
    if not GAME.exists():
        raise SystemExit(f"not found: {GAME}\nIs the game installed somewhere else?")
    OUT.mkdir(parents=True, exist_ok=True)
    written = 0
    for name, body in entries(GAME.read_bytes()):
        if wanted and name not in wanted:
            continue
        (OUT / name).write_bytes(body)
        written += 1
    print(f"{written} file(s) in {OUT}")
    missing = wanted - {p.name for p in OUT.iterdir()}
    if missing:
        print("not in the archive: " + ", ".join(sorted(missing)))


if __name__ == "__main__":
    main()
