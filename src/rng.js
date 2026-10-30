// Seeded RNG. mulberry32 uses only 32-bit integer ops, so a seed gives the
// same problem in every JS engine (browser and Node tests alike).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float() { return this.next(); }
  // Uniform integer in [lo, hi], inclusive.
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  intNonZero(lo, hi) {
    let v;
    do { v = this.int(lo, hi); } while (v === 0);
    return v;
  }
  pick(arr) { return arr[this.int(0, arr.length - 1)]; }
  // Integer vector with entries in [lo, hi], never all zero.
  vec(n, lo, hi) {
    let v;
    do { v = Array.from({ length: n }, () => this.int(lo, hi)); } while (v.every((x) => x === 0));
    return v;
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function freshSeed() {
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0];
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}
