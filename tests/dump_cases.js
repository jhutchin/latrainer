/*
 * Print {generator, seed, params, result} for the fixture seeds as JSON.
 * Used by tests/make_fixtures.py; not a test itself.
 */
var E = typeof require === 'function' ? require('./engine.js') : (load('tests/engine.js'), globalThis.__ENGINE__);
E.loadScript('templates/shared/latrainer.js');
E.loadScript('templates/shared/generators.js');
var LAT = globalThis.LAT;

var SEEDS = [1, 2, 3, 42, 1234, 99999, 2147483655, 4294967295];
var out = [];
Object.keys(LAT.generators).sort().forEach(function (name) {
  SEEDS.forEach(function (seed) {
    var inst = LAT.instantiate(name, seed);
    out.push({ generator: name, seed: seed, params: inst.params, result: inst.result });
  });
});
E.print(JSON.stringify(out));
