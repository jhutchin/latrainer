#!/usr/bin/env python3
"""Create numpy reference fixtures for the JS generators.

Runs tests/dump_cases.js (Node, or macOS jsc as a fallback) to get the params
each generator draws for a fixed list of seeds. Computes the expected answer
independently with numpy and writes tests/fixtures/<generator>.json.

It refuses to write a fixture if the JS answer disagrees with numpy, so a
wrong generator can't bake its own mistake into the fixtures.

    python tests/make_fixtures.py            # write fixtures that don't exist yet
    python tests/make_fixtures.py --force    # regenerate all (after an intentional change)

Adding a generator? Add its numpy reference to REFERENCE below.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"


def ref_matvec(p):
    return {"y": (np.array(p["A"], dtype=float) @ np.array(p["x"], dtype=float)).tolist()}


REFERENCE = {
    "matvec": ref_matvec,
}


def js_engine() -> str:
    node = shutil.which("node")
    if node:
        return node
    if Path(JSC).exists():
        return JSC
    sys.exit("Need Node (or macOS jsc) to run tests/dump_cases.js")


def close(a, b) -> bool:
    if isinstance(b, dict):
        return isinstance(a, dict) and a.keys() == b.keys() and all(close(a[k], b[k]) for k in b)
    return bool(np.allclose(np.asarray(a, dtype=float), np.asarray(b, dtype=float), rtol=1e-9, atol=1e-12))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="overwrite existing fixtures")
    args = ap.parse_args()

    out = subprocess.run([js_engine(), "tests/dump_cases.js"], cwd=ROOT, capture_output=True, text=True, check=True)
    cases = json.loads(out.stdout)

    by_gen: dict[str, list] = {}
    for c in cases:
        by_gen.setdefault(c["generator"], []).append(c)

    FIXTURES.mkdir(parents=True, exist_ok=True)
    status = 0
    for name, gen_cases in sorted(by_gen.items()):
        path = FIXTURES / f"{name}.json"
        if name not in REFERENCE:
            print(f"ERROR {name}: no numpy reference in REFERENCE; add one")
            status = 1
            continue
        if path.exists() and not args.force:
            print(f"skip  {name}: {path.relative_to(ROOT)} exists (use --force to regenerate)")
            continue
        fixture_cases = []
        for c in gen_cases:
            expected = REFERENCE[name](c["params"])
            if not close(c["result"], expected):
                print(f"ERROR {name} seed {c['seed']}: JS {c['result']} != numpy {expected}; not writing")
                status = 1
                break
            fixture_cases.append({"seed": c["seed"], "params": c["params"], "expected": expected})
        else:
            path.write_text(json.dumps({"generator": name, "cases": fixture_cases}, indent=1) + "\n")
            print(f"wrote {path.relative_to(ROOT)} ({len(fixture_cases)} cases)")
    return status


if __name__ == "__main__":
    sys.exit(main())
