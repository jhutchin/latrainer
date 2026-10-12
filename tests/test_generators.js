/*
 * Generator tests.   node tests/test_generators.js
 *   (fallback without Node, from the repo root:
 *    /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/test_generators.js)
 *
 * For every registered generator:
 *   1. fixtures exist (tests/fixtures/<name>.json, made by make_fixtures.py)
 *   2. fixed seed -> identical params (determinism / regression)
 *   3. solve(params) matches the numpy reference answer saved in the fixture
 *   4. render() output is well-formed for many seeds (strings, balanced TeX,
 *      no NaN/undefined) and deterministic
 */
var E = typeof require === 'function' ? require('./engine.js') : (load('tests/engine.js'), globalThis.__ENGINE__);
E.loadScript('templates/shared/latrainer.js');
E.loadScript('templates/shared/generators.js');
var LAT = globalThis.LAT;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; E.print('ok    ' + name); }
  catch (e) { failed++; E.print('FAIL  ' + name + '\n      ' + (e && e.message)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// JSON with sorted keys, so structural comparison ignores key order.
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') {
    return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
  }
  return JSON.stringify(x);
}

function assertClose(actual, expected, path, tol) {
  tol = tol || 1e-9;
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual) && actual.length === expected.length,
      path + ': expected array of length ' + expected.length + ', got ' + JSON.stringify(actual));
    for (var i = 0; i < expected.length; i++) assertClose(actual[i], expected[i], path + '[' + i + ']', tol);
  } else if (expected && typeof expected === 'object') {
    var ek = Object.keys(expected).sort().join(','), ak = Object.keys(actual || {}).sort().join(',');
    assert(ek === ak, path + ': keys ' + ak + ' != expected ' + ek);
    for (var k in expected) assertClose(actual[k], expected[k], path + '.' + k, tol);
  } else if (typeof expected === 'number') {
    assert(typeof actual === 'number' && Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)),
      path + ': ' + actual + ' != numpy ' + expected);
  } else {
    assert(actual === expected, path + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
  }
}

function count(s, sub) { return s.split(sub).length - 1; }
function assertWellFormed(html, where) {
  assert(typeof html === 'string' && html.length > 0, where + ': empty or not a string');
  assert(!/NaN|undefined|Infinity|\[object /.test(html), where + ': contains NaN/undefined/Infinity/[object');
  assert(count(html, '\\(') === count(html, '\\)'), where + ': unbalanced \\( \\)');
  assert(count(html, '\\[') === count(html, '\\]'), where + ': unbalanced \\[ \\]');
  assert(count(html, '\\begin{') === count(html, '\\end{'), where + ': unbalanced \\begin/\\end');
}

/* ---- RNG ---- */
test('rng: same seed -> same sequence', function () {
  var a = new LAT.Rng(7), b = new LAT.Rng(7);
  for (var i = 0; i < 100; i++) assert(a.float() === b.float(), 'diverged at ' + i);
});
test('rng: known first value for seed 1 (engine-independent)', function () {
  // Pinned so a silent change to mulberry32 breaks loudly.
  var v = new LAT.Rng(1).float();
  assert(v === 0.6270739405881613, 'got ' + v);
});
test('rng: int(lo, hi) covers range inclusively and stays in bounds', function () {
  var r = new LAT.Rng(123), seen = {};
  for (var i = 0; i < 5000; i++) {
    var x = r.int(-3, 3);
    assert(x >= -3 && x <= 3 && x === Math.floor(x), 'out of range: ' + x);
    seen[x] = true;
  }
  for (var k = -3; k <= 3; k++) assert(seen[k], 'never produced ' + k);
});

/* ---- generators ---- */
var names = Object.keys(LAT.generators).sort();
test('at least one generator registered', function () { assert(names.length > 0, 'none'); });

names.forEach(function (name) {
  var fixturePath = 'tests/fixtures/' + name + '.json';

  test(name + ': fixture file exists', function () {
    assert(E.exists(fixturePath), 'missing ' + fixturePath + '; run: python tests/make_fixtures.py');
  });
  if (!E.exists(fixturePath)) return;
  var fixture = JSON.parse(E.read(fixturePath));

  test(name + ': fixed seeds reproduce fixture params', function () {
    fixture.cases.forEach(function (c) {
      var p = LAT.generators[name].params(new LAT.Rng(c.seed));
      assert(canon(p) === canon(c.params), 'seed ' + c.seed + ': params ' + canon(p) + ' != fixture ' + canon(c.params));
    });
  });

  test(name + ': solve() matches numpy reference (' + fixture.cases.length + ' cases)', function () {
    fixture.cases.forEach(function (c) {
      assertClose(LAT.generators[name].solve(c.params), c.expected, 'seed ' + c.seed);
    });
  });

  test(name + ': render() well-formed and deterministic for 300 seeds', function () {
    for (var seed = 0; seed < 300; seed++) {
      var v1 = LAT.instantiate(name, seed).view;
      var v2 = LAT.instantiate(name, seed).view;
      ['question', 'answer', 'solution'].forEach(function (k) {
        assertWellFormed(v1[k], 'seed ' + seed + ' ' + k);
        assert(v1[k] === v2[k], 'seed ' + seed + ' ' + k + ' not deterministic');
      });
    }
  });
});

E.print('\n' + passed + ' passed, ' + failed + ' failed  [' + E.name + ']');
if (failed) E.fail(failed + ' test(s) failed');
