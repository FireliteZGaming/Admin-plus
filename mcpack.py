import os, zipfile

BASE = os.path.dirname(os.path.abspath(__file__))
PACKS = ["Admin+ BP", "Admin+ RP"]
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
OUT = os.path.join(BASE, "Admin+.mcaddon")

count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for pack in PACKS:
        root = os.path.join(BASE, pack)
        if not os.path.isdir(root):
            raise SystemExit("MISSING PACK FOLDER: " + root)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                if fn in SKIP_FILES:
                    continue
                full = os.path.join(dirpath, fn)
                arc = os.path.relpath(full, BASE).replace("\\", "/")
                z.write(full, arc)
                count += 1
print("done -> Admin+.mcaddon (%d files)" % count)
