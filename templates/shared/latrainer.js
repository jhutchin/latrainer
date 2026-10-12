/*
 * latrainer.js: shared runtime for the LA trainer note types.
 *
 * build.py concatenates  vendor/anki-persistence.js + latrainer.js + generators.js
 * into one media file, _latrainer-<hash>.js, which every dynamic template loads.
 *
 * Constraints that shape this file:
 *  - Anki desktop re-executes card scripts on every card inside one long-lived
 *    webview, so this file must be safe to run repeatedly: no top-level
 *    let/const, and anything that must survive (front -> back state) lives on
 *    window, not in this closure.
 *  - It must also load under Node / JavaScriptCore for the generator tests, so
 *    nothing here touches the DOM at load time.
 *  - ES5 syntax only, to be conservative about mobile webviews.
 */
(function (root) {
  'use strict';

  var LAT = {};
  LAT.VERSION = '0.1.0';

  /* ------------------------------------------------------------------ RNG */

  // mulberry32: tiny, fast, good enough for problem generation, and
  // bit-identical across JS engines (uses only 32-bit integer ops).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Rng(seed) { this._next = mulberry32(seed); }
  Rng.prototype.float = function () { return this._next(); };
  // Uniform integer in [lo, hi], inclusive.
  Rng.prototype.int = function (lo, hi) {
    return lo + Math.floor(this._next() * (hi - lo + 1));
  };
  Rng.prototype.intNonZero = function (lo, hi) {
    var v;
    do { v = this.int(lo, hi); } while (v === 0);
    return v;
  };
  Rng.prototype.pick = function (arr) { return arr[this.int(0, arr.length - 1)]; };
  LAT.Rng = Rng;

  function freshSeed() {
    try {
      if (root.crypto && root.crypto.getRandomValues) {
        var buf = new Uint32Array(1);
        root.crypto.getRandomValues(buf);
        return buf[0];
      }
    } catch (e) { /* fall through */ }
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
  LAT.freshSeed = freshSeed;

  /* ------------------------------------------------------------ TeX utils */

  var tex = {
    // Wrap negatives in parentheses when they appear as factors: 2\cdot(-3).
    factor: function (x) { return x < 0 ? '(' + x + ')' : String(x); },
    bmatrix: function (rows) {
      var body = [];
      for (var i = 0; i < rows.length; i++) body.push(rows[i].join(' & '));
      return '\\begin{bmatrix} ' + body.join(' \\\\ ') + ' \\end{bmatrix}';
    },
    colvec: function (v) {
      var rows = [];
      for (var i = 0; i < v.length; i++) rows.push([v[i]]);
      return tex.bmatrix(rows);
    },
    inline: function (s) { return '\\(' + s + '\\)'; },
    display: function (s) { return '\\[' + s + '\\]'; }
  };
  LAT.tex = tex;

  /* ------------------------------------------------------- generator registry */

  // A generator is { title, params(rng) -> params, solve(params) -> result,
  //                  render(params, result) -> {question, answer, solution} }.
  // params and result must be plain JSON (numbers / arrays / objects) so the
  // tests can compare them with numpy fixtures.
  LAT.generators = {};
  LAT.register = function (name, gen) {
    if (LAT.generators[name]) throw new Error('Duplicate generator: ' + name);
    LAT.generators[name] = gen;
  };
  LAT.instantiate = function (name, seed) {
    var gen = LAT.generators[name];
    if (!gen) throw new Error('Unknown generator "' + name + '"');
    var rng = new Rng(seed);
    var params = gen.params(rng);
    var result = gen.solve(params);
    return { params: params, result: result, view: gen.render(params, result) };
  };

  /* ---------------------------------------------------- front/back state */

  // Front generates a seed and saves {kind, id, seed}; back loads it and
  // re-derives the identical problem. Two backends:
  //   memory: an object on window. Works when front and back share a page
  //           (Anki desktop's reviewer; possibly AnkiMobile).
  //   Persistence: vendored anki-persistence (sessionStorage on AnkiDroid /
  //           iOS / web; window.py / window.qt on old desktop builds).
  // Back prefers memory: if it exists, it was written by the front that is
  // still on screen in this very page.
  var STATE_KEY = 'latrainer.state.v1';

  function memory() {
    if (!root.__LAT_MEMORY__) root.__LAT_MEMORY__ = {};
    return root.__LAT_MEMORY__;
  }

  function persistence() {
    try {
      if (root.Persistence && root.Persistence.isAvailable()) return root.Persistence;
    } catch (e) { /* ignore */ }
    return null;
  }

  LAT.store = {
    save: function (state) {
      var used = [];
      memory()[STATE_KEY] = state;
      used.push('memory');
      var p = persistence();
      if (p) {
        try { p.setItem(STATE_KEY, state); used.push('persistence'); } catch (e) { /* ignore */ }
      }
      return used.join('+');
    },
    load: function () {
      var m = memory()[STATE_KEY];
      if (m) return { state: m, source: 'memory' };
      var p = persistence();
      if (p) {
        try {
          var s = p.getItem(STATE_KEY);
          if (s) return { state: s, source: 'persistence' };
        } catch (e) { /* ignore */ }
      }
      return { state: null, source: p ? 'persistence(empty)' : 'none' };
    }
  };

  /* ------------------------------------------------------------ MathJax */

  var RAW_MATH = /\\\(|\\\[/;

  function hasRawMath(els) {
    for (var i = 0; i < els.length; i++) {
      if (els[i] && RAW_MATH.test(els[i].textContent || '')) return true;
    }
    return false;
  }

  // Typesetting JS-inserted math without double rendering.
  //
  // The host client (Anki desktop, AnkiDroid, AnkiMobile) runs its own MathJax
  // pass over the card, at a time we don't control: after card scripts on
  // desktop, at MathJax startup on fresh pages. If its pass and ours overlap,
  // both find the same raw TeX and every formula renders twice (reproduced in
  // a desktop-like harness). So:
  //   1. mount() inserts content inside .tex2jax_ignore (MathJax's standard
  //      opt-out class, which the host's pass skips);
  //   2. we chain on MathJax.startup.promise (MathJax 3's serialization point),
  //      then in one synchronous step remove the class and start our typeset.
  //   3. afterwards typesetClear() our items so a later host pass can't
  //      re-render them.
  // Supports MathJax 3 (typesetPromise) and MathJax 2 (Hub.Queue), and waits
  // for MathJax to load if it isn't there yet.
  var IGNORE = 'tex2jax_ignore';
  function reveal(els) {
    for (var i = 0; i < els.length; i++) if (els[i]) els[i].classList.remove(IGNORE);
  }
  LAT.hideFromHostTypeset = function (els) {
    for (var i = 0; i < els.length; i++) if (els[i]) els[i].classList.add(IGNORE);
  };

  LAT.typeset = function (els, attempt) {
    attempt = attempt || 0;
    // Drop missing elements: MathJax treats a null entry as "the whole
    // document", which typesets the card a second time.
    var present = [];
    for (var k = 0; k < els.length; k++) if (els[k]) present.push(els[k]);
    els = present;
    if (!els.length) return;
    var MJ = root.MathJax;
    var v3 = MJ && (typeof MJ.typesetPromise === 'function' ||
                    (MJ.startup && MJ.startup.promise && typeof MJ.startup.promise.then === 'function'));
    if (v3) {
      var start = (MJ.startup && MJ.startup.promise) || Promise.resolve();
      var p = start.then(function () {
        if (typeof MJ.typesetPromise !== 'function') throw new Error('MathJax.typesetPromise unavailable');
        reveal(els);
        if (!hasRawMath(els)) return null;
        return MJ.typesetPromise(els).then(function () {
          // Forget the math we just rendered (the output stays on the page).
          // Otherwise a later typeset pass by the host client re-renders
          // these same items and the math appears twice.
          if (typeof MJ.typesetClear === 'function') MJ.typesetClear(els);
        });
      }).catch(function (err) {
        if (root.console) root.console.warn('[latrainer] MathJax typeset failed', err);
      });
      if (MJ.startup) MJ.startup.promise = p; // serialize with other typeset calls
      return;
    }
    if (MJ && MJ.Hub && typeof MJ.Hub.Queue === 'function') {
      MJ.Hub.Queue(function () { reveal(els); });
      for (var i = 0; i < els.length; i++) if (els[i]) MJ.Hub.Queue(['Typeset', MJ.Hub, els[i]]);
      return;
    }
    if (attempt < 100) { // ~5 s
      setTimeout(function () { LAT.typeset(els, attempt + 1); }, 50);
      return;
    }
    reveal(els);
    for (var j = 0; j < els.length; j++) {
      if (els[j] && hasRawMath([els[j]])) {
        els[j].insertAdjacentHTML('afterbegin',
          '<div class="lat-warn">MathJax is not available here, so math is shown as raw TeX.</div>');
      }
    }
  };

  /* ------------------------------------------------------------ renderers */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var KINDS = {};

  KINDS.procedural = function (host, cfg, state) {
    var inst = LAT.instantiate(cfg.generator, state.seed);
    return {
      question: inst.view.question,
      answer: '<div class="lat-answer">' + inst.view.answer + '</div>' +
        '<div class="lat-solution"><div class="lat-label">Worked solution</div>' +
        inst.view.solution + '</div>',
      debug: cfg.generator
    };
  };

  KINDS.variant_pool = function (host, cfg, state) {
    var wrap = host.parentNode;
    var dataEl = wrap && wrap.querySelector('script.lat-variants');
    if (!dataEl) throw new Error('variants data block not found in template');
    var variants = JSON.parse(dataEl.textContent);
    if (!variants || !variants.length) throw new Error('this note has no variants');
    var idx = new Rng(state.seed).int(0, variants.length - 1);
    var v = variants[idx];
    var badge = v.verified === false
      ? '<div class="lat-unverified-inline">unverified variant</div>' : '';
    return {
      question: badge + '<div class="lat-prompt">' + v.prompt + '</div>',
      answer: '<div class="lat-answer">' + v.answer + '</div>' +
        (v.explanation
          ? '<div class="lat-solution"><div class="lat-label">Why</div>' + v.explanation + '</div>'
          : ''),
      debug: 'variant ' + (idx + 1) + '/' + variants.length
    };
  };

  function warnHtml(title, detail) {
    return '<div class="lat-warn"><strong>' + esc(title) + '</strong><br>' + detail + '</div>';
  }

  // Entry point, called by the boot snippet in each dynamic template with the
  // #lat-root element. Config comes from its data-* attributes.
  LAT.mount = function (host) {
    var cfg = {
      kind: host.getAttribute('data-kind'),
      side: host.getAttribute('data-side'),
      id: host.getAttribute('data-id'),
      generator: host.getAttribute('data-generator')
    };
    var qEl = host.querySelector('.lat-q');
    var aEl = host.querySelector('.lat-a');
    var dbgEl = host.querySelector('.lat-debug');
    try {
      var renderer = KINDS[cfg.kind];
      if (!renderer) throw new Error('unknown note kind "' + cfg.kind + '"');

      var state, source;
      if (cfg.side === 'front') {
        state = { kind: cfg.kind, id: cfg.id, seed: freshSeed(), t: Date.now() };
        source = 'saved to ' + LAT.store.save(state);
      } else {
        var got = LAT.store.load();
        state = got.state;
        source = 'loaded from ' + got.source;
        if (!state || state.kind !== cfg.kind || state.id !== cfg.id) {
          var why = !state
            ? 'No saved state was found (backend: ' + esc(got.source) + ').'
            : 'Saved state belongs to a different card (' + esc(state.id) + ').';
          qEl.innerHTML = warnHtml(
            'Could not recover the problem shown on the front.',
            why + ' The answer is hidden so it can\'t be mismatched with the question. ' +
            'This is expected in the card-layout preview. If it happens during review, ' +
            'please note the platform; grade from memory or press Again.');
          if (dbgEl) dbgEl.textContent = 'id ' + cfg.id + ' · ' + source + ' · v' + LAT.VERSION;
          return;
        }
      }

      var view = renderer(host, cfg, state);
      LAT.hideFromHostTypeset([qEl, aEl]);
      qEl.innerHTML = view.question;
      if (cfg.side === 'back' && aEl) aEl.innerHTML = view.answer;
      if (dbgEl) {
        dbgEl.textContent = 'seed ' + ('00000000' + (state.seed >>> 0).toString(16)).slice(-8) +
          ' · ' + view.debug + ' · ' + source + ' · v' + LAT.VERSION;
      }
      LAT.typeset([qEl, aEl]);
    } catch (err) {
      qEl.innerHTML = warnHtml('This card failed to render.', esc(err && err.message ? err.message : err));
      if (root.console) root.console.error('[latrainer]', err);
    }
  };

  root.LAT = LAT;
})(typeof window !== 'undefined' ? window : globalThis);
