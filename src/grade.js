// Parsing and checking typed answers. Accepts integers, decimals and
// fractions: "3", "-2", "0.75", ".5", "3/4", "-3/4".

const NUM = String.raw`\d+\.?\d*|\.\d+`;
const RE = new RegExp(`^-?(${NUM})(/-?(${NUM}))?$`);

const decimalsOf = (s) => (s.includes('.') ? s.split('.')[1].length : 0);

export function parseEntry(raw) {
  const s = String(raw).trim().replace(/−/g, '-');
  if (!RE.test(s)) return null;
  const [a, b] = s.split('/');
  const n = Number(a), d = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  // A typed decimal like 0.67 is read as "rounded to 2 places".
  return { value: n / d, decimals: b === undefined ? decimalsOf(a) : 0 };
}

export function matches(entry, truth) {
  const t = +truth;
  const err = Math.abs(entry.value - t);
  if (err <= 1e-9 * Math.max(1, Math.abs(t))) return true;
  return entry.decimals >= 2 && err <= 0.5 * 10 ** -entry.decimals + 1e-12;
}

// entries: string[] in row-major order; truth: rows of numbers/Fracs.
// Returns null if any entry is unparseable, else per-cell booleans.
export function grade(entries, truth) {
  const flat = truth.flat();
  const parsed = entries.map(parseEntry);
  if (parsed.length !== flat.length || parsed.some((p) => p === null)) return null;
  const cells = parsed.map((p, i) => matches(p, flat[i]));
  return { cells, correct: cells.every(Boolean) };
}
