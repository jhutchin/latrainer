import { tex } from '../tex.js';
import { dot } from '../la.js';

const NOTATION = {
  dot: String.raw`\mathbf{u}\cdot\mathbf{v}`,
  T: String.raw`\mathbf{u}^\top\mathbf{v}`,
  angle: String.raw`\langle \mathbf{u}, \mathbf{v} \rangle`,
};

export default {
  id: 'dot',
  title: 'Dot product',
  prereqs: [],
  levels: ['2D, non-negative', '3D, signed', '4–5D, mixed notation'],

  generate(level, rng) {
    const n = [2, 3, rng.int(4, 5)][level - 1];
    const [lo, hi] = [[0, 5], [-5, 5], [-6, 6]][level - 1];
    const u = rng.vec(n, lo, hi), v = rng.vec(n, lo, hi);
    const expr = NOTATION[level === 1 ? 'dot' : rng.pick(['dot', 'T', 'angle'])];
    const val = dot(u, v);
    const prods = u.map((x, i) => x * v[i]);

    return {
      prompt: `Compute \\(${expr}\\).` +
        tex.row(`\\mathbf{u} = ${tex.colvec(u)}`, `\\mathbf{v} = ${tex.colvec(v)}`),
      answer: { label: `${expr} =`, values: [[val]] },
      solution: '<p>Multiply matching entries, then add.</p>' +
        tex.display(`\\begin{aligned} ${expr} &= ${tex.productLines(u, v)} \\\\ &= ${tex.sum(prods)} \\\\ &= ${val.toTex()} \\end{aligned}`),
      data: { u, v },
    };
  },
};
