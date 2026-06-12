// groups.js — standings computed from groups.json + results.json and the 12
// group tables. Only matches with status "finished" count toward standings
// (live scores are ignored until full-time). computeStandings() and
// isGroupFinished() are reused by bracket.js to resolve the Round of 32.

import { getData, flagSrc } from './app.js';
import { t } from './i18n.js';
import { getFavorites } from './storage.js';

// Tiebreak order per complement spec §2: points, goal difference, goals for.
// Team id alphabetical as a final stable fallback.
export function computeStandings() {
  const { groups, matches, resultByMatchId } = getData();
  const tables = {};
  for (const [letter, teamIds] of Object.entries(groups)) {
    tables[letter] = new Map(teamIds.map((id) => [id, {
      teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0,
    }]));
  }

  for (const match of matches) {
    if (!match.phase.startsWith('Group ')) continue;
    const result = resultByMatchId.get(match.id);
    if (result?.status !== 'finished') continue;
    const rows = tables[match.phase.slice(6)];
    applyResult(rows.get(match.homeTeam), result.homeScore, result.awayScore);
    applyResult(rows.get(match.awayTeam), result.awayScore, result.homeScore);
  }

  const standings = {};
  for (const [letter, rows] of Object.entries(tables)) {
    standings[letter] = [...rows.values()].sort((a, b) =>
      b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.teamId.localeCompare(b.teamId));
  }
  return standings;
}

function applyResult(row, scored, conceded) {
  row.played += 1;
  row.gf += scored;
  row.ga += conceded;
  row.gd = row.gf - row.ga;
  if (scored > conceded) { row.won += 1; row.points += 3; }
  else if (scored === conceded) { row.drawn += 1; row.points += 1; }
  else { row.lost += 1; }
}

export function isGroupFinished(letter) {
  const { matches, resultByMatchId } = getData();
  return matches
    .filter((m) => m.phase === `Group ${letter}`)
    .every((m) => resultByMatchId.get(m.id)?.status === 'finished');
}

// -------------------------------------------------------------- render

export function initGroups() {
  render();
  document.addEventListener('langchange', render);
  document.addEventListener('favchange', render);
}

function render() {
  const standings = computeStandings();
  document.getElementById('groups-root').innerHTML = `
    <p class="standings-legend">
      <span class="legend-item"><span class="legend-dot qualified"></span>${t('standings.legendTop2')}</span>
      <span class="legend-item"><span class="legend-dot third"></span>${t('standings.legendThird')}</span>
    </p>
    <div class="groups-grid">
      ${Object.entries(standings).map(([letter, rows]) => groupCardHTML(letter, rows)).join('')}
    </div>`;
}

function groupCardHTML(letter, rows) {
  const finished = isGroupFinished(letter);
  const headers = ['played', 'won', 'drawn', 'lost', 'gf', 'ga', 'gd', 'pts']
    .map((key) => `<th class="${key === 'gf' || key === 'ga' ? 'col-goals' : ''}" scope="col">${t(`standings.${key}`)}</th>`)
    .join('');

  return `
    <section class="group-card glass" aria-labelledby="group-title-${letter}">
      <header class="group-card-header">
        <h3 id="group-title-${letter}">${t('phase.group')} ${letter}</h3>
        ${finished ? '' : `<span class="group-progress">${t('standings.inProgress')}</span>`}
      </header>
      <table class="standings-table">
        <thead>
          <tr><th scope="col">#</th><th class="col-team" scope="col">${t('standings.team')}</th>${headers}</tr>
        </thead>
        <tbody>${rows.map(standingRowHTML).join('')}</tbody>
      </table>
    </section>`;
}

function standingRowHTML(row, index) {
  const team = getData().teamById.get(row.teamId);
  const fav = getFavorites().includes(team.id);
  const rankClass = [
    index < 2 ? 'row-qualified' : index === 2 ? 'row-third' : '',
    fav ? 'fav-row' : '',
  ].filter(Boolean).join(' ');
  return `
    <tr class="${rankClass}">
      <td>${index + 1}</td>
      <td class="col-team">
        <img class="flag" src="${flagSrc(team)}" alt="" width="22" height="15" loading="lazy">
        <span>${team.name}</span>
        <button class="fav-btn ${fav ? 'active' : ''}" data-fav="${team.id}"
                aria-pressed="${fav}" aria-label="${t('fav.toggle')} ${team.name}">${fav ? '★' : '☆'}</button>
      </td>
      <td>${row.played}</td>
      <td>${row.won}</td>
      <td>${row.drawn}</td>
      <td>${row.lost}</td>
      <td class="col-goals">${row.gf}</td>
      <td class="col-goals">${row.ga}</td>
      <td>${row.gd > 0 ? '+' : ''}${row.gd}</td>
      <td class="col-pts">${row.points}</td>
    </tr>`;
}
