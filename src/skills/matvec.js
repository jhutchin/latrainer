import { tex } from '../tex.js';
import { matvec, col } from '../la.js';

const SHAPES_L3 = [[2, 4], [3, 4], [4, 3], [4, 2], [3, 2], [2, 3]];

export default {
  id: 'matvec',
  title: 'Matrix–vector product',
  prereqs: ['dot'],
  levels: ['2×2, non-negative', 'Up to 3×3, signed', 'Non-square, larger entries'],

  generate(level, rng) {
    let m, n, A, x;
    if (level === 1) {
      m = n = 2;
      A = [rng.vec(2, 0, 4), rng.vec(2, 0, 4)];
      x = rng.vec(2, 0, 3);
    } else {
      [m, n] = level === 2 ? [rng.int(2, 3), rng.int(2, 3)] : rng.pick(SHAPES_L3);
      const [a, b] = level === 2 ? [4, 3] : [6, 4];
      A = Array.from({ length: m }, () => rng.vec(n, -a, a));
      x = rng.vec(n, -b, b);
    }
    const y = matvec(A, x);

    const rows = A.map((r, i) => `y_${i + 1} &= ${tex.productLines(r, x)} = ${y[i].toTex()}`);
    const cols = x.map((xj, j) => `${tex.factor(xj)}${tex.colvec(col(A, j))}`);

    return {
      prompt: 'Compute \\(A\\mathbf{x}\\).' +
        tex.row(`A = ${tex.bmatrix(A)}`, `\\mathbf{x} = ${tex.colvec(x)}`),
      answer: { label: 'A\\mathbf{x} =', values: y.map((v) => [v]) },
      solution:
        `<p>Shapes: \\((${m}\\times${n})(${n}\\times 1) \\to ${m}\\times 1\\).</p>` +
        '<p><b>Row view</b>: entry \\(i\\) is row \\(i\\) of \\(A\\) dotted with \\(\\mathbf{x}\\).</p>' +
        tex.display(`\\begin{aligned} ${rows.join(' \\\\ ')} \\end{aligned}`) +
        '<p><b>Column view</b>: a combination of the columns of \\(A\\), weighted by the entries of \\(\\mathbf{x}\\).</p>' +
        tex.display(`\\begin{aligned} &${tex.wrapSum(cols, 2)} \\\\ &= ${tex.colvec(y)} \\end{aligned}`),
      data: { A, x },
    };
  },
};
