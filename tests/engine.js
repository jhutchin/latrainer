/*
 * Tiny engine shim so the generator tests run under Node (the intended runner)
 * or, as a fallback, macOS's built-in JavaScriptCore shell `jsc`.
 * Paths are relative to the repo root (under jsc, run from the repo root).
 */
(function () {
  var isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
  var E = {};
  if (isNode) {
    var fs = require('fs');
    var path = require('path');
    var ROOT = path.resolve(__dirname, '..');
    E.name = 'node ' + process.version;
    E.read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
    E.exists = function (rel) { return fs.existsSync(path.join(ROOT, rel)); };
    E.loadScript = function (rel) { require(path.join(ROOT, rel)); };
    E.print = function (s) { console.log(s); };
    E.fail = function (msg) { console.error(msg); process.exit(1); };
    module.exports = E;
  } else {
    E.name = 'jsc';
    E.read = function (rel) { return readFile(rel); };
    E.exists = function (rel) { try { readFile(rel); return true; } catch (e) { return false; } };
    E.loadScript = function (rel) { load(rel); };
    E.print = function (s) { print(s); };
    E.fail = function (msg) { throw new Error(msg); }; // jsc exits non-zero on uncaught throw
    globalThis.__ENGINE__ = E;
  }
})();
