// app.js — entry point: loadData() over data/*.json, tab routing with lastTab
// persistence, formatMatchTime(), hero (live or next match + countdown),
// dashboard cards.

import { getPrefs, setPref, toggleFavorite } from './storage.js';
import { initI18n, setLang, getLang, getLocale, t, translatePhase } from './i18n.js';
import { initSchedule } from './schedule.js';
import { initGroups } from './groups.js';
import { initStadiums } from './stadiums.js';
import { initModal } from './modal.js';
import { initBracket, invalidateBracket } from './bracket.js';
import { initStats } from './stats.js';

// ---------------------------------------------------------------- data

let data = null;

// Cache-buster rounded down to the current minute: the URL stays stable within
// the same minute (so the browser can reuse the response) but changes every
// minute, guaranteeing a fresh fetch without ever serving a stale results.json.
function dataCacheBust() {
  const now = new Date();
  now.setSeconds(0);
  now.setMilliseconds(0);
  return now.getTime();
}

// Optional data layers for the post-tournament stats screen (players, awards,
// editorial — see .agents/stats-screen-plan.md §0.2). They don't exist yet, so
// an absent/404 file is the NORMAL "this layer hasn't arrived" state: return the
// empty default silently (graceful degradation — never surface the gap, and keep
// the console clean). Warn only when a file is present but malformed (a real dev
// error). Never throws — the stats screen lights these up as the JSON lands.
async function loadOptional(name, fallback) {
  try {
    const res = await fetch(`data/${name}.json?t=${dataCacheBust()}`);
    if (!res.ok) return fallback; // not provided yet → empty, no noise
    return await res.json();
  } catch (err) {
    console.warn(`data/${name}.json present but unreadable — ignoring`, err);
    return fallback;
  }
}

export async function loadData() {
  if (data) return data;
  const files = ['teams', 'groups', 'matches', 'results', 'stadiums', 'bracket-config'];
  // Core files are mandatory: a failure here is fatal (throws → showError()).
  const corePromise = Promise.all(
    files.map(async (name) => {
      const res = await fetch(`data/${name}.json?t=${dataCacheBust()}`);
      if (!res.ok) throw new Error(`data/${name}.json — HTTP ${res.status}`);
      return res.json();
    }),
  );
  // Optional layers fetched concurrently; each defaults to empty, never fatal.
  const optionalPromise = Promise.all([
    loadOptional('players', []),
    loadOptional('player-events', []),
    loadOptional('awards', {}),
    loadOptional('keeper-stats', []),
    loadOptional('curiosities', []),
    loadOptional('all-time-baselines', {}),
  ]);
  const [teams, groups, matches, results, stadiums, bracketConfig] = await corePromise;
  const [players, playerEvents, awards, keeperStats, curiosities, allTimeBaselines] =
    await optionalPromise;
  data = {
    teams, groups, matches, results, stadiums, bracketConfig,
    players, playerEvents, awards, keeperStats, curiosities, allTimeBaselines,
    teamById: new Map(teams.map((team) => [team.id, team])),
    stadiumByName: new Map(stadiums.map((s) => [s.name, s])),
    resultByMatchId: new Map(results.map((r) => [r.matchId, r])),
  };
  return data;
}

export function getData() {
  return data;
}

// ------------------------------------------------------ live data refresh
// results.json is the only file that changes during the tournament, and it is
// updated by a MANUAL daily push (scores land post-match, on deploy) — not a
// live feed. An open tab fetches it once at load; this poll surfaces a newly
// published result/stats without an F5. Static host → polling is the only
// option; because the data isn't live, a plain fixed interval is right (a
// per-match "live" tier would have nothing new to fetch). Paused while the tab
// is hidden and stopped once the final result is in — see .agents/issues.md.
const POLL_INTERVAL_MS = 60 * 1000;
let pollTimer = null;
let resultsSig = null;

// Nothing left to fetch once the final's REAL result is in the data. Guard on
// the JSON status, not the clock-driven 'over' — clock-over fires 3h after
// kickoff and could stop the poll before the actual score is published.
function tournamentOver() {
  const final = data.matches.find((m) => m.bracketRef === 'FINAL');
  return final ? data.resultByMatchId.get(final.id)?.status === 'finished' : false;
}

async function pollResults() {
  if (tournamentOver()) { stopResultsPolling(); return; }
  let results;
  try {
    // ?t + no-store bypasses Hostinger's missing cache headers (same scheme loadData uses)
    const res = await fetch(`data/results.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    results = await res.json();
  } catch {
    return; // network blip or mid-deploy partial — just retry next tick
  }
  // Content signature: catches scores, stats backfill and penalties alike —
  // a finished-count signature would miss corrections and stats-only edits.
  const sig = JSON.stringify(results);
  if (sig === resultsSig) return; // unchanged → zero re-render
  resultsSig = sig;
  data.results = results;
  data.resultByMatchId = new Map(results.map((r) => [r.matchId, r])); // derived map must be rebuilt too
  // bracket-config.json (thirdPlaceAssignment) only ever changes alongside a
  // results change — the one-time 3rd-place fill ships in the same daily push.
  // So piggyback a refetch on the rare results-changed event (not every tick):
  // closes the gap where the 8 third-place slots would otherwise need an F5.
  try {
    const cfg = await fetch(`data/bracket-config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (cfg.ok) data.bracketConfig = await cfg.json();
  } catch { /* keep the in-memory config */ }
  invalidateBracket(); // cached tree depends on results + bracketConfig
  document.dispatchEvent(new CustomEvent('datachange')); // each view re-renders itself
  if (tournamentOver()) stopResultsPolling();
}

function onVisibility() {
  if (!document.hidden) pollResults(); // catch up the instant the user returns
}

function startResultsPolling() {
  if (pollTimer || tournamentOver()) return;
  resultsSig = JSON.stringify(data.results); // seed from what loadData() already fetched
  pollTimer = setInterval(() => { if (!document.hidden) pollResults(); }, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', onVisibility);
}

function stopResultsPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  document.removeEventListener('visibilitychange', onVisibility);
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
  scrollActiveTabIntoView(true);
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

  // edge fades + keep the active tab visible while the nav scrolls horizontally
  // (below the 1100px single-row breakpoint the tab strip is a scroll container)
  const tabsEl = document.querySelector('.tabs');
  tabsEl.addEventListener('scroll', updateTabFades, { passive: true });
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { scrollActiveTabIntoView(false); updateTabFades(); });
  });
  // language toggle changes label widths → re-measure overflow and recenter
  document.addEventListener('langchange', () => { scrollActiveTabIntoView(false); updateTabFades(); });

  activateTab(location.hash.slice(1) || getPrefs().lastTab || 'home');
  updateTabFades();
}

// Toggle edge-fade masks on the tab strip: a fade only shows on a side that has
// more tabs to scroll toward, so the cut-off tab no longer looks like a bug.
function updateTabFades() {
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  const overflowing = tabs.scrollWidth - tabs.clientWidth > 1;
  const atStart = tabs.scrollLeft <= 1;
  const atEnd = tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 1;
  tabs.classList.toggle('fade-left', overflowing && !atStart);
  tabs.classList.toggle('fade-right', overflowing && !atEnd);
}

// Horizontally scroll the active tab to the center of the strip (no page jump).
function scrollActiveTabIntoView(smooth) {
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  const active = tabs.querySelector('.tab-btn.active');
  if (!active || tabs.scrollWidth <= tabs.clientWidth) { updateTabFades(); return; }
  const tabsRect = tabs.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  const target = tabs.scrollLeft + (aRect.left - tabsRect.left) - (tabs.clientWidth - aRect.width) / 2;
  tabs.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  requestAnimationFrame(updateTabFades);
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

// Featured = the earliest matches that aren't over yet, INCLUDING every match
// sharing that exact kickoff. At the end of the group stage a group's last two
// games kick off simultaneously, so the hero must show both (they share kickoff
// + phase → same window → synced clock state). Returns [] when nothing is left.
function findFeaturedMatches(now) {
  const { matches, resultByMatchId } = data;
  const upNext = matches
    .filter((m) => matchState(m, resultByMatchId.get(m.id), now) !== 'over')
    .sort((a, b) => matchDateUTC(a) - matchDateUTC(b) || a.id - b.id);
  if (!upNext.length) return [];
  const kickoff = matchDateUTC(upNext[0]).getTime();
  return upNext.filter((m) => matchDateUTC(m).getTime() === kickoff);
}

// Compact signature of "what the hero should show now"; a change drives a rebuild.
// Covers the whole featured set so adding/removing a simultaneous match (or any
// of them flipping state) re-renders.
function heroSignature(featured, now) {
  if (!featured.length) return '∅';
  return featured
    .map((m) => `${m.id}:${matchState(m, data.resultByMatchId.get(m.id), now)}`)
    .join('|');
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

// One matchup row (teams + center) plus its meta line. `multi` drops the time
// from the meta (shown once, shared) and keeps only the stadium; a single match
// keeps the original "time · stadium, city" so the lone-match hero is unchanged.
function heroMatchupHTML(match, now, multi) {
  const result = data.resultByMatchId.get(match.id);
  const stadium = data.stadiumByName.get(match.stadium);
  const live = matchState(match, result, now) === 'live';
  const hasScore = result?.homeScore != null && result?.awayScore != null;

  // Live shows the JSON score only when it exists; a clock-driven in-progress
  // match (JSON not updated yet) falls back to "vs", like an upcoming match.
  const center = live && hasScore
    ? `<div class="hero-score">${result.homeScore}<span class="hero-score-sep">–</span>${result.awayScore}</div>`
    : `<div class="hero-vs">${t('hero.vs')}</div>`;
  const meta = multi
    ? `${match.stadium}, ${match.city}`
    : `${formatMatchTime(match, stadium)} · ${match.stadium}, ${match.city}`;

  return `
    <div class="hero-matchup">
      ${heroTeamHTML(match.homeTeam)}
      ${center}
      ${heroTeamHTML(match.awayTeam)}
    </div>
    <p class="hero-meta">${meta}</p>`;
}

function renderHero() {
  const root = document.getElementById('hero-content');
  const now = Date.now();
  const featured = findFeaturedMatches(now);
  heroSig = heroSignature(featured, now);
  countdownTarget = null;
  countdownEls = null;

  if (!featured.length) {
    root.innerHTML = '';
    startHeroClock();
    return;
  }

  // Simultaneous matches share kickoff + phase, so one label, one shared time
  // and one countdown cover the whole set; each matchup keeps its own score.
  const multi = featured.length > 1;
  const live = featured.some((m) => matchState(m, data.resultByMatchId.get(m.id), now) === 'live');
  const phase = translatePhase(featured[0].phase);

  const rows = featured
    .map((m) => (multi ? `<div class="hero-match">${heroMatchupHTML(m, now, true)}</div>` : heroMatchupHTML(m, now, false)))
    .join(multi ? '<div class="hero-divider" aria-hidden="true"></div>' : '');
  const body = multi ? `<div class="hero-matchups">${rows}</div>` : rows;

  // shared kickoff time, shown once. Real simultaneous pairs are same-timezone,
  // so the first match's stadium gives the right time even in stadium-time mode.
  const sharedTime = multi
    ? `<p class="hero-meta hero-time">${formatMatchTime(featured[0], data.stadiumByName.get(featured[0].stadium))}</p>`
    : '';

  root.innerHTML = `
    <p class="hero-label">
      ${live ? `<span class="live-badge pulse">● ${t('hero.inProgress')}</span>` : t(multi ? 'hero.nextMatches' : 'hero.nextMatch')}
      <span class="hero-phase">${phase}</span>
    </p>
    ${sharedTime}
    ${body}
    ${live ? '' : `<div class="countdown" id="countdown" role="timer" aria-label="${t('hero.countdownLabel')}"></div>`}
  `;
  if (!live) setupCountdown(matchDateUTC(featured[0]).getTime());
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
  
  lastSeconds = null;
  updateCountdown();
}

let lastSeconds = null

function updateCountdown() {
  if (!countdownEls) return;
  const seconds = Math.floor(Math.max(0, countdownTarget - Date.now()) / 1000);

  if (seconds === lastSeconds) return;
  lastSeconds = seconds;

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
  heroTimer = setInterval(heroTick, 250);
}

function heroTick() {
  const now = Date.now();
  const sig = heroSignature(findFeaturedMatches(now), now);
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
  // icon + label split so the label can collapse on narrow screens (the
  // accessible name comes from data-i18n-aria, so hiding the text is a11y-safe).
  btn.innerHTML = `<span class="time-icon" aria-hidden="true">🕐</span>` +
    `<span class="time-label">${t(mode === 'local' ? 'time.local' : 'time.stadium')}</span>`;
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

// The header is sticky with a VARIABLE height (one row ≥1100px, two bands below).
// Expose its live height as --header-h so the stats sub-nav can stick right
// beneath it and sections can offset their scroll target at every breakpoint.
function trackHeaderHeight() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const set = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(header);
  else window.addEventListener('resize', set);
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
  trackHeaderHeight();
  initLangSwitch();
  initTimeToggle();
  initFavorites();
  initTooltips();
  document.addEventListener('langchange', renderHome);
  document.addEventListener('timemodechange', renderHero);
  document.addEventListener('datachange', renderHome); // poll picked up new results → refresh hero + dashboard counts
  try {
    await loadData();
    renderHome();
    initModal();
    initSchedule();
    initGroups();
    initBracket();
    initStadiums();
    initStats();
    startResultsPolling(); // after the views register their datachange listeners
  } catch (error) {
    showError(error);
  }
}

init();
