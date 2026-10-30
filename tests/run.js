// node tests/run.js — no dependencies.
import { SKILLS, byId } from '../src/skills/index.js';
import { Rng } from '../src/rng.js';
import { Frac } from '../src/frac.js';
import { parseEntry, grade } from '../src/grade.js';
import * as P from '../src/progress.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SEEDS = 400;
const asJson = (x) => JSON.stringify(x, (k, v) => (v instanceof Frac ? v.toString() : v));

function balanced(s) {
  let depth = 0;
  for (const ch of s.replace(/\\[{}]/g, '')) {
    if (ch === '{') depth++;
    if (ch === '}' && --depth < 0) return false;
  }
  return depth === 0 && s.split('\\[').length === s.split('\\]').length &&
    s.split('\\(').length === s.split('\\)').length &&
    s.split('\\begin').length === s.split('\\end').length;
}

/* ---- skill graph */

test('skill graph: prereqs exist and come earlier', () => {
  SKILLS.forEach((s, i) => s.prereqs.forEach((p) => {
    assert(byId[p], `${s.id}: unknown prereq ${p}`);
    assert(SKILLS.indexOf(byId[p]) < i, `${s.id}: prereq ${p} comes later`);
  }));
});

/* ---- generators */

for (const skill of SKILLS) {
  skill.levels.forEach((_, li) => {
    const level = li + 1;
    const tag = `${skill.id} L${level}`;

    test(`${tag}: deterministic per seed`, () => {
      for (let seed = 0; seed < 50; seed++) {
        const a = asJson(skill.generate(level, new Rng(seed)));
        const b = asJson(skill.generate(level, new Rng(seed)));
        assert(a === b, `seed ${seed} differs`);
      }
    });

    test(`${tag}: well-formed over ${SEEDS} seeds`, () => {
      const seen = new Set();
      for (let seed = 0; seed < SEEDS; seed++) {
        const p = skill.generate(level, new Rng(seed));
        for (const field of ['prompt', 'solution']) {
          assert(typeof p[field] === 'string' && p[field].length > 0, `seed ${seed}: empty ${field}`);
          assert(!/NaN|undefined|Infinity|\[object/.test(p[field]), `seed ${seed}: bad token in ${field}`);
          assert(balanced(p[field]), `seed ${seed}: unbalanced TeX in ${field}`);
        }
        const vals = p.answer.values;
        assert(Array.isArray(vals) && vals.length > 0 && vals.every((r) => r.length === vals[0].length), `seed ${seed}: ragged answer`);
        assert(vals.flat().every((v) => Number.isFinite(+v)), `seed ${seed}: non-finite answer`);
        seen.add(asJson(p.data));
      }
      assert(seen.size > SEEDS * 0.5, `only ${seen.size} distinct problems in ${SEEDS} seeds`);
    });
  });
}

// Levels promised to have whole-number answers.
const INTEGER_LEVELS = { dot: [1, 2, 3], matvec: [1, 2, 3], projection: [1], lstsq: [1, 2, 3] };
for (const [id, levels] of Object.entries(INTEGER_LEVELS)) {
  test(`${id}: integer answers at levels ${levels}`, () => {
    for (const level of levels) {
      for (let seed = 0; seed < SEEDS; seed++) {
        const p = byId[id].generate(level, new Rng(seed));
        assert(p.answer.values.flat().every((v) => Frac.of(v).isInt()), `L${level} seed ${seed}: ${asJson(p.answer.values)}`);
      }
    }
  });
}

test('projection L2/L3: produces fractional answers sometimes', () => {
  for (const level of [2, 3]) {
    let fracs = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (byId.projection.generate(level, new Rng(seed)).answer.values.flat().some((v) => !Frac.of(v).isInt())) fracs++;
    }
    assert(fracs > 100, `L${level}: only ${fracs}/200 fractional`);
  }
});

test('lstsq: noise is nonzero (data never fit exactly)', () => {
  for (const level of [1, 2, 3]) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { data: { X, y }, answer } = byId.lstsq.generate(level, new Rng(seed));
      const b = answer.values.flat().map(Number);
      const resid = y.map((yi, i) => yi - X[i].reduce((s, x, j) => s + x * b[j], 0));
      assert(resid.some((r) => r !== 0), `L${level} seed ${seed}: exact fit`);
    }
  }
});

/* ---- grading */

test('parseEntry accepts numbers, decimals, fractions', () => {
  const ok = { '3': 3, '-2': -2, '0.75': 0.75, '.5': 0.5, '3/4': 0.75, '-3/4': -0.75, '3/-4': -0.75, ' 7 ': 7, '−5': -5, '2.': 2 };
  for (const [s, v] of Object.entries(ok)) assert(parseEntry(s)?.value === v, `${s} -> ${parseEntry(s)?.value}`);
  for (const s of ['', '-', '/', '3/', '/4', '1/0', '1..2', 'abc', '3/4/5', '--3']) assert(parseEntry(s) === null, `${s} should be rejected`);
});

test('grade: exact, rounded decimals, wrong, incomplete', () => {
  const t = [[new Frac(2, 3)], [new Frac(-5)]];
  assert(grade(['2/3', '-5'], t).correct, 'exact');
  assert(grade(['4/6', '-5.0'], t).correct, 'equivalent');
  assert(grade(['0.67', '-5'], t).correct, '0.67 ~ 2/3');
  assert(grade(['0.667', '-5'], t).correct, '0.667 ~ 2/3');
  assert(!grade(['0.66', '-5'], t).correct, '0.66 is not 2/3');
  assert(!grade(['0.7', '-5'], t).correct, '0.7 is too coarse');
  const r = grade(['2/3', '5'], t);
  assert(!r.correct && r.cells[0] && !r.cells[1], 'per-cell flags');
  assert(grade(['2/3', ''], t) === null, 'blank -> null');
});

/* ---- progression */

const attempt = (st, id, correct, t = 0) => {
  const skill = byId[id];
  return P.recordAttempt(st, SKILLS, skill, { level: P.skillState(st, id).level, correct, t });
};

test('progress: only dot unlocked at start', () => {
  const st = P.newState();
  const unlocked = SKILLS.filter((s) => P.isUnlocked(st, s)).map((s) => s.id);
  assert(asJson(unlocked) === '["dot"]', asJson(unlocked));
});

test('progress: 4 of 5 correct levels up and unlocks dependents', () => {
  const st = P.newState();
  const evs = [true, true, false, true, true].flatMap((c) => attempt(st, 'dot', c));
  assert(P.skillState(st, 'dot').level === 2, `level ${P.skillState(st, 'dot').level}`);
  const types = evs.map((e) => `${e.type}:${e.skill}`);
  assert(types.includes('levelUp:dot') && types.includes('unlocked:matvec') && types.includes('unlocked:projection'), asJson(types));
  assert(!P.isUnlocked(st, byId.lstsq), 'lstsq needs matvec and projection');
});

test('progress: unlocks stick when a prereq drops a level', () => {
  const st = P.newState();
  for (let i = 0; i < 4; i++) attempt(st, 'dot', true);
  assert(P.isUnlocked(st, byId.matvec), 'matvec unlocked');
  for (let i = 0; i < 4; i++) attempt(st, 'dot', false);
  assert(P.skillState(st, 'dot').level === 1, 'dot dropped');
  assert(P.isUnlocked(st, byId.matvec), 'matvec still unlocked');
});

test('progress: 3 misses of 4 drops a level, never below 1', () => {
  const st = P.newState();
  for (let i = 0; i < 4; i++) attempt(st, 'dot', true);
  assert(P.skillState(st, 'dot').level === 2, 'reached 2');
  [false, false, true, false].forEach((c) => attempt(st, 'dot', c));
  assert(P.skillState(st, 'dot').level === 1, 'dropped to 1');
  for (let i = 0; i < 6; i++) attempt(st, 'dot', false);
  assert(P.skillState(st, 'dot').level === 1, 'floor at 1');
});

test('progress: mastery after top level, then two review misses unmaster', () => {
  const st = P.newState();
  for (let i = 0; i < 12; i++) attempt(st, 'dot', true);
  const s = P.skillState(st, 'dot');
  assert(s.mastered && s.level === 3, asJson(s));
  attempt(st, 'dot', false);
  assert(s.mastered, 'one miss keeps mastery');
  attempt(st, 'dot', false);
  assert(!s.mastered, 'two misses lose mastery');
});

test('lesson: active skills interleave and new unlocks join mid-lesson', () => {
  const st = P.newState();
  const rng = new Rng(1);
  const lesson = P.newLesson(st, SKILLS, { now: 0 });
  const seen = [];
  while (true) {
    const item = P.pickNext(st, SKILLS, lesson, rng, 0);
    seen.push(item.skill.id);
    P.recordAttempt(st, SKILLS, item.skill, { level: item.level, correct: true, t: 0 });
    if (P.advance(lesson, item, true)) break;
  }
  assert(seen.length === P.RULES.lessonLength, `length ${seen.length}`);
  assert(seen.slice(0, 4).every((s) => s === 'dot'), 'starts on dot');
  assert(seen.slice(4).some((s) => s !== 'dot'), `unlocked skills never appeared: ${seen}`);
  for (let i = 5; i < seen.length; i++) assert(seen[i] !== seen[i - 1], `repeat at ${i}: ${seen}`);
});

test('lesson: due mastered skills come back as reviews, then spacing grows', () => {
  const st = P.newState();
  const DAY = 864e5;
  for (let i = 0; i < 12; i++) attempt(st, 'dot', true, 0);
  P.finishLesson(st, { results: [{ skill: 'dot', correct: true }] }, 0);
  assert(P.skillState(st, 'dot').due === DAY, `due ${P.skillState(st, 'dot').due}`);

  const now = 2 * DAY;
  const lesson = P.newLesson(st, SKILLS, { now });
  assert(lesson.reviewTarget === 1, `reviewTarget ${lesson.reviewTarget}`);
  const rng = new Rng(3);
  const roles = [];
  while (true) {
    const item = P.pickNext(st, SKILLS, lesson, rng, now);
    roles.push(`${item.role}:${item.skill.id}`);
    if (P.advance(lesson, item, true)) break;
  }
  assert(roles.filter((r) => r === 'review:dot').length === 1, roles.join(' '));
  P.finishLesson(st, lesson, now);
  assert(P.skillState(st, 'dot').interval === 2.5, `interval ${P.skillState(st, 'dot').interval}`);
});

test('lesson: focus practices only that skill', () => {
  const st = P.newState();
  const lesson = P.newLesson(st, SKILLS, { focus: 'dot' });
  const rng = new Rng(2);
  const ids = new Set();
  while (true) {
    const item = P.pickNext(st, SKILLS, lesson, rng);
    ids.add(item.skill.id);
    if (P.advance(lesson, item, true)) break;
  }
  assert(ids.size === 1 && ids.has('dot') && lesson.results.length === P.RULES.focusLength, [...ids].join());
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
