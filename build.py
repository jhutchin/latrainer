#!/usr/bin/env python3
"""Build dist/latrainer.apkg from content/*.yaml and templates/.

    python build.py                       # verified content only (default)
    python build.py --include-unverified  # also unverified items, tagged LA::unverified

Stability rules (these keep review history across rebuilds):
  * Model IDs and deck IDs are hardcoded constants. Never change them.
  * Note GUIDs come from each item's `id` only, never from content. Renaming an
    id creates a new note and orphans the old one's history.
  * Note-type field lists are fixed. Changing them makes Anki treat the import
    as a different note type (see README).
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

import genanki

import validate as v

ROOT = Path(__file__).resolve().parent
TEMPLATES = ROOT / "templates"
SHARED = TEMPLATES / "shared"
DIST = ROOT / "dist"
MEDIA_OUT = DIST / "media"

# Hardcoded note-type (model) IDs. Never change these.
MODEL_IDS = {
    "notation": 1607392319,
    "procedural": 1607392320,
    "variant_pool": 1607392321,
}
MODEL_NAMES = {
    "notation": "LA Trainer: Notation",
    "procedural": "LA Trainer: Procedural",
    "variant_pool": "LA Trainer: VariantPool",
}
# Field lists are part of the note type's identity; don't edit casually.
MODEL_FIELDS = {
    "notation": ["id", "front", "back"],
    "procedural": ["id", "generator", "prompt_hint"],
    "variant_pool": ["id", "concept", "variants"],
}
GUID_NAMESPACE = "latrainer"
UNVERIFIED_TAG = "LA::unverified"

# Order matters: persistence first, then the runtime, then generators.
JS_SOURCES = [
    SHARED / "vendor" / "anki-persistence.js",
    SHARED / "latrainer.js",
    SHARED / "generators.js",
]


def note_guid(item_id: str) -> str:
    return genanki.guid_for(GUID_NAMESPACE, item_id)


def build_js_bundle() -> Path:
    """Concatenate shared JS into one media file named by content hash.

    The leading underscore keeps Anki's Check Media from deleting it. The hash
    in the name means a changed bundle is a *new* file. Anki's importer won't
    overwrite an existing media file of the same name with different contents,
    and webviews cache aggressively, so a fixed name would leave clients
    running stale JS.
    """
    parts = []
    for src in JS_SOURCES:
        parts.append(f"/* ===== {src.relative_to(ROOT)} ===== */\n")
        parts.append(src.read_text(encoding="utf-8").rstrip() + "\n\n")
    bundle = "".join(parts)
    digest = hashlib.sha256(bundle.encode("utf-8")).hexdigest()[:8]
    if MEDIA_OUT.exists():
        shutil.rmtree(MEDIA_OUT)
    MEDIA_OUT.mkdir(parents=True)
    out = MEDIA_OUT / f"_latrainer-{digest}.js"
    out.write_text(bundle, encoding="utf-8")
    return out


def load_template(kind: str, side: str, js_name: str) -> str:
    html = (TEMPLATES / kind / f"{side}.html").read_text(encoding="utf-8")
    boot = (TEMPLATES / "boot.html").read_text(encoding="utf-8")
    return html.replace("%%BOOT%%", boot).replace("%%LATRAINER_JS%%", js_name)


def make_models(js_name: str) -> dict[str, genanki.Model]:
    css = (TEMPLATES / "style.css").read_text(encoding="utf-8")
    models = {}
    for kind, model_id in MODEL_IDS.items():
        models[kind] = genanki.Model(
            model_id,
            MODEL_NAMES[kind],
            fields=[{"name": f} for f in MODEL_FIELDS[kind]],
            templates=[{
                "name": "Card 1",
                "qfmt": load_template(kind, "front", js_name),
                "afmt": load_template(kind, "back", js_name),
            }],
            css=css,
            sort_field_index=0,
        )
    return models


def item_tags(deck: str, item: dict, unverified: bool) -> list[str]:
    tags = [deck] + list(item.get("tags") or [])
    if unverified:
        tags.append(UNVERIFIED_TAG)
    return tags


def build(include_unverified: bool, out_path: Path) -> int:
    files = v.load_content()
    errors, warnings = v.validate(files, v.generator_names())
    for w in warnings:
        print(f"warning: {w}")
    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        print("Validation failed; nothing built.")
        return 1

    js_path = build_js_bundle()
    models = make_models(js_path.name)
    decks: dict[str, genanki.Deck] = {}
    counts = {"notation": 0, "procedural": 0, "variant_pool": 0, "skipped_unverified": 0}

    for f in files:
        data = f["data"]
        deck_name = data["deck"]
        deck = decks.setdefault(deck_name, genanki.Deck(v.DECK_IDS[deck_name], deck_name))

        for item in data.get("notation") or []:
            if not item["verified"] and not include_unverified:
                counts["skipped_unverified"] += 1
                continue
            deck.add_note(genanki.Note(
                model=models["notation"],
                fields=[item["id"], item["front"], item["back"]],
                tags=item_tags(deck_name, item, not item["verified"]),
                guid=note_guid(item["id"]),
            ))
            counts["notation"] += 1

        for item in data.get("procedural") or []:
            deck.add_note(genanki.Note(
                model=models["procedural"],
                fields=[item["id"], item["generator"], item.get("prompt_hint", "")],
                tags=item_tags(deck_name, item, False),
                guid=note_guid(item["id"]),
            ))
            counts["procedural"] += 1

        for item in data.get("variant_pool") or []:
            variants = [x for x in item["variants"] if x["verified"] or include_unverified]
            counts["skipped_unverified"] += len(item["variants"]) - len(variants)
            if not variants:
                continue
            deck.add_note(genanki.Note(
                model=models["variant_pool"],
                fields=[item["id"], item["concept"], v.variants_json(variants)],
                tags=item_tags(deck_name, item, any(not x["verified"] for x in variants)),
                guid=note_guid(item["id"]),
            ))
            counts["variant_pool"] += 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    package = genanki.Package(list(decks.values()))
    package.media_files = [str(js_path)]
    package.write_to_file(str(out_path))

    print(f"Wrote {out_path.relative_to(ROOT)}  (media: {js_path.name})")
    gate = ("unverified INCLUDED" if include_unverified
            else f"skipped_unverified={counts['skipped_unverified']}")
    print(f"  notation={counts['notation']} procedural={counts['procedural']} "
          f"variant_pool={counts['variant_pool']}  {gate}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--include-unverified", action="store_true",
                    help="include items/variants with verified: false (tagged LA::unverified)")
    ap.add_argument("-o", "--out", type=Path, default=DIST / "latrainer.apkg")
    args = ap.parse_args()
    return build(args.include_unverified, args.out.resolve())


if __name__ == "__main__":
    sys.exit(main())
