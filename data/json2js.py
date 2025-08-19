#!/usr/bin/env python3
import json
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python json2js.py <input.json> [output.js]")
        sys.exit(1)
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else in_path.with_suffix(".js")

    with in_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise SystemExit("Input JSON must be a list (array) of entries.")

    js = "window.SIMILARITY_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"

    with out_path.open("w", encoding="utf-8") as f:
        f.write(js)

    print(f"Wrote {out_path}")

if __name__ == "__main__":
    main()
