# LA Trainer

Adaptive linear algebra practice in the browser. Problems are generated fresh each
time, answers are auto-graded, and each skill ramps through difficulty levels. Mastered
skills come back as spaced reviews.

**Status:** early prototype. There are 4 skills (dot product → matrix–vector product,
projection → least squares), each with 3 levels. Progress is stored only on the device.
There are no accounts and no server.

The earlier Anki-deck prototype was removed in this rewrite. It lives in git history at
commit `21d34d5`.

## Use it

It's a static site, so any static host works. On GitHub Pages, use **Settings → Pages →
Deploy from a branch**, with the branch and `/ (root)`.

On iPhone, open the site in Safari, then use **Share → Add to Home Screen**. Use the
home-screen app consistently. iOS keeps its storage separate from Safari's, and Safari
may clear site data for sites you haven't opened in a while. **Export progress** on the
home screen saves a JSON backup, and **Import** restores it.

Run it locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. ES modules don't load from `file://`, so you need a
server.

## How it works

**Skills** live in `src/skills/`, one file each. A skill has prerequisites and a list of
levels, and provides `generate(level, rng)`. That returns:
- the prompt;
- the answer as rows of exact values (integers or `Frac`);
- a worked solution;
- the raw inputs (`data`), so tests can re-solve the problem independently.

Problems are deterministic given a seed (mulberry32 RNG).

**Difficulty within a skill** comes from three things:
- bigger dimensions;
- signed entries, or fractional answers;
- variation in how the question is asked (e.g. `u·v`, `uᵀv` or `⟨u, v⟩`, and asking
  for the projection or for the residual).

Some generators construct the problem backwards so that answers come out as whole
numbers. For example, least-squares data is built as a fit plus noise orthogonal to the
columns of X.

**Progression** (`src/progress.js`). The thresholds are in `RULES`.

| Rule | Value |
|---|---|
| Level up | 4 of the last 5 attempts at the current level correct |
| Drop a level | 3 of the last 4 wrong |
| Mastered | Passing the top level |
| Unlock a skill | Every prerequisite at level 2 or above. Unlocks are permanent. |
| Lesson | 10 problems, interleaved across up to 2 unmastered skills, plus up to 3 reviews of skills that are due |
| Review spacing | 1 day, then ×2.5 after each lesson where the skill had no misses. Any miss resets it to 1 day. |
| Losing mastery | Two misses in a row on reviews puts a mastered skill back into active practice |

The next problem is chosen one step at a time, so a skill unlocked mid-lesson joins the
same lesson. **Practice** on a skill card runs 8 problems of just that skill.

**Answers** can be typed as integers, fractions (`3/4`) or decimals. A decimal with at
least 2 places counts as rounded, so `0.67` is accepted for 2/3. The on-screen keypad
avoids iOS's decimal keyboard, which has no minus key. Physical keyboards also work:
digits, `-`, `/`, `.`, Tab/arrows to move between cells, and Enter to check.

**Math** is rendered with KaTeX 0.16.11, vendored in `vendor/katex/` (MIT) so the app
needs no CDN.

## Layout

```
index.html, style.css, manifest.webmanifest, icons/
src/
  app.js          UI: home, lesson, summary
  progress.js     learner model, lesson planning, review scheduling
  grade.js        answer parsing and checking
  skills/         one generator per skill, plus index.js (registry and order)
  rng.js, frac.js, la.js, tex.js
tests/
  run.js          generators, grading, progression (Node, no dependencies)
  check_numpy.py  re-solves every generated problem with numpy
  dump_cases.js   used by check_numpy.py
vendor/katex/
```

## Tests

```bash
node tests/run.js
```

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python tests/check_numpy.py
```

`run.js` checks each skill and level over 400 seeds. It covers:
- determinism per seed;
- well-formed TeX with no `NaN` or `undefined`;
- variety of generated problems;
- the levels promised to give whole-number answers;
- least-squares problems never fitting exactly.

It also covers answer parsing and grading, and the progression rules.

## Adding a skill

1. Write `src/skills/<id>.js`, following an existing skill. Draw randomness only from
   `rng`. Use `Frac` / `la.js` for exact answers, and `tex.row(...)` for the givens so
   they wrap on phones.
2. Register it in `src/skills/index.js`, after its prerequisites.
3. Add a numpy reference in `expected()` in `tests/check_numpy.py`.
4. Run both test commands.

Skill ids and level numbers are stored in saved progress, so don't rename an id. Adding
levels at the end is safe.

## Next steps

- Use it for a while. Check whether the thresholds and lesson length feel right.
- More procedural skills: 2×2 determinant and inverse, matrix–matrix product, covariance
  matrices, correlation distance.
- Conceptual items (GLM contrasts, RDMs, PCA) as auto-graded multiple choice. These have
  to be written and checked by hand.
- Offline support (service worker), if needed.
