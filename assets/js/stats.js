// stats.js — "Stats" tab. Tournament-to-date aggregates derived ONLY from data
// the project already has (results.json scores/status + optional per-match
// stats, matches.json phase). Counts finished matches only, consistent with
// computeStandings (live/scheduled ignored). Built as the evolving foundation
// for the post-tournament stats screen (see .agents/stats-screen-plan.md):
// sections gate on data so player/award/editorial blocks slot in later.

import { getData, flagSrc, navigateTo } from './app.js';
import { getBracketTree } from './bracket.js';
import { getFavorites } from './storage.js';
import { openMatchModal } from './modal.js';
import { t, translatePhase } from './i18n.js';

// "Goals by stage" collapses all 12 groups into one bucket; knockout phases
// keep their own. Order used to render the chart left-to-right.
const STAGE_ORDER = ['Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Third Place', 'Final'];

// "Goals by round" is finer: the group stage is split into its 3 matchdays
// (derived per group), then each knockout round stands alone — a goals-over-time
// view distinct from goals-by-stage (which lumps all group games together).
const ROUND_ORDER = ['MD1', 'MD2', 'MD3', ...STAGE_ORDER];

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

// Sub-nav sections (graceful-degradation contract, stats-screen-plan.md §0.1): a
// section renders — and its sub-nav chip appears — only when `available(model)`
// holds. Otherwise it is omitted from the DOM entirely (no placeholder, no "—",
// no "coming soon") and the nav never points at emptiness. Later stages flip
// `available` and supply `body` for players/records/comparator/archive; the same
// code base thus renders a coherent, "full" screen with only today's data and
// lights up sections as each data layer arrives.
const SECTIONS = [
  { id: 'overview', navKey: 'stats.navOverview', available: () => true, body: overviewHTML },
  { id: 'teams', navKey: 'stats.navTeams', available: () => true, body: teamsSectionHTML },
  { id: 'players', navKey: 'stats.navPlayers', available: () => false, body: () => '' },
  { id: 'records', navKey: 'stats.navRecords', available: () => true, body: recordsSectionHTML },
  { id: 'comparator', navKey: 'stats.navComparator', available: (m) => m.finishedCount > 0, body: comparatorSectionHTML },
  { id: 'archive', navKey: 'stats.navArchive', available: () => false, body: () => '' },
];

// Metrics shown as diverging bars in the team comparator — all non-negative so
// the mirrored bars read cleanly (GD is excluded; it's GF/GA derived). Reuses
// the standings.* abbreviations the user already knows.
const CMP_METRICS = [
  { key: 'played', label: 'standings.played' },
  { key: 'won', label: 'standings.won' },
  { key: 'gf', label: 'standings.gf' },
  { key: 'ga', label: 'standings.ga' },
  { key: 'cleanSheets', label: 'stats.colCS' },
  { key: 'points', label: 'standings.pts' },
];

let model = null;
// table interaction state — survives langchange re-renders. Default on load is
// the canonical final ranking (page 1); like the bracket keeps its zoom.
let sortKey = 'rank';
let sortDir = 'asc';
let teamPage = 0;
// comparator selection (team ids) — survives langchange like the table state
let cmpA = null;
let cmpB = null;

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
  const byRound = new Map();
  const groupMatchday = computeGroupMatchdays(matches);

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
    // finer round bucket: group → its matchday, knockout → the stage itself
    const roundKey = m.phase.startsWith('Group ') ? `MD${groupMatchday.get(m.id)}` : stage;
    const rb = byRound.get(roundKey) ?? { goals: 0, count: 0 };
    rb.goals += total;
    rb.count += 1;
    byRound.set(roundKey, rb);
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

  const verdict = computeVerdict();
  assignRanks(teamStats);

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
    byRound,
    verdict,
    teamStats,
    leaders: computeLeaders(teamStats),
    records: computeRecords(finished, resultByMatchId, verdict),
  };
}

// Matchday (1–3) for every group match, derived per group: a 4-team group plays
// two games per matchday, so sorting a group's six fixtures by kickoff and
// chunking into pairs reproduces the official matchdays (no stored field).
function computeGroupMatchdays(matches) {
  const byGroup = new Map();
  for (const m of matches) {
    if (!m.phase.startsWith('Group ')) continue;
    if (!byGroup.has(m.phase)) byGroup.set(m.phase, []);
    byGroup.get(m.phase).push(m);
  }
  const matchday = new Map();
  for (const list of byGroup.values()) {
    list.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) || a.id - b.id);
    list.forEach((m, i) => matchday.set(m.id, Math.floor(i / 2) + 1));
  }
  return matchday;
}

// The tournament verdict — REAL results only. The bracket tree's champion can be
// a user simulation; gate on the FINAL node carrying a real finished result
// (decide() sets winner from real results first, so !simulated means it's real).
// Third/fourth come from the third-place match the same way; each is independent
// so the podium degrades gracefully if (somehow) only the final is in.
function computeVerdict() {
  const tree = getBracketTree();
  const finalNode = tree.nodesByRef.get('FINAL');
  if (!finalNode || finalNode.simulated || finalNode.result?.status !== 'finished' || !finalNode.winner) {
    return null;
  }
  const verdict = { champion: finalNode.winner, runnerUp: finalNode.loser };
  const third = tree.third;
  if (third && !third.simulated && third.result?.status === 'finished' && third.winner) {
    verdict.third = third.winner;
    verdict.fourth = third.loser;
  }
  return verdict;
}

// Canonical final ranking 1–48 (stats-screen-plan.md §6.5): primary key is the
// deepest stage REACHED (champion → runner-up → 3rd → 4th → QF → R16 → R32 →
// group), then points → GD → GF → id. Reproducible and stable; each team carries
// its rank, so the table can sort by any column yet still show this # identity.
const GROUP_TIER = 7;
function assignRanks(teamStats) {
  const tiers = computeRankTiers();
  const ranked = [...teamStats].sort((a, b) =>
    (tiers.get(a.teamId) ?? GROUP_TIER) - (tiers.get(b.teamId) ?? GROUP_TIER)
    || b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.teamId.localeCompare(b.teamId));
  ranked.forEach((row, i) => { row.rank = i + 1; });
}

// Phase-reached tier per team, from REAL knockout results only (a simulated pick
// never affects the ranking). Champion 0, runner-up 1, 3rd 2, 4th 3, then losers
// by round (QF 4, R16 5, R32 6). Absent → group tier (7) via the default above.
function computeRankTiers() {
  const tree = getBracketTree();
  const tier = new Map();
  const set = (id, value) => { if (id && !tier.has(id)) tier.set(id, value); };

  const finalNode = tree.nodesByRef.get('FINAL');
  if (finalNode && !finalNode.simulated && finalNode.result?.status === 'finished' && finalNode.winner) {
    set(finalNode.winner, 0);
    set(finalNode.loser, 1);
  }
  const third = tree.third;
  if (third && !third.simulated && third.result?.status === 'finished' && third.winner) {
    set(third.winner, 2);
    set(third.loser, 3);
  }
  const roundTier = { QF: 4, R16: 5, R32: 6 };
  for (const round of tree.rounds) {
    const value = roundTier[round.id];
    if (value === undefined) continue;
    for (const node of round.nodes) {
      if (!node.simulated && node.result?.status === 'finished' && node.loser) set(node.loser, value);
    }
  }
  return tier;
}

// Auto-derived team records over finished matches. Each is null when its data
// isn't there yet, so the cards degrade away individually (§0.1).
function computeRecords(finished, resultByMatchId, verdict) {
  let biggestWin = null;
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const margin = Math.abs(r.homeScore - r.awayScore);
    if (margin === 0) continue;
    const total = r.homeScore + r.awayScore;
    if (!biggestWin || margin > biggestWin.margin || (margin === biggestWin.margin && total > biggestWin.total)) {
      const homeWon = r.homeScore > r.awayScore;
      biggestWin = {
        matchId: m.id, margin, total,
        winnerId: homeWon ? m.homeTeam : m.awayTeam,
        loserId: homeWon ? m.awayTeam : m.homeTeam,
        score: homeWon ? `${r.homeScore}-${r.awayScore}` : `${r.awayScore}-${r.homeScore}`,
      };
    }
  }

  // longest run of consecutive wins by any team, in chronological order
  const order = [...finished].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`) || a.id - b.id);
  const current = new Map();
  let longestWinStreak = null;
  for (const m of order) {
    const r = resultByMatchId.get(m.id);
    const homeWin = r.homeScore > r.awayScore || (r.homeScore === r.awayScore && r.penalties && r.penalties.home > r.penalties.away);
    const awayWin = r.awayScore > r.homeScore || (r.homeScore === r.awayScore && r.penalties && r.penalties.away > r.penalties.home);
    for (const [teamId, won] of [[m.homeTeam, homeWin], [m.awayTeam, awayWin]]) {
      const run = won ? (current.get(teamId) ?? 0) + 1 : 0;
      current.set(teamId, run);
      if (won && (!longestWinStreak || run > longestWinStreak.count)) longestWinStreak = { teamId, count: run };
    }
  }

  // highest-scoring match (most combined goals; tie → bigger margin)
  let highestScoringMatch = null;
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const total = r.homeScore + r.awayScore;
    const margin = Math.abs(r.homeScore - r.awayScore);
    if (!highestScoringMatch || total > highestScoringMatch.total
        || (total === highestScoringMatch.total && margin > highestScoringMatch.margin)) {
      highestScoringMatch = { matchId: m.id, total, margin, homeTeam: m.homeTeam, awayTeam: m.awayTeam, score: `${r.homeScore}-${r.awayScore}` };
    }
  }

  return {
    biggestWin,
    highestScoringMatch,
    longestWinStreak: longestWinStreak && longestWinStreak.count >= 2 ? longestWinStreak : null,
    championPath: computeChampionPath(verdict),
  };
}

// The champion's knockout route (R32 → Final) with each result, for the path
// card. Null unless there's a real champion (verdict present).
function computeChampionPath(verdict) {
  if (!verdict) return null;
  const tree = getBracketTree();
  const champ = verdict.champion;
  const path = [];
  for (const round of tree.rounds) {
    const node = round.nodes.find((n) => n.winner === champ && (n.home.teamId === champ || n.away.teamId === champ));
    if (!node || !node.result) continue;
    const side = node.home.teamId === champ ? 'home' : 'away';
    const r = node.result;
    path.push({
      matchId: node.match?.id ?? null,
      phase: node.phase,
      opponentId: side === 'home' ? node.away.teamId : node.home.teamId,
      gf: side === 'home' ? r.homeScore : r.awayScore,
      ga: side === 'home' ? r.awayScore : r.homeScore,
      pens: r.penalties ? (side === 'home' ? `${r.penalties.home}-${r.penalties.away}` : `${r.penalties.away}-${r.penalties.home}`) : null,
    });
  }
  return path.length ? path : null;
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
  installImageFallback();
  render();
  // labels re-render on language change; the derived model never changes at
  // runtime (data is static per page load) so it is reused.
  document.addEventListener('langchange', render);
  // new published results change the aggregates → rebuild the memoized model
  document.addEventListener('datachange', () => { model = null; render(); });
  // favorites change elsewhere (schedule/groups/modal) → re-render the table so
  // the gold favorite-row highlight stays in sync (no model rebuild needed).
  document.addEventListener('favchange', renderTeamTable);
}

function render() {
  if (!model) model = buildStatsModel();
  const root = document.getElementById('stats-root');
  const sections = SECTIONS.filter((section) => section.available(model));
  root.innerHTML =
    heroHTML()
    + subNavHTML(sections)
    + sections.map((section) => `
      <section id="stats-${section.id}" class="stats-section" tabindex="-1" aria-label="${t(section.navKey)}">
        ${section.body(model)}
      </section>`).join('')
    + footerHTML();
  root.querySelector('#stats-see-matches')?.addEventListener('click', () => navigateTo('matches'));
  const teamsHost = root.querySelector('#stats-teams-table');
  if (teamsHost) {
    teamsHost.addEventListener('click', onTeamTableClick);
    renderTeamTable();
  }
  // record cards / champion-path rows that reference a match open it in the modal
  for (const el of root.querySelectorAll('[data-record-match]')) {
    const open = () => openMatchModal(Number(el.dataset.recordMatch));
    el.addEventListener('click', open);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  }
  // comparator selects → update the chosen side, re-render just the bars panel
  const cmpAEl = root.querySelector('#cmp-a');
  const cmpBEl = root.querySelector('#cmp-b');
  if (cmpAEl && cmpBEl) {
    cmpAEl.addEventListener('change', () => { cmpA = cmpAEl.value; refreshComparator(); });
    cmpBEl.addEventListener('change', () => { cmpB = cmpBEl.value; refreshComparator(); });
  }
  setupCountUps(root);
  setupSubNav(root, sections);
}

// ----------------------------------------------------------- sub-nav

function subNavHTML(sections) {
  if (sections.length < 2) return ''; // a lone section needs no navigation
  const chips = sections.map((section, i) => `
    <a class="stats-subnav-chip${i === 0 ? ' active' : ''}" href="#stats-${section.id}"
       data-section="${section.id}" aria-current="${i === 0 ? 'true' : 'false'}">${t(section.navKey)}</a>`).join('');
  return `<nav class="stats-subnav" aria-label="${t('stats.sectionsNav')}">${chips}</nav>`;
}

let spyScrollHandler = null;
function setupSubNav(root, sections) {
  const nav = root.querySelector('.stats-subnav');
  if (!nav) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // chip → smooth-scroll to the section WITHOUT touching location.hash: the tab
  // router (app.js) listens on hashchange, so a real #fragment would route to
  // an unknown tab and bounce the user to Home. preventDefault keeps us in-tab.
  nav.addEventListener('click', (event) => {
    const chip = event.target.closest('.stats-subnav-chip');
    if (!chip) return;
    event.preventDefault();
    document.getElementById(`stats-${chip.dataset.section}`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActiveChip(nav, chip.dataset.section);
  });

  // scrollspy: active = the last section whose heading has scrolled under the
  // sticky sub-nav line; at the page bottom the last section always wins (a short
  // final section may never reach the line — the classic scrollspy edge case an
  // IntersectionObserver band leaves unlit). Reading getBoundingClientRect on a
  // handful of sections per frame is cheap and always correct on short pages.
  const ids = sections.map((section) => section.id);
  const updateSpy = () => {
    const headerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
    const line = headerH + 80; // just beneath the sticky sub-nav
    let activeId = ids[0];
    for (const id of ids) {
      if (document.getElementById(`stats-${id}`)?.getBoundingClientRect().top <= line) activeId = id;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      activeId = ids[ids.length - 1]; // bottom reached → last section
    }
    setActiveChip(nav, activeId);
  };

  if (spyScrollHandler) window.removeEventListener('scroll', spyScrollHandler);
  let raf = 0;
  spyScrollHandler = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; updateSpy(); });
  };
  window.addEventListener('scroll', spyScrollHandler, { passive: true });
  updateSpy();
}

function setActiveChip(nav, id) {
  for (const chip of nav.querySelectorAll('.stats-subnav-chip')) {
    const on = chip.dataset.section === id;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-current', on ? 'true' : 'false');
  }
  // keep the active chip visible when the nav scrolls horizontally on mobile
  // (only moves the nav's own scroll, never the page).
  const active = nav.querySelector('.stats-subnav-chip.active');
  if (active) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
}

// ----------------------------------------------------------- flags

// Flag <img> that degrades to a 3-letter monogram if the SVG is missing — never
// a broken-image icon (graceful degradation §0.3). Used everywhere the stats
// screen shows a flag so the fallback is uniform.
function flagImg(team, w, h, cls = 'flag') {
  return `<img class="${cls}" src="${flagSrc(team)}" alt="" width="${w}" height="${h}" loading="lazy" data-monogram="${team.id}">`;
}

let fallbackInstalled = false;
function installImageFallback() {
  if (fallbackInstalled) return;
  fallbackInstalled = true;
  // error events don't bubble → listen in the capture phase. Only opted-in
  // images (data-monogram) are touched, so other views are unaffected.
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.monogram) return;
    const span = document.createElement('span');
    span.className = 'flag-fallback';
    span.style.width = `${img.getAttribute('width')}px`;
    span.style.height = `${img.getAttribute('height')}px`;
    span.textContent = img.dataset.monogram;
    img.replaceWith(span);
  }, true);
}

// The hero becomes the tournament's verdict (champion + podium) once the FINAL
// has a real result; until then it falls back to the live "in progress"
// aggregate hero, so the screen stays correct even if merged before the Cup ends.
function heroHTML() {
  return model.verdict ? verdictHeroHTML() : aggregateHeroHTML();
}

function aggregateHeroHTML() {
  const m = model;
  const progress = t('stats.heroProgress')
    .replace('{x}', String(m.finishedCount))
    .replace('{y}', String(m.totalMatches));
  return `
    <section class="stats-hero glass slide-up">
      <p class="hero-label">${t('stats.heroTitle')}<span class="hero-phase">${progress}</span></p>
      <div class="stats-hero-tiles">${heroTilesHTML()}</div>
    </section>`;
}

function verdictHeroHTML() {
  const v = model.verdict;
  const team = (id) => getData().teamById.get(id);
  const champion = team(v.champion);
  const places = [
    { label: t('stats.runnerUp'), rank: '2', id: v.runnerUp },
    v.third ? { label: t('stats.thirdPlace'), rank: '3', id: v.third } : null,
    v.fourth ? { label: t('stats.fourthPlace'), rank: '4', id: v.fourth } : null,
  ].filter(Boolean);
  return `
    <section class="stats-hero stats-verdict glass slide-up">
      <p class="hero-label">${t('stats.verdictTitle')}</p>
      <div class="verdict-champion">
        <span class="verdict-trophy" aria-hidden="true">🏆</span>
        ${flagImg(champion, 92, 61, 'flag verdict-flag')}
        <span class="verdict-name">${champion.name}</span>
        <span class="verdict-crown">${t('bracket.champion')}</span>
      </div>
      <div class="verdict-podium">
        ${places.map((p) => `
          <div class="verdict-place">
            <span class="verdict-rank" aria-hidden="true">${p.rank}</span>
            ${flagImg(team(p.id), 36, 24)}
            <span class="verdict-place-name">${team(p.id).name}</span>
            <span class="verdict-place-label">${p.label}</span>
          </div>`).join('')}
      </div>
      <div class="stats-hero-tiles">${heroTilesHTML()}</div>
    </section>`;
}

function heroTilesHTML() {
  const m = model;
  const tiles = [
    { value: m.totalGoals, decimals: 0, label: t('stats.tileGoals') },
    { value: Number(m.avgGoals.toFixed(2)), decimals: 2, label: t('stats.tileAvg') },
    { value: m.biggestMargin, decimals: 0, label: t('stats.tileBiggestMargin') },
    { value: m.cleanSheets, decimals: 0, label: t('stats.tileCleanSheets') },
  ];
  return tiles.map((tile) => `
    <div class="stats-tile">
      <span class="stats-tile-value" data-countup="${tile.value}" data-decimals="${tile.decimals}">${tile.decimals ? '0.00' : '0'}</span>
      <span class="stats-tile-label">${tile.label}</span>
    </div>`).join('');
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
    ${goalsByStageHTML()}
    ${goalsByRoundHTML()}`;
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

// Finer companion to goals-by-stage: group matchdays + each knockout round.
// Hidden until ≥2 rounds have data, so it never shows a lone bar that just
// duplicates the goals-by-stage "Group" bar early in the tournament.
function goalsByRoundHTML() {
  const order = ROUND_ORDER.filter((round) => model.byRound.has(round));
  if (order.length < 2) return '';
  const max = Math.max(...order.map((round) => model.byRound.get(round).goals));
  const rows = order.map((round) => {
    const bucket = model.byRound.get(round);
    const pct = max ? Math.round((bucket.goals / max) * 100) : 0;
    const label = round.startsWith('MD') ? `${t('stats.matchday')} ${round.slice(2)}` : translatePhase(round);
    return `
      <div class="chart-row">
        <span class="chart-bar-label">${label}</span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%"></div></div>
        <span class="chart-bar-val">${bucket.goals}</span>
      </div>`;
  }).join('');
  return `
    <h2 class="section-title">${t('stats.goalsByRound')}</h2>
    <div class="stats-chart glass">${rows}</div>`;
}

// ----------------------------------------------------- team statistics

function teamsSectionHTML() {
  return `
    <h2 class="section-title">${t('stats.teamStatsTitle')}</h2>
    ${leadersHTML()}
    ${teamRecordsHTML()}
    <div id="stats-teams-table" class="stats-teams-table"></div>
    ${legendHTML(COLUMNS)}`;
}

// Team-level cards in the Teams section: longest win streak + the champion's
// path (post-final). Match-level records live in the Records section. Each
// degrades away individually when its data is null.
function teamRecordsHTML() {
  const rec = model.records;
  const cards = [];
  if (rec.longestWinStreak) cards.push(streakCardHTML(rec.longestWinStreak));
  const grid = cards.length ? `<div class="stats-records-grid">${cards.join('')}</div>` : '';
  return grid + (rec.championPath ? championPathHTML(rec.championPath) : '');
}

function biggestWinCardHTML(win) {
  const winner = getData().teamById.get(win.winnerId);
  const loser = getData().teamById.get(win.loserId);
  return `
    <button type="button" class="record-card glass" data-record-match="${win.matchId}"
            aria-label="${t('stats.biggestWin')}: ${winner.name} ${win.score} ${loser.name}">
      <span class="record-label">${t('stats.biggestWin')}</span>
      <span class="record-main">
        ${flagImg(winner, 26, 17)}
        <span class="record-score">${win.score}</span>
        ${flagImg(loser, 26, 17)}
      </span>
      <span class="record-teams">${winner.name} <span class="record-vs">${t('hero.vs')}</span> ${loser.name}</span>
    </button>`;
}

function streakCardHTML(streak) {
  const team = getData().teamById.get(streak.teamId);
  return `
    <div class="record-card glass">
      <span class="record-label">${t('stats.winStreak')}</span>
      <span class="record-main">
        ${flagImg(team, 26, 17)}
        <span class="record-score">${streak.count}</span>
      </span>
      <span class="record-teams">${team.name}</span>
    </div>`;
}

function championPathHTML(path) {
  const rows = path.map((step) => {
    const opp = getData().teamById.get(step.opponentId);
    const pens = step.pens ? ` <small>(${t('status.pens')} ${step.pens})</small>` : '';
    const clickable = step.matchId != null;
    const attrs = clickable
      ? `data-record-match="${step.matchId}" role="button" tabindex="0" aria-label="${translatePhase(step.phase)}: ${step.gf}–${step.ga} ${opp.name}"`
      : '';
    return `
      <div class="champ-path-row${clickable ? ' clickable' : ''}" ${attrs}>
        <span class="champ-path-phase">${translatePhase(step.phase)}</span>
        <span class="champ-path-score">${step.gf}–${step.ga}${pens}</span>
        <span class="champ-path-opp">${flagImg(opp, 20, 13)} ${opp.name}</span>
      </div>`;
  }).join('');
  return `
    <div class="champ-path glass">
      <span class="record-label">${t('stats.championPath')}</span>
      ${rows}
    </div>`;
}

// ----------------------------------------------------- records section

// Match/tournament records + the "format-48 debuts" band. Match record cards
// degrade away individually; the debuts band is always meaningful (format facts),
// so this section (and its sub-nav chip) is always present.
function recordsSectionHTML() {
  const rec = model.records;
  const cards = [];
  if (rec.biggestWin) cards.push(biggestWinCardHTML(rec.biggestWin));
  // skip the high-score card when it's the very same match as the biggest win
  // (early in the tournament they often coincide); they diverge as it goes on.
  if (rec.highestScoringMatch && rec.highestScoringMatch.matchId !== rec.biggestWin?.matchId) {
    cards.push(highScoreCardHTML(rec.highestScoringMatch));
  }
  const grid = cards.length ? `<div class="stats-records-grid">${cards.join('')}</div>` : '';
  return `
    <h2 class="section-title">${t('stats.recordsTitle')}</h2>
    ${grid}
    ${formatDebutsHTML()}`;
}

function highScoreCardHTML(rec) {
  const home = getData().teamById.get(rec.homeTeam);
  const away = getData().teamById.get(rec.awayTeam);
  return `
    <button type="button" class="record-card glass" data-record-match="${rec.matchId}"
            aria-label="${t('stats.highScoreMatch')}: ${home.name} ${rec.score} ${away.name}">
      <span class="record-label">${t('stats.highScoreMatch')}</span>
      <span class="record-main">
        ${flagImg(home, 26, 17)}
        <span class="record-score">${rec.score}</span>
        ${flagImg(away, 26, 17)}
      </span>
      <span class="record-teams">${home.name} <span class="record-vs">${t('hero.vs')}</span> ${away.name}</span>
    </button>`;
}

// "Format debuts" band — the firsts of the 48-team era. Mostly static format
// facts (always true); the champion fact lights up once the verdict is in.
function formatDebutsHTML() {
  const data = getData();
  const facts = [
    { value: String(data.teams.length), label: t('stats.debutTeams') },
    { value: String(model.totalMatches), label: t('stats.debutMatches') },
    { value: String(Object.keys(data.groups).length), label: t('stats.debutGroups') },
    { value: translatePhase('Round of 32'), label: t('stats.debutR32'), small: true },
    { value: '8', label: t('stats.debutThird') },
  ];
  if (model.verdict) {
    facts.push({ value: data.teamById.get(model.verdict.champion).name, label: t('stats.debutChampion'), small: true });
  }
  return `
    <h3 class="stats-subhead">${t('stats.formatDebutsTitle')}</h3>
    <div class="debut-band glass">
      ${facts.map((f) => `
        <div class="debut-fact">
          <span class="debut-value${f.small ? ' debut-value-sm' : ''}">${f.value}</span>
          <span class="debut-label">${f.label}</span>
        </div>`).join('')}
    </div>`;
}

// --------------------------------------------------- comparator section

// Default the two sides to the top-2 ranked teams; the choice then survives
// langchange (module-level cmpA/cmpB), like the table sort.
function ensureComparatorDefaults() {
  if (cmpA && cmpB) return;
  const byRank = [...model.teamStats].sort((a, b) => a.rank - b.rank);
  cmpA = cmpA ?? byRank[0]?.teamId;
  cmpB = cmpB ?? byRank[1]?.teamId;
}

function comparatorSectionHTML() {
  ensureComparatorDefaults();
  const teams = [...getData().teams].sort((a, b) => a.name.localeCompare(b.name));
  const options = (selected) => teams
    .map((team) => `<option value="${team.id}"${team.id === selected ? ' selected' : ''}>${team.name}</option>`).join('');
  return `
    <h2 class="section-title">${t('stats.comparatorTitle')}</h2>
    <div class="cmp-controls">
      <select class="filter-control cmp-select" id="cmp-a" aria-label="${t('stats.cmpTeamA')}">${options(cmpA)}</select>
      <span class="cmp-vs">${t('hero.vs')}</span>
      <select class="filter-control cmp-select" id="cmp-b" aria-label="${t('stats.cmpTeamB')}">${options(cmpB)}</select>
    </div>
    <div class="cmp-panel glass" id="cmp-panel">${comparatorBarsHTML()}</div>`;
}

// Diverging mirrored bars: A grows leftward from the center label, B rightward.
// Each row scales to max(a,b) so the longer bar is the higher value.
function comparatorBarsHTML() {
  const byId = new Map(model.teamStats.map((row) => [row.teamId, row]));
  const a = byId.get(cmpA);
  const b = byId.get(cmpB);
  const teamA = getData().teamById.get(cmpA);
  const teamB = getData().teamById.get(cmpB);
  const header = `
    <div class="cmp-head">
      <div class="cmp-team">${flagImg(teamA, 28, 19)} <span>${teamA.name}</span></div>
      <div class="cmp-team cmp-team-b"><span>${teamB.name}</span> ${flagImg(teamB, 28, 19)}</div>
    </div>`;
  const rows = CMP_METRICS.map((metric) => {
    const av = a[metric.key];
    const bv = b[metric.key];
    const max = Math.max(av, bv, 1);
    return `
      <div class="cmp-row">
        <span class="cmp-val a${av >= bv ? ' lead' : ''}">${av}</span>
        <div class="cmp-track a"><div class="cmp-bar a" style="width:${Math.round((av / max) * 100)}%"></div></div>
        <span class="cmp-label">${t(metric.label)}</span>
        <div class="cmp-track b"><div class="cmp-bar b" style="width:${Math.round((bv / max) * 100)}%"></div></div>
        <span class="cmp-val b${bv >= av ? ' lead' : ''}">${bv}</span>
      </div>`;
  }).join('');
  return header + rows;
}

// Re-render only the bars panel on a selection change (keeps the selects'
// focus/scroll and replays the grow animation on the new bars).
function refreshComparator() {
  const panel = document.getElementById('cmp-panel');
  if (panel) panel.innerHTML = comparatorBarsHTML();
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
        ${flagImg(team, 30, 20)}
        <span class="leader-name">${team.name}</span>
      </div>
      <span class="leader-value">${value}</span>
    </div>`;
}

function sortedTeamStats() {
  const dir = sortDir === 'asc' ? 1 : -1;
  if (sortKey === 'rank') {
    return [...model.teamStats].sort((a, b) => (a.rank - b.rank) * dir);
  }
  return [...model.teamStats].sort((a, b) => {
    const primary = (a[sortKey] - b[sortKey]) * dir;
    if (primary) return primary;
    return a.rank - b.rank; // canonical rank is the stable tiebreak
  });
}

function renderTeamTable() {
  const host = document.getElementById('stats-teams-table');
  if (!host) return;
  const sorted = sortedTeamStats();
  const pages = Math.ceil(sorted.length / PAGE_SIZE);
  teamPage = Math.max(0, Math.min(teamPage, pages - 1));
  const start = teamPage * PAGE_SIZE;
  host.innerHTML = tableHTML(sorted.slice(start, start + PAGE_SIZE)) + paginationHTML(pages);
}

// One sortable header cell; `aria` falls back to the visible label.
function sortHeaderHTML(key, label, tip, cls, aria = label) {
  const active = key === sortKey;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const arrow = active ? `<span class="sort-arrow" aria-hidden="true">${sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
  return `<th scope="col" class="${cls}${active ? ' sorted' : ''}" aria-sort="${ariaSort}">
    <button type="button" class="col-sort has-tip" data-sort="${key}" data-tip="${tip}" aria-label="${aria} — ${tip}">${label}${arrow}</button>
  </th>`;
}

function tableHTML(rows) {
  const rankHead = sortHeaderHTML('rank', '#', t('tip.rank'), 'col-rank', t('stats.rankCol'));
  const head = COLUMNS.map((col) => sortHeaderHTML(col.key, t(col.label), t(col.tip), 'col-num')).join('');
  const favs = new Set(getFavorites());

  const body = rows.map((row) => {
    const team = getData().teamById.get(row.teamId);
    const cells = COLUMNS.map((col) => {
      const value = col.key === 'gpg' ? row.gpg.toFixed(2) : col.key === 'gd' ? fmtGd(row.gd) : row[col.key];
      return `<td class="col-num${col.key === sortKey ? ' sorted' : ''}">${value}</td>`;
    }).join('');
    const classes = [row.played === 0 ? 'row-idle' : '', favs.has(row.teamId) ? 'row-fav' : ''].filter(Boolean).join(' ');
    return `
      <tr class="${classes}">
        <td class="col-rank${sortKey === 'rank' ? ' sorted' : ''}">${row.rank}</td>
        <td class="col-team">
          ${flagImg(team, 22, 15)}
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
            ${rankHead}
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
    else { sortKey = key; sortDir = key === 'rank' ? 'asc' : 'desc'; }
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
