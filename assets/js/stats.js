// stats.js — "Stats" tab. Tournament-to-date aggregates derived ONLY from data
// the project already has (results.json scores/status + optional per-match
// stats, matches.json phase). Counts finished matches only, consistent with
// computeStandings (live/scheduled ignored). Built as the evolving foundation
// for the post-tournament stats screen (see .agents/stats-screen-plan.md):
// sections gate on data so player/award/editorial blocks slot in later.

import { getData, flagSrc, navigateTo, cardCounts } from './app.js';
import { getBracketTree, resolveBracketTeams } from './bracket.js';
import { getFavorites } from './storage.js';
import { openMatchModal } from './modal.js';
import { t, getLang, getLocale, translatePhase } from './i18n.js';

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
  { id: 'players', navKey: 'stats.navPlayers', available: (m) => Boolean(m.players), body: playersSectionHTML },
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
// comparator mode + player selections (Stage H); players chip choice too
let cmpMode = 'teams';
let cmpPA = null;
let cmpPB = null;
let playersChip = 'scorers';

function stageOf(phase) {
  return phase.startsWith('Group ') ? 'Group' : phase;
}

// Participant ids of any match. Group matches carry `homeTeam`/`awayTeam`;
// knockout matches (ids 73–104) carry only `bracketRef` and must be resolved
// through the bracket — reading `m.homeTeam` raw there yields undefined (same
// class of bug as the 2026-06-28 hero fix). Either id is null when the slot
// isn't resolved yet; callers skip those matches.
function teamIdsOf(match) {
  if (match.homeTeam) return { homeId: match.homeTeam, awayId: match.awayTeam };
  const slots = resolveBracketTeams(match);
  return { homeId: slots.home.team?.id ?? null, awayId: slots.away.team?.id ?? null };
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
        cleanSheets: 0, possSum: 0, possCount: 0, shots: 0,
        cardsY: 0, cardsR: 0, cardsTotal: 0,
      });
    }
    return rows.get(id);
  };
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    const home = row(homeId);
    const away = row(awayId);
    applySide(home, r.homeScore, r.awayScore);
    applySide(away, r.awayScore, r.homeScore);
    if (r.stats) {
      const s = r.stats;
      if (s.possession) {
        home.possSum += s.possession.home; home.possCount += 1;
        away.possSum += s.possession.away; away.possCount += 1;
      }
      if (s.shots) { home.shots += s.shots.home; away.shots += s.shots.away; }
      if (s.cards) {
        for (const [side, teamRow] of [['home', home], ['away', away]]) {
          const c = cardCounts(s.cards[side]);
          if (!c) continue;
          teamRow.cardsY += c.y;
          teamRow.cardsR += c.r;
          teamRow.cardsTotal += c.total;
        }
      }
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
      cardsY: a?.cardsY ?? 0,
      cardsR: a?.cardsR ?? 0,
      cardsTotal: a?.cardsTotal ?? 0,
    };
  });

  const verdict = computeVerdict();
  assignRanks(teamStats);
  const attendance = computeAttendance(finished, resultByMatchId);
  const discipline = computeDiscipline(finished, resultByMatchId);
  const players = computePlayers(finished, resultByMatchId, discipline);
  const avgGoals = finished.length ? totalGoals / finished.length : 0;

  return {
    totalMatches: matches.length,
    finishedCount: finished.length,
    totalGoals,
    avgGoals,
    draws,
    decisive,
    biggestMargin,
    cleanSheets,
    byStage,
    byRound,
    verdict,
    teamStats,
    attendance,
    discipline,
    players,
    confederations: computeConfederations(teamStats),
    leaders: computeLeaders(teamStats, Boolean(discipline)),
    records: computeRecords(finished, resultByMatchId, verdict),
    curiosities: computeCuriosities(),
    vsHistory: computeVsHistory({
      finishedCount: finished.length, totalGoals, avgGoals, biggestMargin,
      attendance, discipline, players,
    }),
  };
}

// Editorial curiosity cards (Layer 4, Stage I). A card renders only when it has
// a title AND a body in at least one language; the render side falls back to
// the other language rather than showing a blank (plan §6.7). Sorted by the
// hand-set priority.
function computeCuriosities() {
  const list = (getData().curiosities ?? [])
    .filter((c) => (c.titleEN || c.titlePT) && (c.bodyEN || c.bodyPT));
  return list.length ? [...list].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99)) : null;
}

// "This Cup vs history" rows (Layer 4). Each row needs BOTH sides: a baseline
// entry in all-time-baselines.json and this Cup's value from an available model
// block — rows whose source degraded away (no attendance, no players…) are
// simply absent. All metrics read "higher beats the record".
function computeVsHistory({ finishedCount, totalGoals, avgGoals, biggestMargin, attendance, discipline, players }) {
  const base = getData().allTimeBaselines;
  if (!base || !Object.keys(base).length || !finishedCount) return null;
  const rows = [];
  const push = (key, labelKey, current, fmt = 'int') => {
    const b = base[key];
    if (!b || !Number.isFinite(b.value) || current == null) return;
    rows.push({ labelKey, current, record: b.value, holder: b.holder ?? '', beaten: current > b.value, fmt });
  };
  push('totalGoals', 'stats.tileGoals', totalGoals);
  push('avgGoals', 'stats.tileAvg', avgGoals, 'dec');
  push('topScorerGoals', 'stats.topScorerRow', players?.podium[0]?.goals ?? null);
  push('totalAttendance', 'stats.totalAttendance', attendance?.total ?? null, 'num');
  push('avgAttendance', 'stats.avgAttendance', attendance ? Math.round(attendance.avg) : null, 'num');
  push('biggestWinMargin', 'stats.tileBiggestMargin', biggestMargin || null);
  push('mostCardsMatch', 'stats.mostCardsMatch', discipline?.mostCards?.total ?? null);
  push('redCards', 'stats.cardsRed', discipline?.r ?? null);
  return rows.length ? rows : null;
}

// Attendance aggregates (Layer 2). Authoritative only with FULL coverage —
// every finished match carries `attendance` (§0.1: partial sums would silently
// understate the totals). Null → the tiles and the crowd record degrade away.
function computeAttendance(finished, resultByMatchId) {
  if (!finished.length) return null;
  let total = 0;
  let biggest = null;
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    if (!Number.isFinite(r.attendance)) return null;
    total += r.attendance;
    if (!biggest || r.attendance > biggest.attendance) {
      biggest = { matchId: m.id, attendance: r.attendance, stadium: m.stadium };
    }
  }
  return { total, avg: total / finished.length, biggest };
}

// Discipline aggregates (Layer 2). Requires the {y,r} card split on EVERY
// finished match — a legacy numeric value can't attribute reds, so a mixed data
// set is not authoritative and the whole block degrades away.
function computeDiscipline(finished, resultByMatchId) {
  if (!finished.length) return null;
  let y = 0;
  let r = 0;
  let mostCards = null;
  for (const m of finished) {
    const cards = resultByMatchId.get(m.id)?.stats?.cards;
    const home = cardCounts(cards?.home);
    const away = cardCounts(cards?.away);
    if (!home?.split || !away?.split) return null;
    y += home.y + away.y;
    r += home.r + away.r;
    const total = home.total + away.total;
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    if (!mostCards || total > mostCards.total) {
      mostCards = { matchId: m.id, total, y: home.y + away.y, r: home.r + away.r, homeTeam: homeId, awayTeam: awayId };
    }
  }
  return { y, r, mostCards };
}

// Players model (Layer 3, Stage H). The whole section is authoritative-or-absent
// (§0.1): it renders only when the goal-event log REPRODUCES every finished
// match's score exactly, per side — a partial log would silently understate the
// scoring charts. Individual chips gate further: cards need the event log to
// match the discipline totals; saves need keeper-stats rows.
function computePlayers(finished, resultByMatchId, discipline) {
  const { players, playerEvents, awards, keeperStats } = getData();
  if (!players?.length || !playerEvents?.length || !finished.length) return null;
  const playerById = new Map(players.map((p) => [p.id, p]));
  const finishedIds = new Set(finished.map((m) => m.id));

  // ---- coverage gate: per-side goal counts from events must equal the scores
  const goalCount = new Map();
  for (const e of playerEvents) {
    if (!playerById.has(e.player) || !finishedIds.has(e.matchId)) return null;
    if (e.type !== 'goal') continue;
    const perTeam = goalCount.get(e.matchId) ?? new Map();
    perTeam.set(e.team, (perTeam.get(e.team) ?? 0) + 1);
    goalCount.set(e.matchId, perTeam);
  }
  for (const m of finished) {
    const r = resultByMatchId.get(m.id);
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) return null;
    const perTeam = goalCount.get(m.id);
    if ((perTeam?.get(homeId) ?? 0) !== r.homeScore || (perTeam?.get(awayId) ?? 0) !== r.awayScore) return null;
  }

  // ---- per-player aggregation + goal-time records in one pass
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      const p = playerById.get(id);
      rows.set(id, { ...p, goals: 0, assists: 0, y: 0, r: 0, saves: 0, cleanSheets: 0 });
    }
    return rows.get(id);
  };
  let cardsY = 0;
  let cardsR = 0;
  let fastest = null;
  let latest = null;
  let youngest = null;
  const matchDate = new Map(getData().matches.map((m) => [m.id, m.date]));
  for (const e of playerEvents) {
    if (e.type === 'goal') {
      row(e.player).goals += 1;
      if (e.assist && playerById.has(e.assist)) row(e.assist).assists += 1;
      if (!fastest || e.minute < fastest.minute) fastest = e;
      if (!latest || e.minute > latest.minute) latest = e;
      const birth = playerById.get(e.player).birthDate;
      if (birth && (!youngest || birth > playerById.get(youngest.player).birthDate)) youngest = e;
    } else if (e.type === 'card') {
      const target = row(e.player);
      if (e.card === 'red') { target.r += 1; cardsR += 1; }
      else { target.y += 1; cardsY += 1; }
    }
  }
  for (const k of keeperStats ?? []) {
    if (!playerById.has(k.player)) continue;
    const target = row(k.player);
    target.saves = k.saves ?? 0;
    target.cleanSheets = k.cleanSheets ?? 0;
  }

  const list = [...rows.values()];
  const scorers = list.filter((p) => p.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name));

  // ---- awards: each entry is valid only if its player resolves; squad needs all 11
  const award = (id) => (id && playerById.has(id) ? playerById.get(id) : null);
  const awardList = [
    { key: 'goldenBall', labelKey: 'stats.goldenBall', player: award(awards?.goldenBall) },
    { key: 'goldenBoot', labelKey: 'stats.goldenBoot', player: award(awards?.goldenBoot) },
    { key: 'goldenGlove', labelKey: 'stats.goldenGlove', player: award(awards?.goldenGlove) },
    { key: 'bestYoung', labelKey: 'stats.bestYoung', player: award(awards?.bestYoung) },
  ].filter((a) => a.player);
  const goalOfTournament = awards?.goalOfTournament && playerById.has(awards.goalOfTournament.player)
    ? awards.goalOfTournament : null;
  const squadIds = awards?.squadOfTournament ?? [];
  const squad = squadIds.length === 11 && squadIds.every((id) => playerById.has(id))
    ? squadIds.map((id) => playerById.get(id)) : null;

  return {
    scorers,
    assisters: list.filter((p) => p.assists > 0)
      .sort((a, b) => b.assists - a.assists || b.goals - a.goals || a.name.localeCompare(b.name)),
    carded: list.filter((p) => p.y + p.r > 0)
      .sort((a, b) => (b.y + b.r) - (a.y + a.r) || b.r - a.r || a.name.localeCompare(b.name)),
    keepers: list.filter((p) => p.saves > 0 || p.cleanSheets > 0)
      .sort((a, b) => b.saves - a.saves || b.cleanSheets - a.cleanSheets || a.name.localeCompare(b.name)),
    podium: scorers.slice(0, 3),
    cardsOk: Boolean(discipline) && cardsY === discipline.y && cardsR === discipline.r,
    savesOk: (keeperStats ?? []).length > 0,
    awards: awardList.length || goalOfTournament ? { list: awardList, goalOfTournament } : null,
    squad,
    fastestGoal: fastest,
    latestGoal: latest,
    youngestScorer: youngest ? { event: youngest, ageYears: ageAt(playerById.get(youngest.player).birthDate, matchDate.get(youngest.matchId)) } : null,
    byId: playerById,
    aggById: rows,
  };
}

function ageAt(birthDate, onDate) {
  if (!birthDate || !onDate) return null;
  const b = new Date(birthDate);
  const d = new Date(onDate);
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age -= 1;
  return age;
}

// Per-confederation performance (Layer 2) — requires `confederation` on all 48
// teams. Ranked by points per game so a 6-team confederation isn't dwarfed by
// UEFA's sheer match count.
function computeConfederations(teamStats) {
  const { teams, teamById } = getData();
  if (!teams.every((team) => team.confederation)) return null;
  const rows = new Map();
  for (const row of teamStats) {
    const conf = teamById.get(row.teamId).confederation;
    const bucket = rows.get(conf) ?? { conf, teams: 0, played: 0, won: 0, points: 0 };
    bucket.teams += 1;
    bucket.played += row.played;
    bucket.won += row.won;
    bucket.points += row.points;
    rows.set(conf, bucket);
  }
  const list = [...rows.values()].filter((row) => row.played > 0);
  if (!list.length) return null;
  for (const row of list) row.ppg = row.points / row.played;
  return list.sort((a, b) => b.ppg - a.ppg || b.points - a.points);
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
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    const total = r.homeScore + r.awayScore;
    if (!biggestWin || margin > biggestWin.margin || (margin === biggestWin.margin && total > biggestWin.total)) {
      const homeWon = r.homeScore > r.awayScore;
      biggestWin = {
        matchId: m.id, margin, total,
        winnerId: homeWon ? homeId : awayId,
        loserId: homeWon ? awayId : homeId,
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
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    for (const [teamId, won] of [[homeId, homeWin], [awayId, awayWin]]) {
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
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    if (!highestScoringMatch || total > highestScoringMatch.total
        || (total === highestScoringMatch.total && margin > highestScoringMatch.margin)) {
      highestScoringMatch = { matchId: m.id, total, margin, homeTeam: homeId, awayTeam: awayId, score: `${r.homeScore}-${r.awayScore}` };
    }
  }

  return {
    biggestWin,
    highestScoringMatch,
    longestWinStreak: longestWinStreak && longestWinStreak.count >= 2 ? longestWinStreak : null,
    championPath: computeChampionPath(verdict),
    biggestUpset: computeBiggestUpset(order),
    longestRoad: computeLongestRoad(order),
  };
}

// Biggest upset (Layer 2) — the win with the largest FIFA-ranking gap in the
// winner's disfavor. Needs `ranking` on all 48 teams; pen-shootout winners
// count (advancing IS the upset). `order` is the chronological finished list.
function computeBiggestUpset(order) {
  const { teams, teamById, resultByMatchId } = getData();
  if (!teams.every((team) => Number.isFinite(team.ranking))) return null;
  let upset = null;
  for (const m of order) {
    const r = resultByMatchId.get(m.id);
    const { homeId, awayId } = teamIdsOf(m);
    if (!homeId || !awayId) continue;
    let winnerId = null;
    if (r.homeScore !== r.awayScore) winnerId = r.homeScore > r.awayScore ? homeId : awayId;
    else if (r.penalties) winnerId = r.penalties.home > r.penalties.away ? homeId : awayId;
    if (!winnerId) continue;
    const loserId = winnerId === homeId ? awayId : homeId;
    const gap = teamById.get(winnerId).ranking - teamById.get(loserId).ranking;
    if (gap <= 0) continue;
    if (!upset || gap > upset.gap) {
      upset = {
        matchId: m.id, gap, winnerId, loserId,
        winnerRank: teamById.get(winnerId).ranking,
        loserRank: teamById.get(loserId).ranking,
        score: winnerId === homeId ? `${r.homeScore}-${r.awayScore}` : `${r.awayScore}-${r.homeScore}`,
        pens: r.penalties ? (winnerId === homeId ? `${r.penalties.home}-${r.penalties.away}` : `${r.penalties.away}-${r.penalties.home}`) : null,
      };
    }
  }
  return upset;
}

// Longest road (Layer 2) — the team that covered the most km hopping between
// its venues, great-circle legs over the chronological finished fixtures.
// Needs lat/lng on all 16 stadiums.
function computeLongestRoad(order) {
  const { stadiums, stadiumByName } = getData();
  if (!stadiums.every((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))) return null;
  const route = new Map(); // teamId → { last: stadium, km, stops }
  for (const m of order) {
    const stadium = stadiumByName.get(m.stadium);
    if (!stadium) continue;
    const { homeId, awayId } = teamIdsOf(m);
    for (const teamId of [homeId, awayId]) {
      if (!teamId) continue;
      const leg = route.get(teamId) ?? { last: null, km: 0, stops: 0 };
      if (leg.last && leg.last !== stadium) leg.km += haversineKm(leg.last, stadium);
      leg.last = stadium;
      leg.stops += 1;
      route.set(teamId, leg);
    }
  }
  let best = null;
  for (const [teamId, leg] of route) {
    if (!best || leg.km > best.km) best = { teamId, km: leg.km, matches: leg.stops };
  }
  return best && best.km > 0 ? best : null;
}

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
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

// Leader cards in the Teams section. Each rotates through the teams TIED on its
// headline metric — grouped by that metric's value ALONE (decision 2026-06-19),
// so e.g. every team level on goals-for shares the "Best attack" card. `cmp`
// orders within the group (leader first), so the team shown first is unchanged.
const LEADER_CARDS = [
  { id: 'bestAttack',      labelKey: 'stats.bestAttack',      metric: 'gf',          cmp: (a, b) => b.gf - a.gf || b.gd - a.gd },
  { id: 'bestDefense',     labelKey: 'stats.bestDefense',     metric: 'ga',          cmp: (a, b) => a.ga - b.ga || b.cleanSheets - a.cleanSheets || b.gd - a.gd },
  { id: 'mostCleanSheets', labelKey: 'stats.mostCleanSheets', metric: 'cleanSheets', cmp: (a, b) => b.cleanSheets - a.cleanSheets || a.ga - b.ga },
  { id: 'mostWins',        labelKey: 'stats.mostWins',        metric: 'won',         cmp: (a, b) => b.won - a.won || b.gd - a.gd || b.gf - a.gf },
  { id: 'mostConceded',    labelKey: 'stats.mostConceded',    metric: 'ga',          cmp: (a, b) => b.ga - a.ga || a.gd - b.gd },
  { id: 'bestGoalDiff',    labelKey: 'stats.bestGoalDiff',    metric: 'gd',          cmp: (a, b) => b.gd - a.gd || b.gf - a.gf },
  // Layer 2 — only meaningful with the {y,r} split on every match (needsDiscipline)
  { id: 'fairPlay',        labelKey: 'stats.fairPlay',        metric: 'cardsTotal',  cmp: (a, b) => a.cardsTotal - b.cardsTotal || a.cardsR - b.cardsR || b.points - a.points, needsDiscipline: true },
];

// Each card carries the FULL tied group (same value on its headline metric),
// ordered by the card's tiebreakers; the carousel rotates through it. Only teams
// that have played count (a 0-game team's empty record never "leads"). Null
// before any match finishes → the whole leaders strip degrades away.
function computeLeaders(teamStats, disciplineOk) {
  const played = teamStats.filter((row) => row.played > 0);
  if (!played.length) return null;
  return LEADER_CARDS.filter((card) => !card.needsDiscipline || disciplineOk)
    .map(({ id, labelKey, metric, cmp }) => {
    const sorted = [...played].sort(cmp);
    const best = sorted[0][metric];
    return { id, labelKey, metric, group: sorted.filter((row) => row[metric] === best) };
  });
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
  clearLeaderTimers(); // drop any carousel intervals from the previous render
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
  // comparator: delegation on the section (it is recreated each render, so no
  // duplicate listeners) — covers both modes AND the selects the mode swap
  // recreates inside #cmp-body.
  const cmpSection = root.querySelector('#stats-comparator');
  if (cmpSection) {
    cmpSection.addEventListener('change', (event) => {
      const map = { 'cmp-a': (v) => { cmpA = v; }, 'cmp-b': (v) => { cmpB = v; },
                    'cmp-pa': (v) => { cmpPA = v; }, 'cmp-pb': (v) => { cmpPB = v; } };
      const apply = map[event.target.id];
      if (apply) { apply(event.target.value); refreshComparator(); }
    });
    cmpSection.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-cmp-mode]');
      if (!btn || btn.dataset.cmpMode === cmpMode) return;
      cmpMode = btn.dataset.cmpMode;
      for (const b of cmpSection.querySelectorAll('[data-cmp-mode]')) {
        b.setAttribute('aria-pressed', String(b.dataset.cmpMode === cmpMode));
      }
      cmpSection.querySelector('#cmp-body').innerHTML = cmpBodyHTML();
    });
  }
  // players section: chip toggle re-renders only the table
  const playersSection = root.querySelector('#stats-players');
  playersSection?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chip]');
    if (!chip || chip.dataset.chip === playersChip) return;
    playersChip = chip.dataset.chip;
    for (const b of playersSection.querySelectorAll('[data-chip]')) {
      b.setAttribute('aria-pressed', String(b.dataset.chip === playersChip));
    }
    renderPlayersTable();
  });
  setupCountUps(root);
  setupLeaderCarousels(root);
  setupSubNav(root, sections);
}

// ----------------------------------------------------------- sub-nav

function subNavHTML(sections) {
  if (sections.length < 2) return ''; // a lone section needs no navigation
  const chips = sections.map((section, i) => `
    <a class="stats-subnav-chip${i === 0 ? ' active' : ''}" href="#stats-${section.id}"
       data-section="${section.id}" aria-current="${i === 0 ? 'true' : 'false'}">${t(section.navKey)}</a>`).join('');
  // chips live in an inner scroll track so the edge-fade mask never clips the
  // pill's background/rounded ends (only the chips fade at the edges).
  return `<nav class="stats-subnav" aria-label="${t('stats.sectionsNav')}"><div class="stats-subnav-track">${chips}</div></nav>`;
}

let spyScrollHandler = null;
let subnavResizeHandler = null;
// While a chip-click smooth-scroll is in flight, the page-scroll spy must NOT
// fight it: early in the animation the viewport is still over the old section,
// so the spy would flip the active chip back and then forward again (a visible
// jump). Suppress spy updates until the programmatic scroll has settled.
let suppressSpyUntil = 0;

function setupSubNav(root, sections) {
  const nav = root.querySelector('.stats-subnav');
  if (!nav) return;
  const track = nav.querySelector('.stats-subnav-track');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // chip → smooth-scroll to the section WITHOUT touching location.hash: the tab
  // router (app.js) listens on hashchange, so a real #fragment would route to
  // an unknown tab and bounce the user to Home. preventDefault keeps us in-tab.
  nav.addEventListener('click', (event) => {
    const chip = event.target.closest('.stats-subnav-chip');
    if (!chip) return;
    event.preventDefault();
    suppressSpyUntil = Date.now() + (reduce ? 0 : 700); // hold the spy off during the animated scroll
    document.getElementById(`stats-${chip.dataset.section}`)
      ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActiveChip(nav, chip.dataset.section);
  });

  // edge fades while the chip track overflows horizontally (mirrors the header
  // tabs): a fade shows only on a side that still has chips to scroll toward.
  track?.addEventListener('scroll', () => updateSubnavFades(nav), { passive: true });

  // scrollspy: active = the last section whose heading has scrolled under the
  // sticky sub-nav line; at the page bottom the last section always wins (a short
  // final section may never reach the line — the classic scrollspy edge case an
  // IntersectionObserver band leaves unlit). Reading getBoundingClientRect on a
  // handful of sections per frame is cheap and always correct on short pages.
  const ids = sections.map((section) => section.id);
  const updateSpy = () => {
    if (Date.now() < suppressSpyUntil) return; // a chip-click scroll owns the active chip
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

  // re-evaluate the fades when the viewport width changes the track's overflow
  if (subnavResizeHandler) window.removeEventListener('resize', subnavResizeHandler);
  subnavResizeHandler = () => updateSubnavFades(nav);
  window.addEventListener('resize', subnavResizeHandler, { passive: true });

  updateSpy();
  updateSubnavFades(nav);
}

// Toggle the edge-fade mask classes on the pill based on the inner track's
// horizontal overflow (the mask lives on the track, so the pill stays crisp).
function updateSubnavFades(nav) {
  const track = nav.querySelector('.stats-subnav-track');
  if (!track) return;
  const overflowing = track.scrollWidth - track.clientWidth > 1;
  const atStart = track.scrollLeft <= 1;
  const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
  nav.classList.toggle('fade-left', overflowing && !atStart);
  nav.classList.toggle('fade-right', overflowing && !atEnd);
}

function setActiveChip(nav, id) {
  const track = nav.querySelector('.stats-subnav-track');
  for (const chip of nav.querySelectorAll('.stats-subnav-chip')) {
    const on = chip.dataset.section === id;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-current', on ? 'true' : 'false');
  }
  // keep the active chip visible when the track scrolls horizontally on mobile
  // (only moves the track's own scroll, never the page).
  const active = nav.querySelector('.stats-subnav-chip.active');
  if (active && track) track.scrollLeft = active.offsetLeft - (track.clientWidth - active.clientWidth) / 2;
  updateSubnavFades(nav);
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
  const numberFmt = new Intl.NumberFormat(getLocale());
  const cards = [
    { value: String(m.finishedCount), sub: `/ ${m.totalMatches}`, label: t('stats.played') },
    { value: String(m.decisive), label: t('stats.decisive') },
    { value: String(m.draws), label: t('stats.draws') },
  ];
  if (m.attendance) {
    cards.push(
      { value: numberFmt.format(m.attendance.total), label: t('stats.totalAttendance') },
      { value: numberFmt.format(Math.round(m.attendance.avg)), label: t('stats.avgAttendance') },
    );
  }
  if (m.discipline) {
    cards.push(
      { value: String(m.discipline.y), label: t('stats.cardsYellow') },
      { value: String(m.discipline.r), label: t('stats.cardsRed') },
    );
  }
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
    ${confederationsHTML()}
    ${teamRecordsHTML()}
    <div id="stats-teams-table" class="stats-teams-table"></div>
    ${legendHTML(COLUMNS)}`;
}

// Confederation performance bars (Layer 2) — points per game, so small
// confederations compare fairly against UEFA's match volume. Reuses the
// goals-by-stage chart styling.
function confederationsHTML() {
  const rows = model.confederations;
  if (!rows) return '';
  const max = Math.max(...rows.map((row) => row.ppg));
  const bars = rows.map((row) => {
    const pct = max ? Math.round((row.ppg / max) * 100) : 0;
    return `
      <div class="chart-row">
        <span class="chart-bar-label">${row.conf} <small>(${row.teams})</small></span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%"></div></div>
        <span class="chart-bar-val">${row.ppg.toFixed(2)}</span>
      </div>`;
  }).join('');
  return `
    <h3 class="stats-subhead">${t('stats.confTitle')}</h3>
    <div class="stats-chart glass">${bars}</div>`;
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

// ----------------------------------------------------- players section

// Table variants behind the chip toggle. A chip renders only when its data is
// authoritative (cards/saves gate in computePlayers); scorers/assists always
// exist once the section itself is available.
const PLAYER_CHIPS = [
  { id: 'scorers', labelKey: 'stats.chipScorers', cols: [['goals', 'stats.colGoals'], ['assists', 'stats.colAssists']], rows: (pl) => pl.scorers, gate: () => true },
  { id: 'assists', labelKey: 'stats.chipAssists', cols: [['assists', 'stats.colAssists'], ['goals', 'stats.colGoals']], rows: (pl) => pl.assisters, gate: () => true },
  { id: 'cards', labelKey: 'stats.chipCards', cols: [['y', 'stats.cardsYellow'], ['r', 'stats.cardsRed']], rows: (pl) => pl.carded, gate: (pl) => pl.cardsOk },
  { id: 'saves', labelKey: 'stats.chipSaves', cols: [['saves', 'stats.chipSaves'], ['cleanSheets', 'stats.colCS']], rows: (pl) => pl.keepers, gate: (pl) => pl.savesOk },
];
const PLAYER_TABLE_MAX = 10;

function playerFlag(p, w = 22, h = 15) {
  return flagImg(getData().teamById.get(p.team), w, h);
}

function playersSectionHTML() {
  const pl = model.players;
  return `
    <h2 class="section-title">${t('stats.playersTitle')}</h2>
    ${podiumHTML(pl)}
    ${playerChipsHTML(pl)}
    <div id="stats-players-table" class="stats-teams-table">${playersTableHTML(pl)}</div>
    ${awardsHTML(pl)}
    ${squadHTML(pl)}`;
}

// Golden-Boot podium — top-3 scorers, runner-ups flanking the leader.
function podiumHTML(pl) {
  if (!pl.podium.length) return '';
  const order = [pl.podium[1], pl.podium[0], pl.podium[2]].filter(Boolean);
  const steps = order.map((p) => {
    const rank = pl.podium.indexOf(p) + 1;
    return `
      <div class="podium-step podium-${rank}">
        <span class="podium-rank" aria-hidden="true">${rank}</span>
        ${playerFlag(p, 30, 20)}
        <span class="podium-name">${p.name}</span>
        <span class="podium-value" data-countup="${p.goals}" data-decimals="0">0</span>
        <span class="podium-label">${t('stats.colGoalsLong')}</span>
      </div>`;
  }).join('');
  return `
    <h3 class="stats-subhead">${t('stats.topScorers')}</h3>
    <div class="podium glass">${steps}</div>`;
}

function availableChips(pl) {
  return PLAYER_CHIPS.filter((chip) => chip.gate(pl) && chip.rows(pl).length);
}

function playerChipsHTML(pl) {
  const chips = availableChips(pl);
  if (chips.length < 2) return '';
  if (!chips.some((chip) => chip.id === playersChip)) playersChip = chips[0].id;
  return `
    <div class="player-chips" role="group" aria-label="${t('stats.playersTitle')}">
      ${chips.map((chip) => `
        <button type="button" class="player-chip" data-chip="${chip.id}"
                aria-pressed="${chip.id === playersChip}">${t(chip.labelKey)}</button>`).join('')}
    </div>`;
}

function playersTableHTML(pl) {
  const chip = PLAYER_CHIPS.find((c) => c.id === playersChip && c.gate(pl)) ?? PLAYER_CHIPS[0];
  const rows = chip.rows(pl).slice(0, PLAYER_TABLE_MAX);
  if (!rows.length) return '';
  const head = chip.cols.map(([, labelKey]) => `<th scope="col" class="col-num">${t(labelKey)}</th>`).join('');
  const body = rows.map((p, i) => `
    <tr>
      <td class="col-rank">${i + 1}</td>
      <td class="col-team">${playerFlag(p)} <span>${p.name}</span></td>
      ${chip.cols.map(([key], ci) => `<td class="col-num${ci === 0 ? ' sorted' : ''}">${p[key]}</td>`).join('')}
    </tr>`).join('');
  return `
    <div class="stats-table-wrap" role="region" aria-label="${t(chip.labelKey)}" tabindex="0">
      <table class="stats-table">
        <caption class="sr-only">${t(chip.labelKey)}</caption>
        <thead><tr>
          <th scope="col" class="col-rank">#</th>
          <th scope="col" class="col-team">${t('stats.colPlayer')}</th>
          ${head}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function renderPlayersTable() {
  const host = document.getElementById('stats-players-table');
  if (host) host.innerHTML = playersTableHTML(model.players);
}

// FIFA awards block — each card gates on its winner resolving; the goal of the
// tournament links to its match.
function awardsHTML(pl) {
  if (!pl.awards) return '';
  const cards = pl.awards.list.map((a) => `
    <div class="record-card glass">
      <span class="record-label">${t(a.labelKey)}</span>
      <span class="record-main">${playerFlag(a.player, 26, 17)} <span class="award-name">${a.player.name}</span></span>
      <span class="record-teams">${getData().teamById.get(a.player.team).name}</span>
    </div>`);
  const got = pl.awards.goalOfTournament;
  if (got) {
    const p = pl.byId.get(got.player);
    cards.push(`
      <button type="button" class="record-card glass" data-record-match="${got.matchId}"
              aria-label="${t('stats.goalOfTournament')}: ${p.name}">
        <span class="record-label">${t('stats.goalOfTournament')}</span>
        <span class="record-main">${playerFlag(p, 26, 17)} <span class="award-name">${p.name}</span> <span class="record-score">${got.minute}'</span></span>
        <span class="record-teams">${getData().teamById.get(p.team).name}</span>
      </button>`);
  }
  return `
    <h3 class="stats-subhead">${t('stats.awardsTitle')}</h3>
    <div class="stats-records-grid">${cards.join('')}</div>`;
}

// Squad of the Tournament — simple formation rows (GK / DF / MF / FW).
function squadHTML(pl) {
  if (!pl.squad) return '';
  const byPos = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of pl.squad) (byPos[p.position] ?? byPos.MF).push(p);
  const rows = ['FW', 'MF', 'DF', 'GK'].filter((pos) => byPos[pos].length).map((pos) => `
    <div class="squad-row">
      ${byPos[pos].map((p) => `
        <div class="squad-player">
          ${playerFlag(p, 24, 16)}
          <span class="squad-name">${p.name}</span>
          <span class="squad-pos">${pos} · ${p.shirt}</span>
        </div>`).join('')}
    </div>`).join('');
  return `
    <h3 class="stats-subhead">${t('stats.squadTitle')}</h3>
    <div class="squad-pitch glass">${rows}</div>`;
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
  if (rec.biggestUpset) cards.push(upsetCardHTML(rec.biggestUpset));
  if (model.discipline?.mostCards) cards.push(mostCardsCardHTML(model.discipline.mostCards));
  if (model.attendance?.biggest) cards.push(crowdCardHTML(model.attendance.biggest));
  if (rec.longestRoad) cards.push(longestRoadCardHTML(rec.longestRoad));
  const pl = model.players;
  if (pl?.fastestGoal) cards.push(goalTimeCardHTML('stats.fastestGoal', pl.fastestGoal));
  if (pl?.latestGoal && pl.latestGoal !== pl.fastestGoal) cards.push(goalTimeCardHTML('stats.latestGoal', pl.latestGoal));
  if (pl?.youngestScorer?.ageYears != null) cards.push(youngestScorerCardHTML(pl.youngestScorer));
  const grid = cards.length ? `<div class="stats-records-grid">${cards.join('')}</div>` : '';
  return `
    <h2 class="section-title">${t('stats.recordsTitle')}</h2>
    ${grid}
    ${curiositiesHTML()}
    ${vsHistoryHTML()}
    ${formatDebutsHTML()}`;
}

// ---------------------------------------------------- editorial (Stage I)

// Bilingual field with fallback: current language first, the other when the
// translation is missing (never a blank card — plan §6.7).
function editorialText(card, field) {
  const preferred = getLang() === 'pt' ? `${field}PT` : `${field}EN`;
  const fallback = getLang() === 'pt' ? `${field}EN` : `${field}PT`;
  return card[preferred] || card[fallback] || '';
}

function curiositiesHTML() {
  const list = model.curiosities;
  if (!list) return '';
  const cards = list.map((c) => {
    const team = c.teamId ? getData().teamById.get(c.teamId) : null;
    const link = c.matchId != null
      ? `<button type="button" class="stats-link editorial-link" data-record-match="${c.matchId}">${t('stats.seeMatch')} →</button>`
      : '';
    return `
      <article class="editorial-card glass">
        <h4 class="editorial-title">${team ? flagImg(team, 22, 15) : ''} ${editorialText(c, 'title')}</h4>
        <p class="editorial-body">${editorialText(c, 'body')}</p>
        ${link}
      </article>`;
  }).join('');
  return `
    <h3 class="stats-subhead">${t('stats.curiositiesTitle')}</h3>
    <div class="editorial-grid">${cards}</div>`;
}

function vsHistoryHTML() {
  const rows = model.vsHistory;
  if (!rows) return '';
  const numberFmt = new Intl.NumberFormat(getLocale());
  const fmt = (value, kind) =>
    kind === 'dec' ? value.toFixed(2) : kind === 'num' ? numberFmt.format(value) : String(value);
  const body = rows.map((row) => `
    <div class="history-row${row.beaten ? ' beaten' : ''}">
      <span class="history-label">${t(row.labelKey)}</span>
      <span class="history-current">${fmt(row.current, row.fmt)}
        ${row.beaten ? `<span class="history-badge">${t('stats.newRecord')}</span>` : ''}</span>
      <span class="history-record">${fmt(row.record, row.fmt)} <small class="history-holder">${row.holder}</small></span>
    </div>`).join('');
  return `
    <h3 class="stats-subhead">${t('stats.vsHistoryTitle')}</h3>
    <div class="history-panel glass">
      <div class="history-row history-head">
        <span class="history-label"></span>
        <span class="history-current">${t('stats.thisCup')}</span>
        <span class="history-record">${t('stats.allTime')}</span>
      </div>
      ${body}
    </div>`;
}

// ------- Layer-2 record cards (each renders only when its datum is present)

function upsetCardHTML(upset) {
  const winner = getData().teamById.get(upset.winnerId);
  const loser = getData().teamById.get(upset.loserId);
  const pens = upset.pens ? ` <small>(${t('status.pens')} ${upset.pens})</small>` : '';
  return `
    <button type="button" class="record-card glass" data-record-match="${upset.matchId}"
            aria-label="${t('stats.biggestUpset')}: ${winner.name} ${upset.score} ${loser.name}">
      <span class="record-label">${t('stats.biggestUpset')}</span>
      <span class="record-main">
        ${flagImg(winner, 26, 17)}
        <span class="record-score">${upset.score}${pens}</span>
        ${flagImg(loser, 26, 17)}
      </span>
      <span class="record-teams">${winner.name} (#${upset.winnerRank}) <span class="record-vs">${t('hero.vs')}</span> ${loser.name} (#${upset.loserRank})</span>
    </button>`;
}

function mostCardsCardHTML(rec) {
  const home = getData().teamById.get(rec.homeTeam);
  const away = getData().teamById.get(rec.awayTeam);
  return `
    <button type="button" class="record-card glass" data-record-match="${rec.matchId}"
            aria-label="${t('stats.mostCardsMatch')}: ${home.name} ${t('hero.vs')} ${away.name}">
      <span class="record-label">${t('stats.mostCardsMatch')}</span>
      <span class="record-main">
        ${flagImg(home, 26, 17)}
        <span class="record-score">${rec.y} 🟨${rec.r ? ` ${rec.r} 🟥` : ''}</span>
        ${flagImg(away, 26, 17)}
      </span>
      <span class="record-teams">${home.name} <span class="record-vs">${t('hero.vs')}</span> ${away.name}</span>
    </button>`;
}

function crowdCardHTML(rec) {
  const numberFmt = new Intl.NumberFormat(getLocale());
  const match = getData().matches.find((m) => m.id === rec.matchId);
  const slots = match ? resolveBracketTeams(match) : null;
  const matchup = slots?.home.team && slots?.away.team
    ? `${slots.home.team.name} <span class="record-vs">${t('hero.vs')}</span> ${slots.away.team.name} · ${rec.stadium}`
    : rec.stadium;
  return `
    <button type="button" class="record-card glass" data-record-match="${rec.matchId}"
            aria-label="${t('stats.biggestCrowd')}: ${numberFmt.format(rec.attendance)} — ${rec.stadium}">
      <span class="record-label">${t('stats.biggestCrowd')}</span>
      <span class="record-main"><span class="record-score">${numberFmt.format(rec.attendance)}</span></span>
      <span class="record-teams">${matchup}</span>
    </button>`;
}

// Goal-time record cards (Stage H) — minute + scorer, clickable to the match.
function goalTimeCardHTML(labelKey, event) {
  const p = model.players.byId.get(event.player);
  return `
    <button type="button" class="record-card glass" data-record-match="${event.matchId}"
            aria-label="${t(labelKey)}: ${p.name}, ${event.minute}'">
      <span class="record-label">${t(labelKey)}</span>
      <span class="record-main">${playerFlag(p, 26, 17)} <span class="record-score">${event.minute}'</span></span>
      <span class="record-teams">${p.name}</span>
    </button>`;
}

function youngestScorerCardHTML({ event, ageYears }) {
  const p = model.players.byId.get(event.player);
  return `
    <button type="button" class="record-card glass" data-record-match="${event.matchId}"
            aria-label="${t('stats.youngestScorer')}: ${p.name}">
      <span class="record-label">${t('stats.youngestScorer')}</span>
      <span class="record-main">${playerFlag(p, 26, 17)} <span class="record-score">${t('stats.yearsOld').replace('{n}', String(ageYears))}</span></span>
      <span class="record-teams">${p.name}</span>
    </button>`;
}

function longestRoadCardHTML(rec) {
  const team = getData().teamById.get(rec.teamId);
  const numberFmt = new Intl.NumberFormat(getLocale());
  return `
    <div class="record-card glass">
      <span class="record-label">${t('stats.longestRoad')}</span>
      <span class="record-main">
        ${flagImg(team, 26, 17)}
        <span class="record-score">${numberFmt.format(Math.round(rec.km))} km</span>
      </span>
      <span class="record-teams">${team.name} · ${rec.matches} ${t('stats.roadMatches')}</span>
    </div>`;
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

// The Stage-F deferral resolved: with the players model available the comparator
// gains a Teams|Players mode toggle (aria-pressed buttons, not a tablist). All
// selections + mode survive langchange via module state.
function comparatorSectionHTML() {
  const toggle = model.players ? `
    <div class="player-chips cmp-mode" role="group" aria-label="${t('stats.comparatorTitle')}">
      <button type="button" class="player-chip" data-cmp-mode="teams" aria-pressed="${cmpMode === 'teams'}">${t('stats.cmpModeTeams')}</button>
      <button type="button" class="player-chip" data-cmp-mode="players" aria-pressed="${cmpMode === 'players'}">${t('stats.cmpModePlayers')}</button>
    </div>` : '';
  if (!model.players) cmpMode = 'teams';
  return `
    <h2 class="section-title">${t('stats.comparatorTitle')}</h2>
    ${toggle}
    <div id="cmp-body">${cmpBodyHTML()}</div>`;
}

function cmpBodyHTML() {
  if (cmpMode === 'players') {
    ensurePlayerCmpDefaults();
    const pool = [...model.players.aggById.values()].sort((a, b) => a.name.localeCompare(b.name));
    const options = (selected) => pool
      .map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${p.name} (${p.team})</option>`).join('');
    return `
      <div class="cmp-controls">
        <select class="filter-control cmp-select" id="cmp-pa" aria-label="${t('stats.cmpPlayerA')}">${options(cmpPA)}</select>
        <span class="cmp-vs">${t('hero.vs')}</span>
        <select class="filter-control cmp-select" id="cmp-pb" aria-label="${t('stats.cmpPlayerB')}">${options(cmpPB)}</select>
      </div>
      <div class="cmp-panel glass" id="cmp-panel">${playerBarsHTML()}</div>`;
  }
  ensureComparatorDefaults();
  const teams = [...getData().teams].sort((a, b) => a.name.localeCompare(b.name));
  const options = (selected) => teams
    .map((team) => `<option value="${team.id}"${team.id === selected ? ' selected' : ''}>${team.name}</option>`).join('');
  return `
    <div class="cmp-controls">
      <select class="filter-control cmp-select" id="cmp-a" aria-label="${t('stats.cmpTeamA')}">${options(cmpA)}</select>
      <span class="cmp-vs">${t('hero.vs')}</span>
      <select class="filter-control cmp-select" id="cmp-b" aria-label="${t('stats.cmpTeamB')}">${options(cmpB)}</select>
    </div>
    <div class="cmp-panel glass" id="cmp-panel">${comparatorBarsHTML()}</div>`;
}

function ensurePlayerCmpDefaults() {
  const valid = (id) => id && model.players.aggById.has(id);
  if (valid(cmpPA) && valid(cmpPB)) return;
  cmpPA = valid(cmpPA) ? cmpPA : model.players.scorers[0]?.id;
  cmpPB = valid(cmpPB) ? cmpPB : model.players.scorers[1]?.id ?? model.players.scorers[0]?.id;
}

// Player metrics — saves/CS rows appear only when either side is a keeper with
// data (an all-zero row for two outfielders is noise, not comparison).
function playerCmpMetrics(a, b) {
  const metrics = [
    { key: 'goals', label: 'stats.colGoalsLong' },
    { key: 'assists', label: 'stats.chipAssists' },
    { key: 'y', label: 'stats.cardsYellow' },
    { key: 'r', label: 'stats.cardsRed' },
  ];
  if ((a.saves || a.cleanSheets || b.saves || b.cleanSheets) && model.players.savesOk) {
    metrics.push({ key: 'saves', label: 'stats.chipSaves' }, { key: 'cleanSheets', label: 'stats.colCS' });
  }
  return metrics;
}

function playerBarsHTML() {
  const blank = { goals: 0, assists: 0, y: 0, r: 0, saves: 0, cleanSheets: 0 };
  const ra = model.players.aggById.get(cmpPA) ?? { ...blank, ...model.players.byId.get(cmpPA) };
  const rb = model.players.aggById.get(cmpPB) ?? { ...blank, ...model.players.byId.get(cmpPB) };
  const header = `
    <div class="cmp-head">
      <div class="cmp-team">${playerFlag(ra, 28, 19)} <span>${ra.name}</span></div>
      <div class="cmp-team cmp-team-b"><span>${rb.name}</span> ${playerFlag(rb, 28, 19)}</div>
    </div>`;
  const rows = playerCmpMetrics(ra, rb).map((metric) => {
    const av = ra[metric.key] ?? 0;
    const bv = rb[metric.key] ?? 0;
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
  if (panel) panel.innerHTML = cmpMode === 'players' ? playerBarsHTML() : comparatorBarsHTML();
}

// Compact abbreviation key — hidden on desktop (the hover tooltip covers it
// there), shown on small screens where hover doesn't fire.
function legendHTML(columns) {
  const pairs = columns
    .map((col) => `<span class="legend-pair"><b>${t(col.label)}</b> = ${t(col.tip)}</span>`)
    .join('');
  return `<p class="stats-legend">${pairs}</p>`;
}

const ROTATE_MS = 3500;   // auto-advance cadence for tied-leader carousels
const DOTS_MAX = 8;       // above this many tied teams, dots give way to "i / n"

function leadersHTML() {
  const leaders = model.leaders;
  if (!leaders) return '';
  return `<div class="stats-leaders">${leaders.map(leaderCardHTML).join('')}</div>`;
}

function leaderValueText(metric, value) {
  return metric === 'gd' && value > 0 ? `+${value}` : `${value}`;
}

function leaderTeamHTML(row) {
  const team = getData().teamById.get(row.teamId);
  return `${flagImg(team, 30, 20)}<span class="leader-name">${team.name}</span>`;
}

// A leader card. Single-team group → a plain static card (identical to before).
// A tie → arrows + an indicator (dots up to DOTS_MAX, else an "i / n" counter);
// setupLeaderCarousels() wires the rotation. The big value is shared by the whole
// group (all tied on the metric), so only the flag+name swap as it rotates.
function leaderCardHTML({ id, labelKey, metric, group }) {
  const label = t(labelKey);
  const value = leaderValueText(metric, group[0][metric]);
  if (group.length < 2) {
    return `
      <div class="leader-card glass">
        <span class="leader-label">${label}</span>
        <div class="leader-team">${leaderTeamHTML(group[0])}</div>
        <span class="leader-value">${value}</span>
      </div>`;
  }
  const indicator = group.length <= DOTS_MAX
    ? `<div class="leader-dots" aria-hidden="true">${group.map((_, i) =>
        `<span class="leader-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
    : `<span class="leader-counter" aria-hidden="true">1 / ${group.length}</span>`;
  return `
    <div class="leader-card glass" data-leader="${id}" role="group" aria-label="${label}">
      <span class="leader-label">${label}</span>
      <div class="leader-stage">
        <button type="button" class="leader-nav leader-prev" aria-label="${t('stats.leaderPrev')}">&lsaquo;</button>
        <div class="leader-team">${leaderTeamHTML(group[0])}</div>
        <button type="button" class="leader-nav leader-next" aria-label="${t('stats.leaderNext')}">&rsaquo;</button>
      </div>
      <span class="leader-value">${value}</span>
      ${indicator}
    </div>`;
}

// Tied-leader carousels. Timers are tracked module-level and cleared at the top
// of render() so a re-render (langchange/datachange) never leaves an interval
// firing on detached DOM (cf. gotcha #6 — never double-schedule).
let leaderTimers = [];
function clearLeaderTimers() {
  for (const id of leaderTimers) clearInterval(id);
  leaderTimers = [];
}

// Auto-advance pauses on hover/focus and is disabled entirely under
// prefers-reduced-motion (arrows still work). A manual arrow click restarts the
// cadence implicitly: while the pointer/focus is on the card it stays paused, and
// leaving the card starts a fresh full interval.
function setupLeaderCarousels(root) {
  const leaders = model.leaders;
  if (!leaders) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const leader of leaders) {
    if (leader.group.length < 2) continue; // single team: static, no timer
    const card = root.querySelector(`.leader-card[data-leader="${leader.id}"]`);
    if (!card) continue;
    const teamHost = card.querySelector('.leader-team');
    const dots = card.querySelectorAll('.leader-dot');
    const counter = card.querySelector('.leader-counter');
    const group = leader.group;
    let idx = 0;
    let timer = null;
    let paused = false;
    const show = (i) => {
      idx = (i + group.length) % group.length;
      teamHost.innerHTML = leaderTeamHTML(group[idx]);
      dots.forEach((dot, di) => dot.classList.toggle('active', di === idx));
      if (counter) counter.textContent = `${idx + 1} / ${group.length}`;
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      leaderTimers = leaderTimers.filter((x) => x !== timer);
      timer = null;
    };
    const start = () => {
      if (reduce || paused || timer) return;
      timer = setInterval(() => show(idx + 1), ROTATE_MS);
      leaderTimers.push(timer);
    };
    const pause = () => { paused = true; stop(); };
    const resume = () => { paused = false; start(); };
    card.querySelector('.leader-prev')?.addEventListener('click', () => show(idx - 1));
    card.querySelector('.leader-next')?.addEventListener('click', () => show(idx + 1));
    card.addEventListener('mouseenter', pause);
    card.addEventListener('mouseleave', resume);
    card.addEventListener('focusin', pause);
    card.addEventListener('focusout', resume);
    start();
  }
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
