// Skill registry. Order matters: it is the order skills are introduced in,
// and every prerequisite must come before the skills that need it.
//
// A skill is { id, title, prereqs: [ids], levels: [names],
//   generate(level, rng) -> { prompt, answer: { label, values }, solution, data } }
// - level is 1-based; generate must draw randomness only from rng.
// - answer.values is rows of Numbers/Fracs (scalar = [[v]], column = [[a], [b]]).
// - prompt / solution / label are HTML with math in \( \) and \[ \].
// - data holds the raw inputs, which tests/check_numpy.py re-solves.
import dot from './dot.js';
import matvec from './matvec.js';
import projection from './projection.js';
import lstsq from './lstsq.js';

export const SKILLS = [dot, matvec, projection, lstsq];
export const byId = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
