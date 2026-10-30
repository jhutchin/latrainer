"""Re-solve every generated problem with numpy and compare to the app's answer.

    python3 tests/check_numpy.py [seeds-per-level]

The generators use exact rational arithmetic; this is an independent check
that they compute the right thing.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent


def expected(case):
    d = case["data"]
    skill = case["skill"]
    if skill == "dot":
        return np.array([[np.dot(d["u"], d["v"])]])
    if skill == "matvec":
        return (np.array(d["A"]) @ np.array(d["x"])).reshape(-1, 1)
    if skill == "projection":
        u, v = np.array(d["u"], float), np.array(d["v"], float)
        p = (u @ v) / (u @ u) * u
        return (p if d["ask"] == "proj" else v - p).reshape(-1, 1)
    if skill == "lstsq":
        beta, *_ = np.linalg.lstsq(np.array(d["X"], float), np.array(d["y"], float), rcond=None)
        return beta.reshape(-1, 1)
    raise ValueError(f"no numpy reference for skill {skill!r}")


def main():
    n = sys.argv[1] if len(sys.argv) > 1 else "200"
    out = subprocess.run(["node", "tests/dump_cases.js", n], cwd=ROOT, check=True, capture_output=True, text=True)
    cases = json.loads(out.stdout)
    bad = 0
    for c in cases:
        want, got = expected(c), np.array(c["answer"], float)
        if want.shape != got.shape or not np.allclose(want, got, rtol=1e-9, atol=1e-9):
            bad += 1
            if bad <= 10:
                print(f"MISMATCH {c['skill']} L{c['level']} seed {c['seed']}: numpy {want.ravel()} app {got.ravel()}")
    skills = sorted({c["skill"] for c in cases})
    print(f"{len(cases)} cases across {', '.join(skills)}: {bad} mismatch(es)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
