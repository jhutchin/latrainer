#!/usr/bin/env python3
"""Validate content/*.yaml.

Checks: schema per item type, globally unique stable IDs, deck names, generator
names (against LAT.register(...) calls in templates/shared/generators.js),
variants serialize to valid JSON, and a few TeX lint rules.

Usage:  python validate.py            (exit 1 on any error)
build.py imports load_content() / validate() from here, so a build always
validates first.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
CONTENT_DIR = ROOT / "content"
GENERATORS_JS = ROOT / "templates" / "shared" / "generators.js"

# Subdeck name -> hardcoded Anki deck ID. build.py uses these; adding a subdeck
# means adding an entry here (pick a new random 10-digit number, never reuse).
DECK_IDS = {
    "LA::core": 1872401151,
    "LA::ML": 1872401152,
    "LA::cogneuro": 1872401153,
}

ID_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
TAG_RE = re.compile(r"^[A-Za-z0-9_-]+(?:::[A-Za-z0-9_-]+)*$")
GEN_RE = re.compile(r"""LAT\.register\(\s*['"]([A-Za-z0-9_]+)['"]""")

MIN_VARIANTS, MAX_VARIANTS = 4, 8
LONG_INLINE_TEX = 70  # chars of TeX source inside \( \) before warning

TOP_KEYS = {"deck", "notation", "procedural", "variant_pool"}
SCHEMA = {
    # kind: (required {key: type}, optional {key: type})
    "notation": ({"id": str, "front": str, "back": str, "verified": bool}, {"tags": list}),
    "procedural": ({"id": str, "generator": str}, {"prompt_hint": str, "tags": list}),
    "variant_pool": ({"id": str, "concept": str, "variants": list}, {"tags": list}),
}
VARIANT_SCHEMA = ({"prompt": str, "answer": str, "verified": bool}, {"explanation": str})


def generator_names(path: Path = GENERATORS_JS) -> set[str]:
    return set(GEN_RE.findall(path.read_text(encoding="utf-8")))


def load_content(content_dir: Path = CONTENT_DIR) -> list[dict]:
    """Return [{'path': Path, 'data': parsed YAML}] for every content/*.yaml."""
    files = []
    for path in sorted(content_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as f:
            files.append({"path": path, "data": yaml.safe_load(f) or {}})
    return files


def variants_json(variants: list[dict]) -> str:
    """Serialize variants for the Anki field.

    The field sits inside <script type="application/json"> in the template, so
    escape <, >, & as \\u escapes: the result contains no HTML-special
    characters at all, and can't close the script tag early.
    """
    keep = [{k: v[k] for k in ("prompt", "answer", "explanation", "verified") if k in v} for v in variants]
    s = json.dumps(keep, ensure_ascii=True, separators=(",", ":"))
    return s.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def _check_fields(obj, schema, where, errors):
    required, optional = schema
    if not isinstance(obj, dict):
        errors.append(f"{where}: expected a mapping, got {type(obj).__name__}")
        return False
    for key, typ in required.items():
        if key not in obj:
            errors.append(f"{where}: missing required key '{key}'")
        elif not isinstance(obj[key], typ):
            errors.append(f"{where}: '{key}' must be {typ.__name__}, got {type(obj[key]).__name__}")
    for key, typ in optional.items():
        if key in obj and not isinstance(obj[key], typ):
            errors.append(f"{where}: '{key}' must be {typ.__name__}, got {type(obj[key]).__name__}")
    unknown = set(obj) - set(required) - set(optional)
    if unknown:
        errors.append(f"{where}: unknown key(s) {sorted(unknown)}")
    return True


def _lint_tex(text: str, where: str, errors: list, warnings: list):
    for open_, close in (("\\(", "\\)"), ("\\[", "\\]")):
        if text.count(open_) != text.count(close):
            errors.append(f"{where}: unbalanced {open_} … {close} "
                          f"({text.count(open_)} open, {text.count(close)} close)")
    for env in set(re.findall(r"\\begin\{(\w+\*?)\}", text)):
        if text.count(f"\\begin{{{env}}}") != text.count(f"\\end{{{env}}}"):
            errors.append(f"{where}: unbalanced \\begin{{{env}}} / \\end{{{env}}}")
    # Inline math can't wrap or scroll, so long \( \) runs off a phone screen;
    # display math scrolls horizontally (see style.css). Source length is a
    # crude proxy for rendered width; tune LONG_INLINE_TEX if it nags.
    for m in re.finditer(r"\\\((.*?)\\\)", text, flags=re.S):
        if len(m.group(1)) > LONG_INLINE_TEX:
            warnings.append(f"{where}: long inline math ({len(m.group(1))} chars) may overflow on "
                            f"phones; consider \\[ \\]: {m.group(1)[:40]}…")
    if re.search(r"(?<!\\)\$", text):
        warnings.append(f"{where}: contains '$'. Anki's MathJax uses \\( \\) and \\[ \\], not $")


def validate(files: list[dict], generators: set[str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: dict[str, str] = {}
    seen_decks: dict[str, str] = {}

    for f in files:
        name = f["path"].name
        data = f["data"]
        if not isinstance(data, dict):
            errors.append(f"{name}: top level must be a mapping")
            continue
        unknown = set(data) - TOP_KEYS
        if unknown:
            errors.append(f"{name}: unknown top-level key(s) {sorted(unknown)}")
        deck = data.get("deck")
        if deck not in DECK_IDS:
            errors.append(f"{name}: deck {deck!r} is not one of {sorted(DECK_IDS)} (see DECK_IDS in validate.py)")
        elif deck in seen_decks:
            errors.append(f"{name}: deck {deck} already defined by {seen_decks[deck]} (one file per subdeck)")
        else:
            seen_decks[deck] = name

        for kind in ("notation", "procedural", "variant_pool"):
            items = data.get(kind) or []
            if not isinstance(items, list):
                errors.append(f"{name}: '{kind}' must be a list")
                continue
            for i, item in enumerate(items):
                where = f"{name}:{kind}[{i}]"
                if not _check_fields(item, SCHEMA[kind], where, errors):
                    continue
                item_id = item.get("id")
                if isinstance(item_id, str):
                    where = f"{name}:{item_id}"
                    if not ID_RE.match(item_id):
                        errors.append(f"{where}: id must match {ID_RE.pattern}")
                    if item_id in seen_ids:
                        errors.append(f"{where}: duplicate id (also in {seen_ids[item_id]})")
                    seen_ids[item_id] = name
                for tag in item.get("tags") or []:
                    if not isinstance(tag, str) or not TAG_RE.match(tag):
                        errors.append(f"{where}: invalid tag {tag!r} (no spaces; letters, digits, _ - ::)")

                if kind == "notation":
                    for key in ("front", "back"):
                        if isinstance(item.get(key), str):
                            _lint_tex(item[key], f"{where}.{key}", errors, warnings)

                elif kind == "procedural":
                    gen = item.get("generator")
                    if isinstance(gen, str) and gen not in generators:
                        errors.append(f"{where}: unknown generator {gen!r}; registered: {sorted(generators)}")

                elif kind == "variant_pool":
                    variants = item.get("variants")
                    if not isinstance(variants, list):
                        continue
                    if not (MIN_VARIANTS <= len(variants) <= MAX_VARIANTS):
                        warnings.append(f"{where}: {len(variants)} variants "
                                        f"(recommended {MIN_VARIANTS}–{MAX_VARIANTS})")
                    ok = True
                    for j, v in enumerate(variants):
                        vwhere = f"{where}.variants[{j}]"
                        if not _check_fields(v, VARIANT_SCHEMA, vwhere, errors):
                            ok = False
                            continue
                        for key in ("prompt", "answer", "explanation"):
                            if isinstance(v.get(key), str):
                                _lint_tex(v[key], f"{vwhere}.{key}", errors, warnings)
                    if ok:
                        try:
                            round_trip = json.loads(variants_json(variants))
                            assert isinstance(round_trip, list) and len(round_trip) == len(variants)
                        except Exception as exc:  # noqa: BLE001
                            errors.append(f"{where}: variants do not serialize to valid JSON: {exc}")

    return errors, warnings


def main() -> int:
    gens = generator_names()
    files = load_content()
    errors, warnings = validate(files, gens)
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    n_items = sum(len(f["data"].get(k) or []) for f in files for k in ("notation", "procedural", "variant_pool")
                  if isinstance(f["data"], dict))
    print(f"{len(files)} files, {n_items} items, {len(gens)} generators: "
          f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
