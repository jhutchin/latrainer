// UI: home (skill map), lesson (problem → feedback), summary.
import { SKILLS, byId } from './skills/index.js';
import * as P from './progress.js';
import { Rng, freshSeed } from './rng.js';
import { grade } from './grade.js';

const STORE_KEY = 'latrainer.progress.v1';
const app = document.getElementById('app');
const rng = new Rng(freshSeed());
const DEBUG = new URLSearchParams(location.search).has('debug'); // exposes answers for browser tests // lesson planning; each problem gets its own seed

let state = load();
let view = null; // current view's key handler lives here

/* ---------------------------------------------------------------- storage */

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return P.migrate(JSON.parse(raw));
  } catch { /* fall through to a fresh state */ }
  return P.newState();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

/* ---------------------------------------------------------------- helpers */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function typeset(el) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(el, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false },
    ],
    throwOnError: false,
  });
}

function render(html, handlers = {}) {
  app.innerHTML = html;
  typeset(app);
  view = handlers;
  window.scrollTo(0, 0);
}

document.addEventListener('keydown', (e) => view?.onKey?.(e));

function pips(skill, s) {
  const done = s.mastered ? skill.levels.length : s.level - 1;
  return skill.levels.map((name, i) =>
    `<span class="pip ${i < done ? 'done' : ''} ${!s.mastered && i === s.level - 1 ? 'current' : ''}" title="${esc(name)}"></span>`,
  ).join('');
}

function eventText(ev) {
  const t = byId[ev.skill].title;
  switch (ev.type) {
    case 'levelUp': return `${t}: level ${ev.level}`;
    case 'levelDown': return `${t}: back to level ${ev.level}`;
    case 'mastered': return `${t}: mastered`;
    case 'unmastered': return `${t}: back in practice`;
    case 'unlocked': return `Unlocked: ${t}`;
    default: return '';
  }
}

/* ------------------------------------------------------------------- home */

function home() {
  const rows = P.summary(state, SKILLS);
  const due = rows.filter((r) => r.due).length;

  const cards = rows.map(({ skill, unlocked, level, mastered, due }) => {
    const s = P.skillState(state, skill.id);
    const status = !unlocked
      ? `Needs ${skill.prereqs.map((p) => byId[p].title).join(' and ')} at level ${P.RULES.unlockLevel}`
      : mastered ? 'Mastered' : `Level ${level}: ${skill.levels[level - 1]}`;
    return `
      <li class="skill ${unlocked ? '' : 'locked'}">
        <div class="skill-main">
          <div class="skill-title">${esc(skill.title)} ${due ? '<span class="tag">review due</span>' : ''}</div>
          <div class="skill-status">${esc(status)}</div>
          <div class="pips">${pips(skill, s)}</div>
        </div>
        ${unlocked ? `<button class="ghost" data-focus="${skill.id}">Practice</button>` : ''}
      </li>`;
  }).join('');

  render(`
    <header class="home-head">
      <h1>LA Trainer</h1>
      <p class="muted">${state.lessons ? `${state.lessons} lesson${state.lessons === 1 ? '' : 's'} done` : 'Linear algebra, one skill at a time'}</p>
    </header>
    <button class="primary big" id="start">Start lesson</button>
    <p class="muted center small">${due ? `${due} skill${due === 1 ? '' : 's'} due for review` : '&nbsp;'}</p>
    <ul class="skills">${cards}</ul>
    <footer class="home-foot">
      <button class="link" id="export">Export progress</button>
      <label class="link">Import<input type="file" id="import" accept="application/json,.json" hidden></label>
      <button class="link danger" id="reset">Reset</button>
    </footer>
  `, {
    onKey: (e) => { if (e.key === 'Enter') startLesson(); },
  });

  app.querySelector('#start').onclick = () => startLesson();
  app.querySelectorAll('[data-focus]').forEach((b) => { b.onclick = () => startLesson(b.dataset.focus); });
  app.querySelector('#export').onclick = exportProgress;
  app.querySelector('#import').onchange = importProgress;
  app.querySelector('#reset').onclick = () => {
    if (confirm('Erase all progress?')) { state = P.newState(); save(); home(); }
  };
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `latrainer-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importProgress(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const next = P.migrate(JSON.parse(await file.text()));
    if (!confirm('Replace current progress with this file?')) return;
    state = next;
    save();
    home();
  } catch (err) {
    alert(`Could not import: ${err.message}`);
  }
}

/* ----------------------------------------------------------------- lesson */

function startLesson(focus = null) {
  const lesson = P.newLesson(state, SKILLS, { focus });
  lesson.events = [];
  nextProblem(lesson);
}

function endLesson(lesson) {
  P.finishLesson(state, lesson);
  save();
  summaryView(lesson);
}

function nextProblem(lesson) {
  const item = P.pickNext(state, SKILLS, lesson, rng);
  const seed = freshSeed();
  const problem = item.skill.generate(item.level, new Rng(seed));
  const values = problem.answer.values;
  if (DEBUG) window.__answer = values.flat().map(String);
  const nCells = values.flat().length;
  const entries = Array(nCells).fill('');
  let active = 0;
  let checked = false;
  const started = performance.now();

  const cellsHtml = values.map((row, i) =>
    `<div class="grid-row">${row.map((_, j) => {
      const k = i * row.length + j;
      return `<button class="cell" data-k="${k}" aria-label="entry ${k + 1}"></button>`;
    }).join('')}</div>`,
  ).join('');
  const bracket = nCells > 1 ? 'bracketed' : '';

  const keys = ['7', '8', '9', '⌫', '4', '5', '6', '−', '1', '2', '3', '/', '.', '0', '◀', '▶'];

  render(`
    <div class="topbar">
      <button class="icon" id="quit" aria-label="End lesson">✕</button>
      <div class="bar"><div style="width:${(lesson.step / lesson.length) * 100}%"></div></div>
    </div>
    <div class="meta">
      <span>${esc(item.skill.title)}</span>
      <span class="muted">· Level ${item.level}</span>
      ${item.role === 'review' ? '<span class="tag">review</span>' : ''}
    </div>
    <section class="prompt">${problem.prompt}</section>
    <section class="answer">
      <span class="answer-label">\\(${problem.answer.label}\\)</span>
      <div class="grid ${bracket}">${cellsHtml}</div>
    </section>
    <p class="hint muted small" id="hint">Fractions like 3/4 or decimals like 0.75 are fine.</p>
    <section class="feedback" id="feedback" hidden></section>
    <div class="keypad" id="keypad">
      ${keys.map((k) => `<button class="key ${/[0-9]/.test(k) ? '' : 'op'}" data-key="${k}">${k}</button>`).join('')}
    </div>
    <div class="actions">
      <button class="link" id="giveup">Show answer</button>
      <button class="primary" id="check">Check</button>
    </div>
  `, { onKey });

  const cellEls = [...app.querySelectorAll('.cell')];
  const checkBtn = app.querySelector('#check');
  const feedback = app.querySelector('#feedback');

  function paint() {
    cellEls.forEach((el, k) => {
      el.textContent = entries[k].replace(/-/g, '−');
      el.classList.toggle('active', !checked && k === active);
    });
  }

  function press(key) {
    if (checked) return;
    const cur = entries[active];
    switch (key) {
      case '⌫': entries[active] = cur.slice(0, -1); break;
      case '−': entries[active] = cur.startsWith('-') ? cur.slice(1) : `-${cur}`; break;
      case '/': if (cur && !cur.includes('/') && cur !== '-') entries[active] = `${cur}/`; break;
      case '.': if (!(cur.split('/').at(-1)).includes('.')) entries[active] = `${cur}.`; break;
      case '◀': active = (active - 1 + nCells) % nCells; break;
      case '▶': active = (active + 1) % nCells; break;
      default: if (cur.length < 12) entries[active] = cur + key;
    }
    paint();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map = { Backspace: '⌫', '-': '−', ArrowLeft: '◀', ArrowRight: '▶', ArrowUp: '◀', ArrowDown: '▶' };
    if (e.key === 'Enter') { e.preventDefault(); checkBtn.click(); return; }
    if (e.key === 'Tab') { e.preventDefault(); press(e.shiftKey ? '◀' : '▶'); return; }
    const k = map[e.key] ?? e.key;
    if (/^[0-9./]$/.test(k) || ['⌫', '−', '◀', '▶'].includes(k)) { e.preventDefault(); press(k); }
  }

  function finish(result) {
    checked = true;
    const correct = !!result?.correct;
    const ms = Math.round(performance.now() - started);
    const events = P.recordAttempt(state, SKILLS, item.skill, { level: item.level, correct, ms });
    lesson.events.push(...events);
    const done = P.advance(lesson, item, correct);
    save();

    if (result) {
      cellEls.forEach((el, k) => el.classList.add(result.cells[k] ? 'right' : 'wrong'));
    }
    const answerTex = values.length === 1 && values[0].length === 1
      ? values[0][0].toTex?.() ?? String(values[0][0])
      : `\\begin{bmatrix} ${values.map((r) => r.map((v) => v.toTex?.() ?? v).join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;

    feedback.hidden = false;
    feedback.className = `feedback ${correct ? 'good' : 'bad'}`;
    feedback.innerHTML = `
      <div class="verdict">${correct ? 'Correct' : result ? 'Not quite' : 'Answer'}</div>
      ${correct ? '' : `<div class="correct-answer">\\(${problem.answer.label} ${answerTex}\\)</div>`}
      ${events.map((ev) => `<div class="event">${esc(eventText(ev))}</div>`).join('')}
      <details ${correct ? '' : 'open'}><summary>Worked solution</summary>${problem.solution}</details>`;
    typeset(feedback);

    app.querySelector('#keypad').hidden = true;
    app.querySelector('#hint').hidden = true;
    app.querySelector('#giveup').hidden = true;
    checkBtn.textContent = done ? 'Finish' : 'Continue';
    checkBtn.onclick = () => (done ? endLesson(lesson) : nextProblem(lesson));
    paint();
    feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  cellEls.forEach((el, k) => { el.onclick = () => { if (!checked) { active = k; paint(); } }; });
  app.querySelectorAll('[data-key]').forEach((b) => { b.onclick = () => press(b.dataset.key); });
  app.querySelector('#giveup').onclick = () => finish(null);
  app.querySelector('#quit').onclick = () => {
    if (lesson.step === 0 || confirm('End this lesson? Answers so far are kept.')) endLesson(lesson);
  };
  checkBtn.onclick = () => {
    const result = grade(entries, values);
    if (!result) {
      const hint = app.querySelector('#hint');
      hint.textContent = 'Fill in every entry: a number like 3, −2, 3/4 or 0.75.';
      hint.classList.add('warn');
      const firstBad = entries.findIndex((e) => grade([e], [[0]]) === null);
      if (firstBad >= 0) active = firstBad;
      paint();
      return;
    }
    finish(result);
  };
  paint();
}

/* ---------------------------------------------------------------- summary */

function summaryView(lesson) {
  const n = lesson.results.length;
  if (n === 0) { home(); return; }
  const right = lesson.results.filter((r) => r.correct).length;
  // One line per skill change: keep the last level/mastery event per skill.
  const last = {};
  for (const e of lesson.events) {
    if (e.type === 'unlocked') last[`u:${e.skill}`] = e;
    else last[`l:${e.skill}`] = e;
  }
  const events = Object.values(last).filter((e) => e.type !== 'levelDown');
  render(`
    <section class="summary">
      <h2>Lesson complete</h2>
      <p class="score">${right} / ${n}</p>
      ${events.length ? `<ul class="events">${events.map((e) => `<li>${esc(eventText(e))}</li>`).join('')}</ul>` : ''}
      <button class="primary big" id="home">Done</button>
    </section>
  `, { onKey: (e) => { if (e.key === 'Enter') home(); } });
  app.querySelector('#home').onclick = home;
}

home();
