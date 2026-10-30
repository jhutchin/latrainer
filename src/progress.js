// Learner model: per-skill level, mastery and review schedule, plus the
// rules for choosing the next problem in a lesson. Pure functions over a
// plain-JSON state object, so the app can save it and tests can drive it.

export const RULES = {
  upWindow: 5, upNeed: 4,       // level up after 4 of the last 5 correct at this level
  downWindow: 4, downNeed: 3,   // drop a level after 3 of the last 4 wrong
  unlockLevel: 2,               // a skill unlocks once every prereq reaches this level
  activeSkills: 2,              // unmastered skills worked on at once
  lessonLength: 10,
  focusLength: 8,
  reviewSlots: 3,               // max review items per lesson
  firstInterval: 1, growth: 2.5, // review spacing, in days
};
const DAY = 864e5;

export function newState() {
  return { version: 1, skills: {}, lessons: 0 };
}

export function skillState(state, id) {
  return (state.skills[id] ??= {
    level: 1, mastered: false, unlocked: false, recent: [], attempts: [], interval: 0, due: null,
  });
}

// Unlocking is sticky: dropping a level in a prereq doesn't re-lock skills
// already opened.
export const isUnlocked = (state, skill) =>
  skillState(state, skill.id).unlocked ||
  skill.prereqs.every((p) => {
    const s = skillState(state, p);
    return s.mastered || s.level >= RULES.unlockLevel;
  });

// Has this skill shown enough to be worth scheduling for review?
const reviewable = (s) => s.mastered || s.level >= 2;

export function summary(state, skills, now = Date.now()) {
  return skills.map((skill) => {
    const s = skillState(state, skill.id);
    return {
      skill,
      unlocked: isUnlocked(state, skill),
      level: s.level,
      mastered: s.mastered,
      due: reviewable(s) && s.due !== null && s.due <= now,
    };
  });
}

// Level to pose for a skill. Mastered skills are refreshed mostly at the top
// level, sometimes one below.
export function levelFor(state, skill, rng) {
  const s = skillState(state, skill.id);
  const max = skill.levels.length;
  return s.mastered ? Math.max(1, rng.pick([max, max, max - 1])) : s.level;
}

// Record one answer. Returns events for the UI: levelUp, levelDown,
// mastered, unmastered, unlocked (skill ids).
export function recordAttempt(state, skills, skill, { level, correct, ms = null, t = Date.now() }) {
  const s = skillState(state, skill.id);
  const before = new Set(skills.filter((k) => isUnlocked(state, k)).map((k) => k.id));
  const events = [];

  s.attempts.push({ t, level, correct, ms });
  if (s.attempts.length > 100) s.attempts.splice(0, s.attempts.length - 100);

  if (s.mastered) {
    // Two misses in a row on review puts the skill back into active practice.
    const last2 = s.attempts.slice(-2);
    if (!correct && last2.length === 2 && last2.every((a) => !a.correct)) {
      s.mastered = false;
      s.recent = [];
      events.push({ type: 'unmastered', skill: skill.id });
    }
  } else if (level === s.level) {
    s.recent.push(correct);
    const up = s.recent.slice(-RULES.upWindow);
    const down = s.recent.slice(-RULES.downWindow);
    if (up.filter(Boolean).length >= RULES.upNeed) {
      s.recent = [];
      if (s.level < skill.levels.length) {
        s.level += 1;
        events.push({ type: 'levelUp', skill: skill.id, level: s.level });
      } else {
        s.mastered = true;
        s.interval = 0; // finishLesson sets the first real interval
        s.due = t + RULES.firstInterval * DAY;
        events.push({ type: 'mastered', skill: skill.id });
      }
    } else if (s.level > 1 && down.filter((c) => !c).length >= RULES.downNeed) {
      s.recent = [];
      s.level -= 1;
      events.push({ type: 'levelDown', skill: skill.id, level: s.level });
    }
  }

  for (const k of skills) {
    if (!before.has(k.id) && isUnlocked(state, k)) {
      skillState(state, k.id).unlocked = true;
      events.push({ type: 'unlocked', skill: k.id });
    }
  }
  return events;
}

// Lesson context: tracks what has been asked so far.
export function newLesson(state, skills, { focus = null, now = Date.now() } = {}) {
  const pool = reviewPool(state, skills, now, new Set());
  return {
    focus,
    length: focus ? RULES.focusLength : RULES.lessonLength,
    step: 0,
    reviewTarget: focus ? 0 : Math.min(RULES.reviewSlots, pool.length),
    reviewed: [],
    results: [], // { skill, level, correct, role }
  };
}

function activeSkills(state, skills) {
  return skills
    .filter((k) => isUnlocked(state, k) && !skillState(state, k.id).mastered)
    .slice(0, RULES.activeSkills);
}

function reviewPool(state, skills, now, exclude) {
  const active = new Set(activeSkills(state, skills).map((k) => k.id));
  return skills
    .filter((k) => {
      const s = skillState(state, k.id);
      return isUnlocked(state, k) && !active.has(k.id) && !exclude.has(k.id) &&
        reviewable(s) && s.due !== null && s.due <= now;
    })
    .sort((a, b) => skillState(state, a.id).due - skillState(state, b.id).due);
}

// Choose the next problem. Re-evaluated every step, so a skill unlocked or
// levelled up mid-lesson takes effect immediately.
export function pickNext(state, skills, lesson, rng, now = Date.now()) {
  const last = lesson.results.at(-1)?.skill;
  const avoidLast = (list) => (list.length > 1 ? list.filter((k) => k.id !== last) : list);

  let skill, role;
  if (lesson.focus) {
    skill = skills.find((k) => k.id === lesson.focus);
    role = 'focus';
  } else {
    const active = activeSkills(state, skills);
    const pool = reviewPool(state, skills, now, new Set(lesson.reviewed));
    const need = Math.min(pool.length, lesson.reviewTarget - lesson.reviewed.length);
    const remaining = lesson.length - lesson.step;
    if (need > 0 && (active.length === 0 || rng.float() < need / remaining)) {
      skill = avoidLast(pool)[0];
      role = 'review';
    } else if (active.length > 0) {
      skill = rng.pick(avoidLast(active));
      role = 'learn';
    } else {
      // Everything unlocked is mastered: free practice across all of it.
      skill = rng.pick(avoidLast(skills.filter((k) => isUnlocked(state, k))));
      role = 'review';
    }
  }
  return { skill, role, level: levelFor(state, skill, rng) };
}

// Called after each answer.
export function advance(lesson, item, correct) {
  lesson.results.push({ skill: item.skill.id, level: item.level, correct, role: item.role });
  if (item.role === 'review' && !lesson.reviewed.includes(item.skill.id)) lesson.reviewed.push(item.skill.id);
  lesson.step += 1;
  return lesson.step >= lesson.length;
}

// Reschedule reviews for every skill practised in the lesson: all correct
// stretches the interval, any miss resets it to a day.
export function finishLesson(state, lesson, now = Date.now()) {
  const bySkill = {};
  for (const r of lesson.results) (bySkill[r.skill] ??= []).push(r.correct);
  for (const [id, results] of Object.entries(bySkill)) {
    const s = skillState(state, id);
    if (!reviewable(s)) continue;
    s.interval = results.every(Boolean)
      ? Math.max(RULES.firstInterval, s.interval * RULES.growth)
      : RULES.firstInterval;
    s.due = now + s.interval * DAY;
  }
  if (lesson.results.length) state.lessons += 1;
}

export function migrate(raw) {
  if (!raw || raw.version !== 1 || typeof raw.skills !== 'object') throw new Error('Unrecognized progress file');
  return raw;
}
