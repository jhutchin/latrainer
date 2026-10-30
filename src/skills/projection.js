import { tex } from '../tex.js';
import { F, dot, scale, sub } from '../la.js';

const PROJ = String.raw`\operatorname{proj}_{\mathbf{u}}\mathbf{v}`;

export default {
  id: 'projection',
  title: 'Projection onto a vector',
  prereqs: ['dot'],
  levels: ['2D, whole-number answer', '2D, fractions', '3D, projection or residual'],

  generate(level, rng) {
    let u, v;
    if (level === 1) {
      // v = c·u + k·u⊥, so the projection is the integer vector c·u.
      u = rng.vec(2, -3, 3);
      const c = rng.intNonZero(-3, 3), k = rng.intNonZero(-2, 2);
      v = [c * u[0] - k * u[1], c * u[1] + k * u[0]];
    } else {
      const n = level === 2 ? 2 : 3;
      // Reject v parallel or orthogonal to u: both make the answer trivial.
      do {
        u = rng.vec(n, -3, 3);
        v = rng.vec(n, n === 2 ? -5 : -4, n === 2 ? 5 : 4);
      } while (+dot(u, v) === 0 || dot(u, v).mul(dot(u, v)).valueOf() === dot(u, u).mul(dot(v, v)).valueOf());
    }
    const ask = level === 3 ? rng.pick(['proj', 'resid']) : 'proj';

    const uv = dot(u, v), uu = dot(u, u);
    const c = uv.div(uu);
    const p = scale(c, u);
    const r = sub(v, p);
    const target = ask === 'proj' ? p : r;

    const expand = (a, b) => (u.length === 2 ? `${tex.products(a, b)} = ` : '');
    const steps = [
      `\\mathbf{u}\\cdot\\mathbf{v} &= ${expand(u, v)}${uv.toTex()}`,
      `\\mathbf{u}\\cdot\\mathbf{u} &= ${expand(u, u)}${uu.toTex()}`,
      `${PROJ} &= \\frac{\\mathbf{u}\\cdot\\mathbf{v}}{\\mathbf{u}\\cdot\\mathbf{u}}\\,\\mathbf{u} = ${c.toTex()}${tex.colvec(u)}`,
      `&= ${tex.colvec(p)}`,
    ];
    if (ask === 'resid') {
      steps.push(`\\mathbf{v} - ${PROJ} &= ${tex.colvec(v)} - ${tex.colvec(p)}`, `&= ${tex.colvec(r)}`);
    }

    const label = ask === 'proj' ? `${PROJ} =` : `\\mathbf{v} - ${PROJ} =`;
    return {
      prompt: (ask === 'proj'
        ? `Project \\(\\mathbf{v}\\) onto \\(\\mathbf{u}\\): find \\(${PROJ}\\).`
        : `Find the part of \\(\\mathbf{v}\\) orthogonal to \\(\\mathbf{u}\\): \\(\\mathbf{v} - ${PROJ}\\).`) +
        tex.row(`\\mathbf{u} = ${tex.colvec(u)}`, `\\mathbf{v} = ${tex.colvec(v)}`),
      answer: { label, values: target.map((x) => [x]) },
      solution:
        tex.display(`\\begin{aligned} ${steps.join(' \\\\ ')} \\end{aligned}`) +
        `<p>Check: the residual \\(\\mathbf{v} - ${PROJ}\\) is orthogonal to \\(\\mathbf{u}\\); ` +
        `its dot product with \\(\\mathbf{u}\\) is \\(${dot(r, u).toTex()}\\).</p>`,
      data: { u, v, ask },
    };
  },
};
