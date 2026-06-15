// app.js — entry point: loadData() over data/*.json, tab routing with lastTab
// persistence, formatMatchTime(), hero (live or next match + countdown),
// dashboard cards.

import { getPrefs, setPref, toggleFavorite } from './storage.js';
import { initI18n, setLang, getLang, getLocale, t, translatePhase } from './i18n.js';
import { initSchedule } from './schedule.js';
import { initGroups } from './groups.js';
import { initStadiums } from './stadiums.js';
import { initModal } from './modal.js';
import { initBracket } from './bracket.js';
import { initStats } from './stats.js';

// ---------------------------------------------------------------- data

let data = null;

const DATA_VERSION = '2026-06-15-rev1';

export async function loadData() {
  if (data) return data;
  const files = ['teams', 'groups', 'matches', 'results', 'stadiums', 'bracket-config'];
  const [teams, groups, matches, results, stadiums, bracketConfig] = await Promise.all(
    files.map(async (name) => {
      const res = await fetch(`data/${name}.json?v=${DATA_VERSION}`);
      if (!res.ok) throw new Error(`data/${name}.json — HTTP ${res.status}`);
      return res.json();
    }),
  );
  data = {
    teams, groups, matches, results, stadiums, bracketConfig,
    teamById: new Map(teams.map((team) => [team.id, team])),
    stadiumByName: new Map(stadiums.map((s) => [s.name, s])),
    resultByMatchId: new Map(results.map((r) => [r.matchId, r])),
  };
  return data;
}

export function getData() {
  return data;
}

// ---------------------------------------------------------------- time

export function matchDateUTC(match) {
  return new Date(`${match.date}T${match.time}:00Z`);
}

export function formatMatchTime(match, stadium, mode = getPrefs().timeMode ?? 'local') {
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  if (mode === 'stadium' && stadium?.timezone) options.timeZone = stadium.timezone;
  return new Intl.DateTimeFormat(getLocale(), options).format(matchDateUTC(match));
}

export function flagSrc(team) {
  return `assets/images/${team.flag}`;
}

// ---------------------------------------------------------------- tabs

const TABS = ['home', 'matches', 'groups', 'bracket', 'stadiums', 'stats'];

function activateTab(id, { updateHash = true } = {}) {
  const tab = TABS.includes(id) ? id : 'home';
  for (const btn of document.querySelectorAll('.tab-btn')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.setAttribute('tabindex', active ? '0' : '-1');
  }
  for (const panelId of TABS) {
    document.getElementById(`panel-${panelId}`).hidden = panelId !== tab;
  }
  setPref('lastTab', tab);
  if (updateHash) history.replaceState(null, '', `#${tab}`);
}

// programmatic navigation for cross-view links (e.g. stadium → its matches)
export function navigateTo(tab) {
  activateTab(tab);
  window.scrollTo({ top: 0 });
}

function initTabs() {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }
  // roving tabindex + arrow keys per the WAI-ARIA tabs pattern
  document.querySelector('.tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll('.tab-btn')];
    const current = buttons.findIndex((b) => b.classList.contains('active'));
    const next =
      event.key === 'ArrowLeft' ? (current - 1 + buttons.length) % buttons.length
      : event.key === 'ArrowRight' ? (current + 1) % buttons.length
      : event.key === 'Home' ? 0
      : buttons.length - 1;
    activateTab(buttons[next].dataset.tab);
    buttons[next].focus();
  });
  window.addEventListener('hashchange', () =>
    activateTab(location.hash.slice(1), { updateHash: false }));
  activateTab(location.hash.slice(1) || getPrefs().lastTab || 'home');
}

// ---------------------------------------------------------------- hero

// How long a match stays "in progress" after kickoff while results.json hasn't
// caught up yet. Group games run ~90'+stoppage (~2h); knockout games can reach
// extra time + penalties (~3h). JSON (finished/live) still overrides the clock.
const GROUP_WINDOW_MS = 2 * 60 * 60 * 1000;
const KO_WINDOW_MS = 3 * 60 * 60 * 1000;

function matchWindowMs(match) {
  return match.phase.startsWith('Group') ? GROUP_WINDOW_MS : KO_WINDOW_MS;
}

// Hybrid state of a match at instant `now`: the JSON wins when it says finished
// or live; otherwise the clock advances the state so the hero flips at kickoff
// and again at kickoff+window with no JSON edit. Pure function, easy to reason about.
// Exported so schedule.js shares the exact same hybrid rule (occurrence filter + chip).
export function matchState(match, result, now) {
  const status = result?.status ?? 'scheduled';
  const kickoff = matchDateUTC(match).getTime();
  if (status === 'finished' || now >= kickoff + matchWindowMs(match)) return 'over';
  if (status === 'live' || now >= kickoff) return 'live';
  return 'upcoming';
}

// Featured match = the earliest match that isn't over yet (in progress or
// upcoming); ties broken by id, matching schedule.js ordering.
function findFeaturedMatch(now) {
  const { matches, resultByMatchId } = data;
  return matches
    .filter((m) => matchState(m, resultByMatchId.get(m.id), now) !== 'over')
    .sort((a, b) => matchDateUTC(a) - matchDateUTC(b) || a.id - b.id)[0] ?? null;
}

// Compact signature of "what the hero should show now"; a change drives a rebuild.
function heroSignature(match, now) {
  if (!match) return '∅';
  return `${match.id}:${matchState(match, data.resultByMatchId.get(match.id), now)}`;
}

function heroTeamHTML(teamId) {
  const team = data.teamById.get(teamId);
  if (!team) return `<div class="hero-team"><span class="hero-team-name">${t('app.tbd')}</span></div>`;
  return `
    <div class="hero-team">
      <img class="flag flag-lg" src="${flagSrc(team)}" alt="" width="64" height="43">
      <span class="hero-team-name">${team.name}</span>
    </div>`;
}

let heroTimer = null;
let heroSig = null;
let countdownTarget = null;
let countdownEls = null;

function renderHero() {
  const root = document.getElementById('hero-content');
  const now = Date.now();
  const match = findFeaturedMatch(now);
  heroSig = heroSignature(match, now);
  countdownTarget = null;
  countdownEls = null;

  if (!match) {
    root.innerHTML = '';
    startHeroClock();
    return;
  }
  const result = data.resultByMatchId.get(match.id);
  const stadium = data.stadiumByName.get(match.stadium);
  const live = matchState(match, result, now) === 'live';
  const hasScore = result?.homeScore != null && result?.awayScore != null;

  // Live shows the JSON score only when it exists; a clock-driven in-progress
  // match (JSON not updated yet) falls back to "vs", like an upcoming match.
  const center = live && hasScore
    ? `<div class="hero-score">${result.homeScore}<span class="hero-score-sep">–</span>${result.awayScore}</div>`
    : `<div class="hero-vs">${t('hero.vs')}</div>`;

  root.innerHTML = `
    <p class="hero-label">
      ${live ? `<span class="live-badge pulse">● ${t('hero.inProgress')}</span>` : t('hero.nextMatch')}
      <span class="hero-phase">${translatePhase(match.phase)}</span>
    </p>
    <div class="hero-matchup">
      ${heroTeamHTML(match.homeTeam)}
      ${center}
      ${heroTeamHTML(match.awayTeam)}
    </div>
    <p class="hero-meta">${formatMatchTime(match, stadium)} · ${match.stadium}, ${match.city}</p>
    ${live ? '' : `<div class="countdown" id="countdown" role="timer" aria-label="${t('hero.countdownLabel')}"></div>`}
  `;
  if (!live) setupCountdown(matchDateUTC(match).getTime());
  startHeroClock();
}

function setupCountdown(target) {
  const root = document.getElementById('countdown');
  const units = ['days', 'hours', 'minutes', 'seconds'];
  root.innerHTML = units.map((unit) => `
    <div class="count-box">
      <span class="count-value" data-unit="${unit}">0</span>
      <span class="count-label">${t(`countdown.${unit}`)}</span>
    </div>`).join('');
  countdownTarget = target;
  countdownEls = Object.fromEntries(
    units.map((unit) => [unit, root.querySelector(`[data-unit="${unit}"]`)]),
  );
  updateCountdown();
}

function updateCountdown() {
  if (!countdownEls) return;
  const seconds = Math.floor(Math.max(0, countdownTarget - Date.now()) / 1000);
  countdownEls.days.textContent = Math.floor(seconds / 86400);
  countdownEls.hours.textContent = String(Math.floor((seconds % 86400) / 3600)).padStart(2, '0');
  countdownEls.minutes.textContent = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  countdownEls.seconds.textContent = String(seconds % 60).padStart(2, '0');
}

// Single persistent 1s driver. Most ticks only refresh the countdown digits;
// when the featured match or its state changes (kickoff, end-of-window, next
// match), the signature flips and we rebuild the hero — no reload, no JSON edit.
function startHeroClock() {
  if (heroTimer) return;
  heroTimer = setInterval(heroTick, 1000);
}

function heroTick() {
  const now = Date.now();
  const sig = heroSignature(findFeaturedMatch(now), now);
  if (sig !== heroSig) renderHero();
  else updateCountdown();
}

// ------------------------------------------------------------ dashboard

const ICONS = {
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5 16 10.4l-1.5 4.7h-5L8 10.4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6z"/></svg>',
};

function renderDashboard() {
  const { matches, teams, results } = data;
  const finished = results.filter((r) => r.status === 'finished').length;
  const scheduled = results.filter((r) => r.status === 'scheduled').length;
  const cards = [
    { icon: ICONS.ball, value: matches.length, label: 'dash.total' },
    { icon: ICONS.check, value: finished, label: 'dash.completed' },
    { icon: ICONS.clock, value: scheduled, label: 'dash.upcoming' },
    { icon: ICONS.shield, value: teams.length, label: 'dash.teams' },
  ];
  document.getElementById('dashboard').innerHTML = cards.map((card) => `
    <div class="stat-card glass fade-in">
      <span class="stat-icon">${card.icon}</span>
      <span class="stat-value">${card.value}</span>
      <span class="stat-label">${t(card.label)}</span>
    </div>`).join('');
}

// ---------------------------------------------------------------- init

// shared tooltip for abbreviated table headers (Stats + Groups). A single
// fixed-position bubble driven by event delegation, so it survives table
// re-renders and is never clipped by a table's overflow/stacking context.
// Hover + keyboard focus both trigger it; screen readers use the header's
// aria-label, and small screens fall back to the visible legend.
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'app-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  let current = null;

  const show = (el) => {
    current = el;
    tip.textContent = el.dataset.tip;
    tip.style.left = '-9999px';
    tip.style.top = '-9999px';
    tip.hidden = false;
    const rect = el.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    let left = Math.round(rect.left + rect.width / 2 - box.width / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    let top = Math.round(rect.top - box.height - 8);
    if (top < 8) top = Math.round(rect.bottom + 8); // flip below if no room above
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = (el) => {
    if (!el || el === current) { tip.hidden = true; current = null; }
  };

  for (const event of ['mouseover', 'focusin']) {
    document.addEventListener(event, (e) => {
      const el = e.target.closest?.('.has-tip[data-tip]');
      if (el) show(el);
    });
  }
  for (const event of ['mouseout', 'focusout']) {
    document.addEventListener(event, (e) => {
      const el = e.target.closest?.('.has-tip[data-tip]');
      if (el) hide(el);
    });
  }
  document.addEventListener('scroll', () => hide(current), true);
}

// global star delegation — stars exist in schedule, groups, and modal
function initFavorites() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.fav-btn');
    if (!btn) return;
    event.stopPropagation();
    toggleFavorite(btn.dataset.fav);
    document.dispatchEvent(new CustomEvent('favchange'));
  }, true);
}

function syncTimeToggle() {
  const btn = document.getElementById('time-toggle');
  const mode = getPrefs().timeMode ?? 'local';
  btn.textContent = `🕐 ${t(mode === 'local' ? 'time.local' : 'time.stadium')}`;
  btn.setAttribute('aria-pressed', String(mode === 'stadium'));
}

function initTimeToggle() {
  const btn = document.getElementById('time-toggle');
  btn.addEventListener('click', () => {
    const next = (getPrefs().timeMode ?? 'local') === 'local' ? 'stadium' : 'local';
    setPref('timeMode', next);
    syncTimeToggle();
    document.dispatchEvent(new CustomEvent('timemodechange'));
  });
  document.addEventListener('langchange', syncTimeToggle);
  syncTimeToggle();
}

function initLangSwitch() {
  const buttons = document.querySelectorAll('.lang-btn');
  const sync = () => {
    for (const btn of buttons) btn.classList.toggle('active', btn.dataset.lang === getLang());
  };
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      sync();
    });
  }
  sync();
}

function renderHome() {
  renderHero();
  renderDashboard();
}

function showError(error) {
  document.getElementById('hero-content').innerHTML = `
    <p class="hero-label">${t('app.error')}</p>
    <p class="hero-meta">${t('app.errorHint')}</p>
    <p class="hero-meta"><code>${error.message}</code></p>`;
}

async function init() {
  initI18n();
  initTabs();
  initLangSwitch();
  initTimeToggle();
  initFavorites();
  initTooltips();
  document.addEventListener('langchange', renderHome);
  document.addEventListener('timemodechange', renderHero);
  try {
    await loadData();
    renderHome();
    initModal();
    initSchedule();
    initGroups();
    initBracket();
    initStadiums();
    initStats();
  } catch (error) {
    showError(error);
  }
}

init();
