// Small exact linear-algebra helpers. Inputs may mix Numbers and Fracs;
// outputs are Fracs.
import { Frac } from './frac.js';

export const F = (x) => Frac.of(x);
export const dot = (u, v) => u.reduce((s, x, i) => s.add(F(x).mul(v[i])), F(0));
export const scale = (c, v) => v.map((x) => F(c).mul(x));
export const sub = (u, v) => u.map((x, i) => F(x).sub(v[i]));
export const col = (A, j) => A.map((r) => r[j]);
export const transpose = (A) => A[0].map((_, j) => col(A, j));
export const matvec = (A, x) => A.map((r) => dot(r, x));
export const matmul = (A, B) => A.map((r) => transpose(B).map((c) => dot(r, c)));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
