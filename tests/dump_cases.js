// Prints generated problems as JSON for tests/check_numpy.py.
import { SKILLS } from '../src/skills/index.js';
import { Rng } from '../src/rng.js';

const n = Number(process.argv[2] ?? 200);
const cases = [];
for (const skill of SKILLS) {
  skill.levels.forEach((_, li) => {
    for (let seed = 0; seed < n; seed++) {
      const p = skill.generate(li + 1, new Rng(seed));
      cases.push({ skill: skill.id, level: li + 1, seed, data: p.data, answer: p.answer.values.map((r) => r.map(Number)) });
    }
  });
}
process.stdout.write(JSON.stringify(cases));
