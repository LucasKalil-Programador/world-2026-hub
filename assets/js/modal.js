// modal.js — match detail modal built on the native <dialog> element
// (focus trap, Esc-to-close and ::backdrop for free). Shows teams, time,
// stadium, city, capacity, result (+penalties) and a placeholder section for
// future stats (possession, shots, cards). "Add to calendar" lands in step 12.

import { getData, formatMatchTime, flagSrc } from './app.js';
import { t, getLocale, translatePhase } from './i18n.js';
import { resolveBracketTeams } from './bracket.js';
import { getFavorites } from './storage.js';
import { exportMatchToICS } from './calendar.js';

let dialog = null;
let currentMatchId = null;
let lastFocused = null;

export function initModal() {
  document.getElementById('modal-root').innerHTML =
    '<dialog class="match-modal" id="match-dialog"></dialog>';
  dialog = document.getElementById('match-dialog');

  // a click on the dialog element itself (not its padded content) = backdrop
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    currentMatchId = null;
    lastFocused?.focus?.();
  });
  const rerenderIfOpen = () => {
    if (dialog.open && currentMatchId) renderContent(currentMatchId);
  };
  document.addEventListener('langchange', rerenderIfOpen);
  document.addEventListener('favchange', rerenderIfOpen);
  document.addEventListener('timemodechange', rerenderIfOpen);
}

export function openMatchModal(matchId) {
  lastFocused = document.activeElement;
  currentMatchId = matchId;
  renderContent(matchId);
  dialog.showModal();
}

// -------------------------------------------------------------- render

function renderContent(matchId) {
  const { matches, resultByMatchId, stadiumByName } = getData();
  const match = matches.find((m) => m.id === matchId);
  if (!match) return;
  const result = resultByMatchId.get(matchId);
  const status = result?.status ?? 'scheduled';
  const s = result?.stats;
  const stadium = stadiumByName.get(match.stadium);
  const slots = resolveBracketTeams(match);
  const numberFmt = new Intl.NumberFormat(getLocale());

  const statusChip =
    status === 'live' ? `<span class="match-status live pulse">● ${t('hero.live')}</span>`
    : status === 'finished' ? `<span class="match-status finished">${t('status.finished')}</span>`
    : `<span class="match-status">${t('status.scheduled')}</span>`;

  let center;
  if (status === 'finished' || status === 'live') {
    const pens = result.penalties
      ? `<span class="match-pens">(${result.penalties.home}–${result.penalties.away} ${t('status.pens')})</span>`
      : '';
    center = `<div class="modal-score">${result.homeScore}<span class="match-score-sep">–</span>${result.awayScore}${pens}</div>`;
  } else {
    center = `<span class="hero-vs">${t('hero.vs')}</span>`;
  }

  dialog.innerHTML = `
    <div class="modal-content slide-up" role="document">
      <header class="modal-top">
        <p class="modal-phase">${translatePhase(match.phase)} ${statusChip}</p>
        <button class="modal-close" data-close aria-label="${t('modal.close')}">✕</button>
      </header>
      <div class="modal-matchup">
        ${teamHTML(slots.home)}
        ${center}
        ${teamHTML(slots.away)}
      </div>
      <dl class="modal-info">
        <div><dt>${t('modal.date')}</dt><dd>${formatMatchTime(match, stadium)}</dd></div>
        <div><dt>${t('modal.stadium')}</dt><dd>${match.stadium}</dd></div>
        <div><dt>${t('modal.city')}</dt><dd>${match.city}</dd></div>
        <div><dt>${t('stadiums.capacity')}</dt><dd>${stadium ? numberFmt.format(stadium.capacity) : '—'}</dd></div>
      </dl>
      <section class="modal-stats" aria-label="${t('modal.stats')}">
        <h3>${t('modal.stats')}</h3>
        ${statRow(s ? `${s.possession.home}%` : '—', t('modal.possession'), s ? `${s.possession.away}%` : '—')}
        ${statRow(s ? s.shots.home : '—', t('modal.shots'), s ? s.shots.away : '—')}
        ${statRow(s ? s.cards.home : '—', t('modal.cards'), s ? s.cards.away : '—')}
        ${s ? '' : `<p class="modal-stats-note">${t('modal.statsSoon')}</p>`}
      </section>
      <div class="modal-actions">
        <button class="btn-primary" id="modal-ics">${t('modal.addCalendar')}</button>
      </div>
    </div>`;

  dialog.setAttribute('aria-label', `${slots.home.label} ${t('hero.vs')} ${slots.away.label} — ${translatePhase(match.phase)}`);
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('#modal-ics').addEventListener('click', () => exportMatchToICS(match, stadium));
}

function teamHTML(slot) {
  if (!slot.team) return `<div class="hero-team"><span class="match-team-name tbd">${slot.label}</span></div>`;
  const fav = getFavorites().includes(slot.team.id);
  return `
    <div class="hero-team">
      <img class="flag" src="${flagSrc(slot.team)}" alt="" width="48" height="32">
      <span class="modal-team-name">${slot.team.name}
        <button class="fav-btn ${fav ? 'active' : ''}" data-fav="${slot.team.id}"
                aria-pressed="${fav}" aria-label="${t('fav.toggle')} ${slot.team.name}">${fav ? '★' : '☆'}</button>
      </span>
    </div>`;
}

// stat row — shows real home/away values, or "—" when no stats data exists
function statRow(home, label, away) {
  return `
    <div class="modal-stat-row">
      <span>${home}</span>
      <span class="modal-stat-label">${label}</span>
      <span>${away}</span>
    </div>`;
}
