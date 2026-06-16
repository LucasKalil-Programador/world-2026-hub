// stats.js — "Stats" tab. Tournament-to-date aggregates derived ONLY from data
// the project already has (results.json scores/status + optional per-match
// stats, matches.json phase). Counts finished matches only, consistent with
// computeStandings (live/scheduled ignored). Built as the evolving foundation
// for the post-tournament stats screen (see .agents/stats-screen-plan.md):
// sections gate on data so player/award/editorial blocks slot in later.

import { getData, flagSrc, navigateTo } from './app.js';
import { t, translatePhase } from './i18n.js';

// "Goals by stage" collapses all 12 groups into one bucket; knockout phases
// keep their own. Order used to render the chart left-to-right.
const STAGE_ORDER = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Third Place', 'Final'];

// Per-team table: all 48 teams, 8 per page (6 fixed pages). Sortable columns —
// existing standings.* labels are reused for the abbreviations the user already
// knows from the Groups tab; the two new ones carry a full-name title tooltip.
const PAGE_SIZE = 8;
const COLUMNS = [
  { key: 'played', label: 'standings.played', tip: 'tip.played' },
  { key: 'won', label: 'standings.won', tip: 'tip.won' },
  { key: 'drawn', label: 'standings.drawn', tip: 'tip.drawn' },
  { key: 'lost', label: 'standings.lost', tip: 'tip.lost' },
  { key: 'gf', label: 'standings.gf', tip: 'tip.gf' },
  { key: 'ga', label: 'standings.ga', tip: 'tip.ga' },
  { key: 'gd', label: 'standings.gd', tip: 'tip.gd' },
  { key: 'points', label: 'standings.pts', tip: 'tip.pts' },
  { key: 'gpg', label: 'stats.colGpg', tip: 'tip.gpg' },
  { key: 'cleanSheets', label: 'stats.colCS', tip: 'tip.cs' },
];

let model = null;
// table interaction state — survives langchange re-renders (default on load:
// most goals first, page 1), like the bracket keeps its zoom across re-renders.
let sortKey = 'gf';
let sortDir = 'desc';
let teamPage = 0;

function stageOf(phase) {
  return phase.startsWith('Group ') ? 'Group' : phase;
}

// Tournament-wide team aggregation over finished matches (group + knockout).
// computeStandings() only covers group matches, so this is its own pass.
// possession/shots/cards are gated per-match: a finished match without the
// optional `stats` object simply doesn't contribute (no visible distortion).
function aggregateTeams(finished, resultByMatchId) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, {
        teamId: id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0,
        cleanSheets: 0, possSum: 0, possCount: 0, shots: 0, cards: 0,
      });
    }
    return rows.get(id);
  };
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const home = row(m.homeTeam);
    const away = row(m.awayTeam);
    applySide(home, r.homeScore, r.awayScore);
    applySide(away, r.awayScore, r.homeScore);
    if (r.stats) {
      const s = r.stats;
      if (s.possession) {
        home.possSum += s.possession.home; home.possCount += 1;
        away.possSum += s.possession.away; away.possCount += 1;
      }
      if (s.shots) { home.shots += s.shots.home; away.shots += s.shots.away; }
      if (s.cards) { home.cards += s.cards.home; away.cards += s.cards.away; }
    }
  }
  return rows;
}

function applySide(row, gf, ga) {
  row.played += 1;
  row.gf += gf;
  row.ga += ga;
  if (ga === 0) row.cleanSheets += 1;
  if (gf > ga) row.won += 1;
  else if (gf === ga) row.drawn += 1;
  else row.lost += 1;
}

function buildStatsModel() {
  const { matches, resultByMatchId } = getData();
  const finished = matches.filter((m) => resultByMatchId.get(m.id)?.status === 'finished');

  let totalGoals = 0;
  let draws = 0;
  let decisive = 0;
  let biggestMargin = 0;
  const byStage = new Map();

  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const total = r.homeScore + r.awayScore;
    totalGoals += total;
    if (r.homeScore === r.awayScore) draws += 1; else decisive += 1;
    biggestMargin = Math.max(biggestMargin, Math.abs(r.homeScore - r.awayScore));
    const stage = stageOf(m.phase);
    const bucket = byStage.get(stage) ?? { goals: 0, count: 0 };
    bucket.goals += total;
    bucket.count += 1;
    byStage.set(stage, bucket);
  }

  const agg = aggregateTeams(finished, resultByMatchId);
  let cleanSheets = 0;
  for (const r of agg.values()) cleanSheets += r.cleanSheets;

  // one row per team for ALL 48 (teams that haven't played yet are real zeros,
  // not gaps), with the derived columns the table needs.
  const teamStats = getData().teams.map((team) => {
    const a = agg.get(team.id);
    const gf = a?.gf ?? 0;
    const ga = a?.ga ?? 0;
    const won = a?.won ?? 0;
    const drawn = a?.drawn ?? 0;
    const played = a?.played ?? 0;
    return {
      teamId: team.id,
      played,
      won,
      drawn,
      lost: a?.lost ?? 0,
      gf,
      ga,
      gd: gf - ga,
      points: won * 3 + drawn,
      cleanSheets: a?.cleanSheets ?? 0,
      gpg: played ? gf / played : 0,
    };
  });

  return {
    totalMatches: matches.length,
    finishedCount: finished.length,
    totalGoals,
    avgGoals: finished.length ? totalGoals / finished.length : 0,
    draws,
    decisive,
    biggestMargin,
    cleanSheets,
    byStage,
    teamStats,
    leaders: computeLeaders(teamStats),
  };
}

// Highlight leaders consider only teams that have played, so a 0-game team's
// empty record never counts as "best defense". Null before any match finishes.
function computeLeaders(teamStats) {
  const played = teamStats.filter((row) => row.played > 0);
  if (!played.length) return null;
  return {
    bestAttack: [...played].sort((a, b) => b.gf - a.gf || b.gd - a.gd)[0],
    bestDefense: [...played].sort((a, b) => a.ga - b.ga || b.cleanSheets - a.cleanSheets || b.gd - a.gd)[0],
    mostCleanSheets: [...played].sort((a, b) => b.cleanSheets - a.cleanSheets || a.ga - b.ga)[0],
  };
}

// ---------------------------------------------------------------- render

export function initStats() {
  render();
  // labels re-render on language change; the derived model never changes at
  // runtime (data is static per page load) so it is reused.
  document.addEventListener('langchange', render);
  // new published results change the aggregates → rebuild the memoized model
  document.addEventListener('datachange', () => { model = null; render(); });
}

function render() {
  if (!model) model = buildStatsModel();
  const root = document.getElementById('stats-root');
  root.innerHTML = heroHTML() + overviewHTML() + teamsSectionHTML() + footerHTML();
  root.querySelector('#stats-see-matches')?.addEventListener('click', () => navigateTo('matches'));
  const teamsHost = root.querySelector('#stats-teams-table');
  if (teamsHost) {
    teamsHost.addEventListener('click', onTeamTableClick);
    renderTeamTable();
  }
  setupCountUps(root);
}

function heroHTML() {
  const m = model;
  const progress = t('stats.heroProgress')
    .replace('{x}', String(m.finishedCount))
    .replace('{y}', String(m.totalMatches));
  const tiles = [
    { value: m.totalGoals, decimals: 0, label: t('stats.tileGoals') },
    { value: Number(m.avgGoals.toFixed(2)), decimals: 2, label: t('stats.tileAvg') },
    { value: m.biggestMargin, decimals: 0, label: t('stats.tileBiggestMargin') },
    { value: m.cleanSheets, decimals: 0, label: t('stats.tileCleanSheets') },
  ];
  return `
    <section class="stats-hero glass slide-up">
      <p class="hero-label">${t('stats.heroTitle')}<span class="hero-phase">${progress}</span></p>
      <div class="stats-hero-tiles">
        ${tiles.map((tile) => `
          <div class="stats-tile">
            <span class="stats-tile-value" data-countup="${tile.value}" data-decimals="${tile.decimals}">${tile.decimals ? '0.00' : '0'}</span>
            <span class="stats-tile-label">${tile.label}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

function overviewHTML() {
  const m = model;
  const cards = [
    { value: String(m.finishedCount), sub: `/ ${m.totalMatches}`, label: t('stats.played') },
    { value: String(m.decisive), label: t('stats.decisive') },
    { value: String(m.draws), label: t('stats.draws') },
  ];
  return `
    <h2 class="section-title">${t('stats.overviewTitle')}</h2>
    <div class="stats-overview-grid">
      ${cards.map((card) => `
        <div class="stat-card glass">
          <span class="stat-value">${card.value}${card.sub ? `<span class="stat-sub">${card.sub}</span>` : ''}</span>
          <span class="stat-label">${card.label}</span>
        </div>`).join('')}
    </div>
    ${goalsByStageHTML()}`;
}

function footerHTML() {
  return `
    <p class="stats-more">
      <button class="stats-link" id="stats-see-matches" type="button">${t('stats.seeAllMatches')} →</button>
    </p>`;
}

function goalsByStageHTML() {
  const order = ['Group', ...STAGE_ORDER].filter((stage) => model.byStage.has(stage));
  if (!order.length) return '';
  const max = Math.max(...order.map((stage) => model.byStage.get(stage).goals));
  const rows = order.map((stage) => {
    const bucket = model.byStage.get(stage);
    const pct = max ? Math.round((bucket.goals / max) * 100) : 0;
    const label = stage === 'Group' ? t('stats.stageGroup') : translatePhase(stage);
    return `
      <div class="chart-row">
        <span class="chart-bar-label">${label}</span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%"></div></div>
        <span class="chart-bar-val">${bucket.goals}</span>
      </div>`;
  }).join('');
  return `
    <h2 class="section-title">${t('stats.goalsByPhase')}</h2>
    <div class="stats-chart glass">${rows}</div>`;
}

// ----------------------------------------------------- team statistics

function teamsSectionHTML() {
  return `
    <h2 class="section-title">${t('stats.teamStatsTitle')}</h2>
    ${leadersHTML()}
    <div id="stats-teams-table" class="stats-teams-table"></div>
    ${legendHTML(COLUMNS)}`;
}

// Compact abbreviation key — hidden on desktop (the hover tooltip covers it
// there), shown on small screens where hover doesn't fire.
function legendHTML(columns) {
  const pairs = columns
    .map((col) => `<span class="legend-pair"><b>${t(col.label)}</b> = ${t(col.tip)}</span>`)
    .join('');
  return `<p class="stats-legend">${pairs}</p>`;
}

function leadersHTML() {
  const leaders = model.leaders;
  if (!leaders) return '';
  const cards = [
    { label: t('stats.bestAttack'), row: leaders.bestAttack, value: leaders.bestAttack.gf },
    { label: t('stats.bestDefense'), row: leaders.bestDefense, value: leaders.bestDefense.ga },
    { label: t('stats.mostCleanSheets'), row: leaders.mostCleanSheets, value: leaders.mostCleanSheets.cleanSheets },
  ];
  return `<div class="stats-leaders">${cards.map(leaderCardHTML).join('')}</div>`;
}

function leaderCardHTML({ label, row, value }) {
  const team = getData().teamById.get(row.teamId);
  return `
    <div class="leader-card glass">
      <span class="leader-label">${label}</span>
      <div class="leader-team">
        <img class="flag" src="${flagSrc(team)}" alt="" width="30" height="20" loading="lazy">
        <span class="leader-name">${team.name}</span>
      </div>
      <span class="leader-value">${value}</span>
    </div>`;
}

function sortedTeamStats() {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...model.teamStats].sort((a, b) => {
    const primary = (a[sortKey] - b[sortKey]) * dir;
    if (primary) return primary;
    // tiebreak is always GD → GF → name, independent of the sort direction
    return b.gd - a.gd || b.gf - a.gf || a.teamId.localeCompare(b.teamId);
  });
}

function renderTeamTable() {
  const host = document.getElementById('stats-teams-table');
  if (!host) return;
  const sorted = sortedTeamStats();
  const pages = Math.ceil(sorted.length / PAGE_SIZE);
  teamPage = Math.max(0, Math.min(teamPage, pages - 1));
  const start = teamPage * PAGE_SIZE;
  host.innerHTML = tableHTML(sorted.slice(start, start + PAGE_SIZE), start) + paginationHTML(pages);
}

function tableHTML(rows, startIndex) {
  const head = COLUMNS.map((col) => {
    const active = col.key === sortKey;
    const aria = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    const arrow = active ? `<span class="sort-arrow" aria-hidden="true">${sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
    const tip = t(col.tip);
    return `<th scope="col" class="col-num${active ? ' sorted' : ''}" aria-sort="${aria}">
      <button type="button" class="col-sort has-tip" data-sort="${col.key}" data-tip="${tip}" aria-label="${t(col.label)} — ${tip}">${t(col.label)}${arrow}</button>
    </th>`;
  }).join('');

  const body = rows.map((row, i) => {
    const team = getData().teamById.get(row.teamId);
    const cells = COLUMNS.map((col) => {
      const value = col.key === 'gpg' ? row.gpg.toFixed(2) : col.key === 'gd' ? fmtGd(row.gd) : row[col.key];
      return `<td class="col-num${col.key === sortKey ? ' sorted' : ''}">${value}</td>`;
    }).join('');
    return `
      <tr class="${row.played === 0 ? 'row-idle' : ''}">
        <td class="col-rank">${startIndex + i + 1}</td>
        <td class="col-team">
          <img class="flag" src="${flagSrc(team)}" alt="" width="22" height="15" loading="lazy">
          <span>${team.name}</span>
        </td>
        ${cells}
      </tr>`;
  }).join('');

  return `
    <div class="stats-table-wrap" role="region" aria-label="${t('stats.teamStatsTitle')}" tabindex="0">
      <table class="stats-table">
        <caption class="sr-only">${t('stats.teamStatsTitle')}</caption>
        <thead>
          <tr>
            <th scope="col" class="col-rank">#</th>
            <th scope="col" class="col-team">${t('standings.team')}</th>
            ${head}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function paginationHTML(pages) {
  if (pages <= 1) return '';
  const nums = Array.from({ length: pages }, (_, p) => `
    <button type="button" class="page-btn${p === teamPage ? ' active' : ''}" data-page="${p}"
            aria-current="${p === teamPage ? 'page' : 'false'}">${p + 1}</button>`).join('');
  return `
    <nav class="stats-pagination" aria-label="${t('stats.teamStatsTitle')}">
      <button type="button" class="page-btn page-arrow" data-page="${teamPage - 1}"
              ${teamPage === 0 ? 'disabled' : ''} aria-label="${t('stats.prevPage')}">‹</button>
      ${nums}
      <button type="button" class="page-btn page-arrow" data-page="${teamPage + 1}"
              ${teamPage >= pages - 1 ? 'disabled' : ''} aria-label="${t('stats.nextPage')}">›</button>
    </nav>`;
}

function onTeamTableClick(event) {
  const sortBtn = event.target.closest('.col-sort');
  if (sortBtn) {
    const key = sortBtn.dataset.sort;
    if (key === sortKey) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortKey = key; sortDir = 'desc'; }
    teamPage = 0;
    renderTeamTable();
    return;
  }
  const pageBtn = event.target.closest('.page-btn');
  if (pageBtn && !pageBtn.disabled) {
    teamPage = Number(pageBtn.dataset.page);
    renderTeamTable();
  }
}

function fmtGd(gd) {
  return gd > 0 ? `+${gd}` : String(gd);
}

// ------------------------------------------------------------- count-up

function fmt(value, decimals) {
  return decimals ? value.toFixed(decimals) : String(Math.round(value));
}

function setupCountUps(root) {
  const els = [...root.querySelectorAll('[data-countup]')];
  if (!els.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    for (const el of els) el.textContent = fmt(Number(el.dataset.countup), Number(el.dataset.decimals) || 0);
    return;
  }
  // animate each tile when it first scrolls into view — the panel is hidden
  // until the Stats tab is opened, so this fires on arrival, not at load.
  const io = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      animateCount(entry.target);
      obs.unobserve(entry.target);
    }
  }, { threshold: 0.4 });
  for (const el of els) io.observe(el);
}

function animateCount(el) {
  const target = Number(el.dataset.countup);
  const decimals = Number(el.dataset.decimals) || 0;
  const duration = 900;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = fmt(target * eased, decimals);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = fmt(target, decimals);
  };
  requestAnimationFrame(step);
}
