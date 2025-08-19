# gen_manifest.py  (run from your project root)
from pathlib import Path
import json

IMG_DIR = Path("images")
DEST = IMG_DIR / "manifest.json"
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}  # add more if needed

def main():
    files = []
    for p in sorted(IMG_DIR.iterdir()):
        if p.is_file() and p.suffix.lower() in EXTS and p.name != "manifest.json":
            files.append(p.name)  # filenames only, as expected by index.html
    DEST.write_text(json.dumps(files, indent=2))
    print(f"Wrote {len(files)} entries to {DEST}")

if __name__ == "__main__":
    main()
