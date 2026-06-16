// schedule.js — match schedule: list cards, filters (date, group, phase,
// team, stadium), diacritic-insensitive search, date sort.
// Knockout team names show as TBD until resolveBracketTeams() lands (step 7).

import { getData, formatMatchTime, matchDateUTC, flagSrc, matchState } from './app.js';
import { t, translatePhase } from './i18n.js';
import { openMatchModal } from './modal.js';
import { resolveBracketTeams, getFavoriteMatches } from './bracket.js';
import { getFavorites } from './storage.js';

const KNOCKOUT_PHASES = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Third Place', 'Final'];

// `occurred`: '' (all) | 'occurred' (over by clock/JSON) | 'upcoming' (live + not started)
const state = { search: '', date: '', group: '', phase: '', team: '', stadium: '', sort: 'asc', favOnly: false, occurred: '' };

// Re-render driver for the clock crossing a match window while the list is open.
// Signature = how many matches are "over" right now (monotonic), so a coarse 60s
// tick re-renders only when something actually flipped — no per-second card repaint.
const OCC_TICK_MS = 60 * 1000;
let occTimer = null;
let overSignature = -1;

const OCC_CYCLE = ['', 'occurred', 'upcoming'];

export function initSchedule() {
  renderToolbar();
  renderList();
  startOccurrenceClock();
  document.addEventListener('langchange', () => {
    renderToolbar();
    renderList();
  });
  // simulated picks change resolved knockout teams shown on cards
  document.addEventListener('simchange', renderList);
  document.addEventListener('favchange', renderList);
  document.addEventListener('timemodechange', renderList);
  document.addEventListener('datachange', renderList); // new published results/status

  // delegation on the panel root — survives every list re-render
  const root = document.getElementById('schedule-root');
  root.addEventListener('click', (event) => {
    if (event.target.closest('.fav-btn')) return; // star toggles, never opens
    const card = event.target.closest('.match-card');
    if (card) openMatchModal(Number(card.dataset.matchId));
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.fav-btn')) return;
    const card = event.target.closest('.match-card');
    if (card) {
      event.preventDefault();
      openMatchModal(Number(card.dataset.matchId));
    }
  });
}

// ------------------------------------------------------------- toolbar

function renderToolbar() {
  const { teams, groups, stadiums } = getData();
  const root = document.getElementById('schedule-root');

  const teamOptions = [...teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => `<option value="${team.id}">${team.name}</option>`).join('');
  const groupOptions = Object.keys(groups)
    .map((letter) => `<option value="${letter}">${t('phase.group')} ${letter}</option>`).join('');
  const phaseOptions = KNOCKOUT_PHASES
    .map((phase) => `<option value="${phase}">${translatePhase(phase)}</option>`).join('');
  const stadiumOptions = stadiums
    .map((s) => `<option value="${s.name}">${s.name}</option>`).join('');

  root.innerHTML = `
    <div class="schedule-toolbar glass">
      <input id="sched-search" class="schedule-search" type="search"
             placeholder="${t('schedule.searchPlaceholder')}" aria-label="${t('schedule.searchPlaceholder')}">
      <div class="filter-row">
        <input id="sched-date" class="filter-control" type="date"
               min="2026-06-11" max="2026-07-19" aria-label="${t('schedule.dateFilter')}">
        <select id="sched-group" class="filter-control" aria-label="${t('schedule.allGroups')}">
          <option value="">${t('schedule.allGroups')}</option>${groupOptions}
        </select>
        <select id="sched-phase" class="filter-control" aria-label="${t('schedule.allPhases')}">
          <option value="">${t('schedule.allPhases')}</option>
          <option value="groups">${t('schedule.groupStage')}</option>${phaseOptions}
        </select>
        <select id="sched-team" class="filter-control" aria-label="${t('schedule.allTeams')}">
          <option value="">${t('schedule.allTeams')}</option>${teamOptions}
        </select>
        <select id="sched-stadium" class="filter-control" aria-label="${t('schedule.allStadiums')}">
          <option value="">${t('schedule.allStadiums')}</option>${stadiumOptions}
        </select>
        <button id="sched-sort" class="filter-control sort-btn"></button>
        <button id="sched-occ" class="filter-control occ-filter ${state.occurred ? 'active' : ''}"
                aria-label="${occAriaLabel()}">${occButtonLabel()}</button>
        <button id="sched-fav" class="filter-control fav-filter ${state.favOnly ? 'active' : ''}"
                aria-pressed="${state.favOnly}">★ ${t('schedule.myMatches')}</button>
      </div>
    </div>
    <p class="schedule-count">
      <span id="sched-count" aria-live="polite"></span>
      <button id="sched-clear" class="link-btn">${t('schedule.clear')}</button>
    </p>
    <div class="match-grid" id="sched-list"></div>`;

  // restore current filter values after a rebuild (e.g. language change)
  byId('sched-search').value = state.search;
  byId('sched-date').value = state.date;
  byId('sched-group').value = state.group;
  byId('sched-phase').value = state.phase;
  byId('sched-team').value = state.team;
  byId('sched-stadium').value = state.stadium;
  syncSortLabel();

  byId('sched-search').addEventListener('input', (e) => setFilter('search', e.target.value));
  byId('sched-date').addEventListener('change', (e) => setFilter('date', e.target.value));
  byId('sched-group').addEventListener('change', (e) => setFilter('group', e.target.value));
  byId('sched-phase').addEventListener('change', (e) => setFilter('phase', e.target.value));
  byId('sched-team').addEventListener('change', (e) => setFilter('team', e.target.value));
  byId('sched-stadium').addEventListener('change', (e) => setFilter('stadium', e.target.value));
  byId('sched-sort').addEventListener('click', () => {
    state.sort = state.sort === 'asc' ? 'desc' : 'asc';
    syncSortLabel();
    renderList();
  });
  byId('sched-occ').addEventListener('click', () => {
    state.occurred = OCC_CYCLE[(OCC_CYCLE.indexOf(state.occurred) + 1) % OCC_CYCLE.length];
    const btn = byId('sched-occ');
    btn.classList.toggle('active', Boolean(state.occurred));
    btn.textContent = occButtonLabel();
    btn.setAttribute('aria-label', occAriaLabel());
    renderList();
  });
  byId('sched-fav').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    const btn = byId('sched-fav');
    btn.classList.toggle('active', state.favOnly);
    btn.setAttribute('aria-pressed', String(state.favOnly));
    renderList();
  });
  byId('sched-clear').addEventListener('click', () => {
    Object.assign(state, { search: '', date: '', group: '', phase: '', team: '', stadium: '', sort: 'asc', favOnly: false, occurred: '' });
    renderToolbar();
    renderList();
  });
}

function byId(id) {
  return document.getElementById(id);
}

// external entry point (stadiums page) — show only matches at one stadium
export function setStadiumFilter(stadiumName) {
  Object.assign(state, { search: '', date: '', group: '', phase: '', team: '', stadium: stadiumName, favOnly: false, occurred: '' });
  renderToolbar();
  renderList();
}

function setFilter(key, value) {
  state[key] = value;
  renderList();
}

function syncSortLabel() {
  byId('sched-sort').textContent = t(state.sort === 'asc' ? 'schedule.sortAsc' : 'schedule.sortDesc');
}

function occStateLabel() {
  if (state.occurred === 'occurred') return t('schedule.occPlayed');
  if (state.occurred === 'upcoming') return t('schedule.occUpcoming');
  return t('schedule.occAll');
}

function occButtonLabel() {
  return `◷ ${occStateLabel()}`;
}

function occAriaLabel() {
  return `${t('schedule.occAria')}: ${occStateLabel()}`;
}

// ------------------------------------------------------------ filtering

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function matchesFilters(match, now) {
  if (state.occurred) {
    // hybrid rule (same as the home hero): "over" = finished in JSON OR clock past
    // kickoff + window. "upcoming" bucket keeps live + not-yet-started together.
    const over = matchState(match, getData().resultByMatchId.get(match.id), now) === 'over';
    if (state.occurred === 'occurred' && !over) return false;
    if (state.occurred === 'upcoming' && over) return false;
  }
  if (state.date && match.date !== state.date) return false;
  if (state.group && match.phase !== `Group ${state.group}`) return false;
  if (state.phase === 'groups' && !match.phase.startsWith('Group')) return false;
  if (state.phase && state.phase !== 'groups' && match.phase !== state.phase) return false;
  if (state.stadium && match.stadium !== state.stadium) return false;
  if (state.team || state.search) {
    // resolved teams, so knockout matches are searchable once known
    const slots = resolveBracketTeams(match);
    if (state.team && slots.home.team?.id !== state.team && slots.away.team?.id !== state.team) return false;
    if (state.search) {
      const haystack = normalize(`${slots.home.label} ${slots.away.label} ${match.city} ${match.stadium}`);
      if (!haystack.includes(normalize(state.search))) return false;
    }
  }
  return true;
}

// -------------------------------------------------------------- render

function renderList() {
  const { matches } = getData();
  const now = Date.now();
  const direction = state.sort === 'asc' ? 1 : -1;
  const favIds = state.favOnly
    ? new Set(getFavoriteMatches(matches, getFavorites()).map((m) => m.id))
    : null;
  const filtered = matches
    .filter((m) => (!favIds || favIds.has(m.id)) && matchesFilters(m, now))
    .sort((a, b) => direction * (matchDateUTC(a) - matchDateUTC(b) || a.id - b.id));

  byId('sched-count').textContent =
    `${filtered.length} ${filtered.length === 1 ? t('schedule.match') : t('schedule.matches')}`;
  byId('sched-list').innerHTML = filtered.length
    ? filtered.map((m) => matchCardHTML(m, now)).join('')
    : `<p class="placeholder glass">${t('schedule.noResults')}</p>`;

  // keep the clock-tick baseline in sync with whatever we just rendered
  overSignature = countOverMatches(now);
}

// number of matches "over" at `now` — monotonic, so the 60s tick re-renders
// only when the clock pushes another match past the end of its window.
function countOverMatches(now) {
  const { matches, resultByMatchId } = getData();
  let n = 0;
  for (const m of matches) {
    if (matchState(m, resultByMatchId.get(m.id), now) === 'over') n++;
  }
  return n;
}

function startOccurrenceClock() {
  if (occTimer) return;
  occTimer = setInterval(() => {
    if (countOverMatches(Date.now()) !== overSignature) renderList();
  }, OCC_TICK_MS);
}

function teamColumnHTML(slot) {
  if (!slot.team) return `<div class="match-team"><span class="match-team-name tbd">${slot.label}</span></div>`;
  const fav = getFavorites().includes(slot.team.id);
  return `
    <div class="match-team">
      <img class="flag" src="${flagSrc(slot.team)}" alt="" width="34" height="23" loading="lazy">
      <span class="match-team-name">${slot.team.name}
        <button class="fav-btn ${fav ? 'active' : ''}" data-fav="${slot.team.id}"
                aria-pressed="${fav}" aria-label="${t('fav.toggle')} ${slot.team.name}">${fav ? '★' : '☆'}</button>
      </span>
    </div>`;
}

function matchCardHTML(match, now = Date.now()) {
  const { resultByMatchId, stadiumByName } = getData();
  const result = resultByMatchId.get(match.id);
  const status = result?.status ?? 'scheduled';
  const stadium = stadiumByName.get(match.stadium);
  // scheduled in JSON but the clock says its window already closed → the data
  // just hasn't caught up. Flag it instead of silently showing a plain "vs".
  const pending = status === 'scheduled' && matchState(match, result, now) === 'over';

  let statusChip = '';
  if (status === 'live') statusChip = `<span class="match-status live pulse">● ${t('hero.live')}</span>`;
  else if (status === 'finished') statusChip = `<span class="match-status finished">${t('status.finished')}</span>`;
  else if (pending) statusChip = `<span class="match-status pending">${t('status.pending')}</span>`;

  let center;
  if (status === 'finished' || status === 'live') {
    const pens = result.penalties
      ? `<span class="match-pens">(${result.penalties.home}–${result.penalties.away} ${t('status.pens')})</span>`
      : '';
    center = `<div class="match-score">${result.homeScore}<span class="match-score-sep">–</span>${result.awayScore}${pens}</div>`;
  } else {
    center = `<span class="match-vs">${t('hero.vs')}</span>`;
  }

  const slots = resolveBracketTeams(match);
  const favorites = getFavorites();
  const hasFav = favorites.includes(slots.home.team?.id) || favorites.includes(slots.away.team?.id);
  return `
    <article class="match-card glass hover-glow ${hasFav ? 'has-fav' : ''}" data-match-id="${match.id}"
             tabindex="0" role="button" aria-label="${slots.home.label} ${t('hero.vs')} ${slots.away.label} — ${translatePhase(match.phase)}">
      <header class="match-card-top">
        <span class="match-phase">${translatePhase(match.phase)}</span>
        ${statusChip}
      </header>
      <div class="match-teams">
        ${teamColumnHTML(slots.home)}
        ${center}
        ${teamColumnHTML(slots.away)}
      </div>
      <footer class="match-meta">${formatMatchTime(match, stadium)} · ${match.stadium}, ${match.city}</footer>
    </article>`;
}
