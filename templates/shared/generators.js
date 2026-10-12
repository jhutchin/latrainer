/*
 * generators.js: procedural problem generators.
 *
 * Each generator is registered with LAT.register('<name>', {...}); the name is
 * what a Procedural note's `generator` field refers to (validate.py scans this
 * file for register('...') calls). See README "Adding a generator".
 *
 * Contract:
 *   params(rng)            -> plain-JSON parameters, drawn ONLY from rng
 *   solve(params)          -> plain-JSON result (checked against numpy fixtures)
 *   render(params, result) -> { question, answer, solution } HTML strings,
 *                             math in \( \) / \[ \]
 */
(function (root) {
  'use strict';
  var LAT = root.LAT;
  var tex = LAT.tex;

  /* ------------------------------------------------ matrix-vector product */

  LAT.register('matvec', {
    title: 'Matrix–vector product',

    params: function (rng) {
      var m = rng.int(2, 3), n = rng.int(2, 3);
      var A = [], x = [], i, j, allZero = true;
      for (i = 0; i < m; i++) {
        A.push([]);
        for (j = 0; j < n; j++) A[i].push(rng.int(-4, 4));
      }
      for (j = 0; j < n; j++) {
        x.push(rng.int(-3, 3));
        if (x[j] !== 0) allZero = false;
      }
      if (allZero) x[rng.int(0, n - 1)] = rng.intNonZero(-3, 3);
      return { A: A, x: x };
    },

    solve: function (p) {
      var y = [];
      for (var i = 0; i < p.A.length; i++) {
        var s = 0;
        for (var j = 0; j < p.x.length; j++) s += p.A[i][j] * p.x[j];
        y.push(s);
      }
      return { y: y };
    },

    render: function (p, r) {
      var m = p.A.length, n = p.x.length, i, j;

      var question =
        'Compute \\(A\\mathbf{x}\\).' +
        tex.display('A = ' + tex.bmatrix(p.A) + ', \\qquad \\mathbf{x} = ' + tex.colvec(p.x));

      var answer = tex.display('A\\mathbf{x} = ' + tex.colvec(r.y));

      // Row view: each entry is a dot product.
      var lines = [];
      for (i = 0; i < m; i++) {
        var terms = [];
        for (j = 0; j < n; j++) terms.push(tex.factor(p.A[i][j]) + '\\cdot ' + tex.factor(p.x[j]));
        lines.push('y_' + (i + 1) + ' &= ' + terms.join(' + ') + ' = ' + r.y[i]);
      }
      // Column view: a weighted sum of A's columns.
      var cols = [];
      for (j = 0; j < n; j++) {
        var col = [];
        for (i = 0; i < m; i++) col.push(p.A[i][j]);
        cols.push(tex.factor(p.x[j]) + tex.colvec(col));
      }

      var solution =
        '<p>Shapes: \\((' + m + '\\times' + n + ')(' + n + '\\times 1) \\to ' + m + '\\times 1\\).</p>' +
        '<p><b>Row view</b>: entry \\(i\\) is row \\(i\\) of \\(A\\) dotted with \\(\\mathbf{x}\\).</p>' +
        tex.display('\\begin{aligned} ' + lines.join(' \\\\ ') + ' \\end{aligned}') +
        '<p><b>Column view</b>: \\(A\\mathbf{x}\\) is a combination of the columns of \\(A\\), ' +
        'weighted by the entries of \\(\\mathbf{x}\\).</p>' +
        tex.display(cols.join(' + ') + ' = ' + tex.colvec(r.y));

      return { question: question, answer: answer, solution: solution };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
