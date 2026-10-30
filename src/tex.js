import { Frac } from './frac.js';

const num = (x) => (x instanceof Frac ? x.toTex() : String(x));

export const tex = {
  num,
  // Parenthesize negatives used as factors: 2\cdot(-3).
  factor: (x) => {
    if (+x >= 0) return num(x);
    return x instanceof Frac && !x.isInt() ? `\\left(${num(x)}\\right)` : `(${num(x)})`;
  },
  bmatrix: (rows) => `\\begin{bmatrix} ${rows.map((r) => r.map(num).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`,
  colvec: (v) => tex.bmatrix(v.map((x) => [x])),
  inline: (t) => `\\(${t}\\)`,
  display: (t) => `\\[${t}\\]`,
  // Several displays side by side, wrapping onto separate lines when narrow.
  row: (...parts) => `<div class="math-row">${parts.map((t) => `<div>\\[${t}\\]</div>`).join('')}</div>`,
  // "a_1 b_1 + a_2 b_2 + ..." with negatives parenthesized.
  products: (a, b) => a.map((x, i) => `${tex.factor(x)}\\cdot ${tex.factor(b[i])}`).join(' + '),
  // Join terms with +, breaking an aligned line after every `per` terms so
  // long sums fit on a phone. Use inside \begin{aligned} after an &.
  wrapSum: (terms, per = 3) => {
    const lines = [];
    for (let i = 0; i < terms.length; i += per) lines.push(terms.slice(i, i + per).join(' + '));
    return lines.join(' \\\\ &\\quad + ');
  },
  productLines: (a, b, per = 3) => tex.wrapSum(a.map((x, i) => `${tex.factor(x)}\\cdot ${tex.factor(b[i])}`), per),
  sum: (xs) => xs.map((x, i) => (i > 0 && +x < 0 ? `- ${num(Frac.of(x).neg())}` : (i > 0 ? `+ ${num(x)}` : num(x)))).join(' '),
};
