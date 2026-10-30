import { tex } from '../tex.js';
import { F, dot, cross, transpose, matmul, matvec } from '../la.js';

const BETA = String.raw`\hat{\boldsymbol\beta}`;

// Second-difference vectors (…, 1, −2, 1, …) are orthogonal to both the
// constant vector and any equally spaced x, so adding them to y changes the
// data without changing the least-squares fit. That keeps answers integral.
function secondDiffNoise(rng, n) {
  let e;
  do {
    e = Array(n).fill(0);
    for (let i = 0; i + 2 < n; i++) {
      const k = rng.int(-2, 2);
      e[i] += k; e[i + 1] -= 2 * k; e[i + 2] += k;
    }
  } while (e.every((x) => x === 0));
  return e;
}

function noIntercept(rng) {
  // y = βx + e with e = x × r, which is orthogonal to x.
  let x, e;
  do {
    x = rng.vec(3, -3, 3);
    e = cross(x, rng.vec(3, -2, 2));
  } while (x.filter((t) => t !== 0).length < 2 || e.every((t) => t === 0));
  const beta = rng.intNonZero(-3, 3);
  const y = x.map((t, i) => beta * t + e[i]);
  const xy = dot(x, y), xx = dot(x, x);
  return {
    prompt: 'Fit \\(\\mathbf{y} \\approx \\beta\\,\\mathbf{x}\\) by least squares (no intercept). Find \\(\\hat\\beta\\).' +
      tex.row(`\\mathbf{x} = ${tex.colvec(x)}`, `\\mathbf{y} = ${tex.colvec(y)}`),
    answer: { label: '\\hat\\beta =', values: [[xy.div(xx)]] },
    solution:
      tex.display(`\\hat\\beta = \\frac{\\mathbf{x}^\\top\\mathbf{y}}{\\mathbf{x}^\\top\\mathbf{x}} = \\frac{${xy.toTex()}}{${xx.toTex()}} = ${xy.div(xx).toTex()}`) +
      '<p>This is the projection coefficient: \\(\\hat\\beta\\,\\mathbf{x}\\) is the projection of \\(\\mathbf{y}\\) onto \\(\\mathbf{x}\\).</p>',
    data: { X: x.map((t) => [t]), y },
  };
}

function withIntercept(rng, level) {
  let x;
  if (level === 2) {
    x = rng.pick([[-1, 0, 1], [-2, 0, 2], [-2, -1, 0, 1, 2], [-3, -1, 1, 3]]);
  } else {
    const start = rng.int(1, 3), step = rng.int(1, 2), n = rng.int(3, 4);
    x = Array.from({ length: n }, (_, i) => start + step * i);
  }
  const n = x.length;
  const b0 = rng.int(-4, 4), b1 = rng.intNonZero(-3, 3);
  const e = secondDiffNoise(rng, n);
  const y = x.map((t, i) => b0 + b1 * t + e[i]);

  const X = x.map((t) => [1, t]);
  const XtX = matmul(transpose(X), X);
  const Xty = matvec(transpose(X), y);
  const [[a, b], [, d]] = XtX;
  const det = a.mul(d).sub(b.mul(b));
  const inv = [[d.div(det), b.neg().div(det)], [b.neg().div(det), a.div(det)]];
  const beta = matvec(inv, Xty);

  const solve = level === 2
    ? `<p>\\(X^\\top X\\) is diagonal because \\(\\sum x_i = 0\\), so each coefficient separates:</p>` +
      tex.row(`\\hat\\beta_0 = \\frac{${Xty[0].toTex()}}{${a.toTex()}} = ${beta[0].toTex()}`,
        `\\hat\\beta_1 = \\frac{${Xty[1].toTex()}}{${d.toTex()}} = ${beta[1].toTex()}`)
    : '<p>Invert the 2×2 matrix: swap the diagonal, negate the off-diagonal, divide by the determinant.</p>' +
      tex.display(`\\begin{aligned} \\det(X^\\top X) &= ${a.toTex()}\\cdot ${d.toTex()} - ${tex.factor(b)}^2 \\\\ &= ${det.toTex()} \\end{aligned}`) +
      tex.display(`\\begin{aligned} ${BETA} &= \\frac{1}{${det.toTex()}}${tex.bmatrix([[d, b.neg()], [b.neg(), a]])}${tex.colvec(Xty)} \\\\ &= ${tex.colvec(beta)} \\end{aligned}`);

  return {
    prompt: 'Fit \\(y = \\beta_0 + \\beta_1 x\\) by least squares. Find \\(' + BETA + ' = (\\hat\\beta_0, \\hat\\beta_1)\\).' +
      tex.row(`X = ${tex.bmatrix(X)}`, `\\mathbf{y} = ${tex.colvec(y)}`),
    answer: { label: `${BETA} =`, values: beta.map((v) => [v]) },
    solution:
      tex.display(`${BETA} = (X^\\top X)^{-1} X^\\top \\mathbf{y}`) +
      tex.row(`X^\\top X = ${tex.bmatrix(XtX)}`, `X^\\top\\mathbf{y} = ${tex.colvec(Xty)}`) +
      solve,
    data: { X, y },
  };
}

export default {
  id: 'lstsq',
  title: 'Least squares',
  prereqs: ['matvec', 'projection'],
  levels: ['One regressor, no intercept', 'Intercept + centered x', 'Intercept + uncentered x'],

  generate(level, rng) {
    return level === 1 ? noIntercept(rng) : withIntercept(rng, level);
  },
};
