# LA Trainer: Anki deck prototype

This pipeline generates an Anki deck for linear algebra: general fluency plus notation
and concepts from ML and cognitive neuroscience / fMRI methods. Anki schedules **skills**,
not instances. A Procedural card generates a fresh problem on every review, and a
VariantPool card picks one of several pre-written variants. One note is one skill or
concept.

**Status:** prototype, mechanics stage. There is one example of each note type: the
`matvec` generator, one VariantPool concept (GLM contrasts, 4 variants) and 3 Notation
cards. All authored content is `verified: false`. See [Platform uncertainties](#platform-uncertainties).

## Layout

```
content/            core.yaml, ml.yaml, cogneuro.yaml   (source of truth, one per subdeck)
templates/
  style.css         shared by all note types (light + night mode)
  boot.html         loader snippet spliced into dynamic templates (%%BOOT%%)
  notation/         front.html, back.html   (static, no JS)
  procedural/       front.html, back.html
  variant_pool/     front.html, back.html
  shared/
    latrainer.js    runtime: RNG, front/back state, MathJax, renderers
    generators.js   procedural generators (LAT.register(...))
    vendor/         anki-persistence (MIT, vendored unmodified)
tests/
  test_generators.js   generator tests (Node; macOS jsc also works)
  make_fixtures.py     numpy reference answers -> tests/fixtures/*.json
  dump_cases.js, engine.js
validate.py         schema / ID / generator / JSON / TeX checks
build.py            -> dist/latrainer.apkg (+ dist/media/_latrainer-<hash>.js)
```

## Setup and build

```bash
python3 -m venv .venv
```
```bash
.venv/bin/pip install -r requirements.txt
```
```bash
.venv/bin/python validate.py
```
```bash
.venv/bin/python build.py
```

`build.py` always runs the validator first and refuses to build on errors.

| Command | Includes |
|---|---|
| `build.py` (default) | Procedural notes, plus Notation cards and variants with `verified: true` |
| `build.py --include-unverified` | Everything. Unverified notes get the tag `LA::unverified` and a visible **UNVERIFIED** badge |

> **Right now every authored item is unverified**, so a default build contains only the
> Procedural card. For the mechanics test, use `--include-unverified`.

### Tests

```bash
node tests/test_generators.js
```

Without Node on macOS, run the same file with the built-in JavaScriptCore shell, from the repo root:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/test_generators.js
```

For each generator, the tests check that:
- fixed seeds reproduce the params stored in the fixtures, and
- `solve()` matches the **numpy** answers stored in the fixtures, and
- `render()` is deterministic and well formed (balanced TeX, no `NaN`/`undefined`) over 300 seeds.

## How it works

**Note types** (model IDs are hardcoded in `build.py`):

| Note type | Fields | Behavior |
|---|---|---|
| LA Trainer: Notation | `id`, `front`, `back` | Static card, MathJax only, no JS |
| LA Trainer: Procedural | `id`, `generator`, `prompt_hint` | The front draws a random seed and runs `generator`; the back re-derives the same problem and shows the answer and a worked solution |
| LA Trainer: VariantPool | `id`, `concept`, `variants` | `variants` is a JSON array. The front picks an index from a random seed and the back shows the same variant's answer and explanation |

**Front/back consistency.** The front saves `{kind, id, seed}` and the back loads it.
Both regenerate deterministically from the seed with a seeded PRNG (mulberry32). State is
written to two places:
1. A `window` object. This works when front and back share a page, as in Anki desktop's
   reviewer.
2. anki-persistence, which uses `sessionStorage` on AnkiDroid, iOS and web.

If the back can't find state for *this* card, it shows a yellow warning and **hides the
answer** rather than risk a mismatch. A small grey line under each dynamic card shows the
seed and where the state came from (`loaded from memory` / `loaded from persistence`).
Use it to confirm that front and back match, and hide it in `style.css` (`.lat-debug`)
once you're satisfied.

**MathJax.** JS-inserted content is tagged `tex2jax_ignore`, so the client's own MathJax
pass skips it. The runtime then typesets it once, chained on `MathJax.startup.promise`
(MathJax 3; MathJax 2's `Hub.Queue` is also supported), and calls `typesetClear` on it
afterwards. Without this, the client's pass and ours can overlap and every formula
renders twice. That happened in testing.

**Shared JS file.** `build.py` concatenates the vendored persistence script,
`latrainer.js` and `generators.js` into `_latrainer-<hash>.js`:
- The leading underscore stops Check Media from deleting it.
- The content hash in the name means a changed script is a *new* file. Anki's importer
  won't replace an existing media file of the same name, and webviews cache scripts, so a
  fixed `_latrainer.js` would leave devices running stale code.
- Old bundles stay in the media folder. They're harmless (a few KB each) and can be
  deleted by hand.

## Stability rules (review history)

- **Never change an item's `id`.** Note GUIDs are `genanki.guid_for("latrainer", id)`, so
  content edits keep history but a renamed id is a brand-new note.
- **Never change the hardcoded model IDs or deck IDs** (`build.py` `MODEL_IDS`,
  `validate.py` `DECK_IDS`).
- **Don't change a note type's field list.** Anki then treats the import as a different
  note type. If you must, plan a manual migration.
- Moving an item to another YAML file (subdeck) does not move existing cards, because the
  importer doesn't change the deck of existing cards. Move them in the Anki browser.
- Excluding an item later (e.g. flipping it back to unverified) does not delete it from
  collections that already imported it.

## Adding a generator

1. In `templates/shared/generators.js`, add `LAT.register('name', { title, params(rng), solve(p), render(p, r) })`:
   - `params` must draw randomness **only** from `rng` (`rng.int(lo, hi)`,
     `rng.intNonZero`, `rng.pick`, `rng.float`) and return plain JSON.
   - `solve` returns plain JSON numbers/arrays.
   - `render` returns `{question, answer, solution}` HTML, with math in `\( \)` / `\[ \]`.
     Prefer `\[ \]` for anything wide, because inline math can't scroll on phones.
     Helpers: `LAT.tex.bmatrix`, `colvec`, `factor`.
2. Add a numpy reference to `REFERENCE` in `tests/make_fixtures.py`.
3. Run `.venv/bin/python tests/make_fixtures.py`. It refuses to write fixtures if JS
   disagrees with numpy.
4. Run `node tests/test_generators.js`.
5. Add a Procedural item to the right `content/*.yaml`:
   ```yaml
   procedural:
     - id: core.proc.projection        # permanent
       generator: projection
       prompt_hint: Optional one-line hint.
       tags: [projections]
   ```
6. Run `validate.py`, then `build.py`.

If you change an existing generator's `params()` on purpose, the fixture-params test will
fail. Regenerate with `make_fixtures.py --force`. Note that existing cards then produce
different instances, which is fine since nothing stores instances.

## Adding a concept (VariantPool) or Notation card

```yaml
variant_pool:
  - id: cogneuro.vp.rdm-structure        # permanent
    concept: Interpreting an RDM          # shown as the card header
    tags: [rsa]
    variants:                             # 4–8 recommended
      - verified: false
        prompt: >-
          …\( \)… or \[ \]…
        answer: >-
          …
        explanation: >-                   # optional
          …

notation:
  - id: core.notation.trace
    verified: false
    tags: [trace]
    front: >-
      What is \(\mathrm{tr}(A)\)?
    back: >-
      …
```

Content notes:
- Fields are HTML. Write `<br>` / `<b>`, and `&gt;` / `&lt;` for literal `>` / `<`.
- Use folded scalars (`>-`) so backslashes stay literal.
- Anki's MathJax uses `\( \)` and `\[ \]`, **not** `$`. The validator warns about `$`.

## The `verified` flag

Every Notation card and every VariantPool variant has a required `verified: bool`.
Anything an LLM writes starts as `false`. Once a human has checked the math and wording,
set it to `true`.
- **Default build:** unverified items are left out. A VariantPool note ships only its
  verified variants, and is omitted entirely if it has none.
- **`--include-unverified`:** everything ships. Unverified notes are tagged
  `LA::unverified` (search `tag:LA::unverified` in Anki) and show an **UNVERIFIED** badge.
  Unverified variants show an "unverified variant" badge.

## Acceptance tests (manual)

Build the mechanics-test deck with `.venv/bin/python build.py --include-unverified`.

**1. Desktop import and rendering.** In Anki desktop (23.10+ recommended; anything
2.1.50+ ships MathJax 3), use File → Import → `dist/latrainer.apkg`. Study `LA`. Check:
- [ ] Notation cards: math renders, and the UNVERIFIED badge is visible.
- [ ] Procedural (`matvec`): the matrix and vector render, and *Show Answer* gives the
  same matrix with the answer and worked solution. The grey line shows the same seed on
  both sides, with `loaded from memory`.
- [ ] VariantPool: a variant renders (`variant k/4`), and the answer belongs to the same variant.
- [ ] No formula appears twice and no raw `\(` is visible.

**2. Mobile (AnkiMobile).** Sync desktop → AnkiWeb → AnkiMobile, and let *media* sync
finish. Repeat test 1 on the phone and also check:
- [ ] Seeds match between front and back. **Record what the grey line says**
  (`memory` or `persistence`): it tells us how AnkiMobile handles the flip.
- [ ] Review the same Procedural card a few times (e.g. Again → relearn): each review
  draws a new instance.
- [ ] Wide matrices fit or scroll sideways, with nothing cut off.
- [ ] *If* you see the yellow "Could not recover…" warning during normal review, note
  where. That means persistence failed on that client.

**3. Edit → rebuild → re-import preserves scheduling.**
1. Review a few cards and note their due dates in the Browser (Card Info).
2. Edit content, e.g. change wording in `content/ml.yaml`. Also change something in
   `templates/style.css` or `generators.js` so the note type and JS bundle change.
3. Rebuild and import again. In the import dialog (Anki 23.10+): set **Update notes** to
   *If newer* or *Always*, and **Update note types** to *If newer* or *Always*. Leave
   "Merge note types" off.
4. Check:
   - [ ] Due dates and review history are unchanged.
   - [ ] The text edit is visible.
   - [ ] The new JS/CSS is in effect.
   - [ ] No duplicate note types (e.g. "LA Trainer: Procedural-a1b2c") were created.

**4. Light and dark mode.** Toggle night mode on desktop and on the phone.
- [ ] Text, badges, answer panels and the warning box are legible in both.

## Platform uncertainties

These were checked only in a browser harness that mimics Anki desktop's reviewer. It uses
the same script-execution order and MathJax 3.2 config, and was run with fresh-page and
same-page flips, light/dark, and 375 px width. **They have not been run in a real Anki
client.**

| # | Behavior | Desktop | AnkiMobile | AnkiDroid |
|---|---|---|---|---|
| 1 | Front→back state | Same page → `memory` (confident) | **Unknown** whether the flip reloads the page. Both paths are handled; the grey line will say which one is used | Fresh page per side → `sessionStorage` (per anki-persistence docs; untested) |
| 2 | Client's own MathJax pass and timing | MathJax 3, typesets after card scripts (from Anki source, from memory) | **Unknown** version and timing; v3 and v2 paths are both handled | MathJax 3 in recent versions; may load MathJax only when it sees math, hence the hidden `\(\,\)` preload span |
| 3 | `<script src="_file.js">` from media | Works | Widely used by add-on templates; **confirm** | Same; confirm |
| 4 | Night-mode class | `.nightMode` | **Unconfirmed** (`.nightMode` or `.night_mode`; both styled). AnkiMobile may also apply its own color inversion | `.night_mode` |
| 5 | Re-import replaces same-name media? | Believed **not** to; sidestepped with hashed file names | n/a (gets media by sync) | n/a |
| 6 | Template updates on re-import | Need **Update note types** ≠ Never (23.10+ dialog; option names may differ by version) | via sync | via sync |
| 7 | Card-layout editor / Browse preview | The back preview may show the "Could not recover" warning, which is expected because there's no front in that view | | |

## Known limitations / next steps

- The same variant can repeat on consecutive reviews, because nothing tracks history
  across sessions.
- Remaining prototype content to write after the mobile test:
  - generators for 2×2 determinant/inverse, projection, covariance, and correlation distance;
  - VariantPool concepts for collinearity, RDM structure, and PCA;
  - about 12 more Notation cards.
