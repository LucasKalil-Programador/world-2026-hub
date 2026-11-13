# How to fill the post-Cup data layers

> **Why this file exists.** The post-tournament Stats screen is **code-complete** (stats plan stages
> A–J, shipped 2026-07-20, `v1.4.1`), but it currently runs on **mock data**. This guide is the
> checklist for replacing that mock data with real World Cup 2026 data.
>
> **Nothing here requires touching code.** Every section of the screen is driven by `data/*.json`.
> Companion runbooks: [`how-refresh-data.md`](how-refresh-data.md) (daily score refresh, now
> complete) and [`how-update.md`](how-update.md) (original mock → real migration, schema reference).

---

## The one rule that governs everything: full coverage or nothing

The Stats screen follows a **graceful-degradation contract**: a statistic appears **only when it is
complete enough to be authoritative**. If it isn't, it is *removed from the DOM* — no `—`, no empty
card, no "coming soon". The visitor never sees a gap.

Practical consequence for you:

- **Half-filling a field does nothing visible.** Add `attendance` to 60 of 104 matches and the
  attendance tiles stay hidden — a partial sum would silently understate the totals, so the code
  refuses to show it.
- **The section reappears the moment the last entry lands.** No flag to flip, no code change.
- **You can work incrementally** (round by round) — just expect the UI to light up at the end of
  each *complete* dataset, not progressively.

So: pick one dataset, finish it, see it appear. Then the next.

---

## Status at a glance

| File | Field(s) | Status | Effort |
|---|---|---|---|
| `results.json` | `attendance` | 🔴 MOCK — replace | ~104 numbers |
| `results.json` | `stats.cards` `{y,r}` | 🔴 reds are MOCK | ~104 × 2 |
| `results.json` | `decidedIn` | ✅ real (derived) | — |
| `results.json` | scores/status/penalties/possession/shots | ✅ real | — |
| `teams.json` | `ranking` | 🔴 MOCK — replace | 48 numbers |
| `teams.json` | `confederation`, `wcDebut` | ✅ real (spot-check) | — |
| `stadiums.json` | `lat` / `lng` | ✅ real (approx.) | — |
| `players.json` | everything | 🔴 **all names synthetic** | biggest job |
| `player-events.json` | everything | 🔴 MOCK (~600 events) | biggest job |
| `awards.json` | everything | 🔴 MOCK | ~15 min |
| `keeper-stats.json` | everything | 🔴 MOCK | ~48 rows |
| `curiosities.json` | the 6 texts | 🟡 unreviewed copy | editorial |
| `all-time-baselines.json` | everything | ✅ real history | — |

**Suggested order:** `results.json` + `teams.json` → `awards.json` + `keeper-stats.json` →
`players.json` + `player-events.json` (the bulk) → `curiosities.json` review.

**Source discipline:** use **one authoritative source** (the FIFA match centre) and cross-check
anything surprising against a second (ESPN box score), exactly like the daily refresh did.

---

## 1 · `results.json` — attendance and card splits

One entry per match, 104 total. A finished entry now looks like this:

```json
{
  "matchId": 104,
  "homeScore": 1,
  "awayScore": 0,
  "status": "finished",
  "attendance": 79856,
  "decidedIn": "ET",
  "stats": {
    "possession": { "home": 65, "away": 35 },
    "shots": { "home": 20, "away": 2 },
    "cards": { "home": { "y": 0, "r": 0 }, "away": { "y": 4, "r": 1 } }
  }
}
```

### `attendance` — 🔴 replace
Official attendance for the match, as an integer. The mock values are a deterministic 86–100 % of
each stadium's capacity — plausible, but invented.

**Unlocks:** "Público total" and "Média de público" tiles in Overview, the "Maior público" record
card, and two rows of the "Esta Copa vs história" panel.

### `stats.cards` — 🔴 replace the red splits
The schema migrated from a plain number (yellows only) to `{ "y": <yellows>, "r": <reds> }` per
side. **Yellow counts came from the real daily refreshes; the red splits are mocked** (one real
exception: Enzo Fernández's second yellow in the Final).

**Unlocks:** yellow/red tiles in Overview, the "Jogo com mais cartões" record, the "Fair play"
leader card, the Players "Cartões" chip, and the discipline rows of the history panel.

> **Backward compatibility:** the code reads this through `cardCounts()` in `app.js`, so a legacy
> plain number still works and is treated as *yellows only, non-authoritative for reds*. That means
> **one** legacy entry left behind silently disables every red-card statistic. Convert all 104.

### `decidedIn` — ✅ already real
`"regulation" | "ET" | "penalties"`, knockout matches (ids 73–104) only. Derived from the existing
`penalties` field and the Final's extra time. Shown in the match modal. Just spot-check it.

---

## 2 · `teams.json` — FIFA ranking

```json
{ "id": "ESP", "name": "Spain", "flag": "flags/esp.svg",
  "confederation": "UEFA", "ranking": 2, "wcDebut": false }
```

- **`ranking` — 🔴 replace.** The team's real FIFA ranking position going into the tournament
  (integer). The mock is a plausible-looking but invented order.
  **Unlocks:** the "Maior zebra" record card (the win with the largest ranking gap in the winner's
  disfavour — shootout winners count, since advancing *is* the upset).
- **`confederation` — ✅ real.** One of `UEFA | CONMEBOL | CONCACAF | CAF | AFC | OFC`. Drives the
  points-per-game bar chart in the Teams section. Needs to be present on **all 48** teams.
- **`wcDebut` — ✅ real.** Boolean; true for Curaçao, Jordan, Uzbekistan and Cape Verde. Spot-check.

---

## 3 · `players.json` — the roster

**Every one of the 349 current names is synthetic and must be replaced.** Only players who actually
appear somewhere need an entry ("involved players"): they scored, assisted, were booked, are a
listed keeper, or appear in the awards / Squad of the Tournament.

```json
{ "id": "ESP-9", "name": "Real Name", "team": "ESP",
  "position": "FW", "shirt": 9, "birthDate": "1999-02-28" }
```

- **`id`** — any stable unique string; the current convention is `TEAM-shirt`. Every reference in
  the other three player files must resolve to an id here, or the whole Players section switches off.
- **`team`** — a 3-letter team id from `teams.json`.
- **`position`** — `GK | DF | MF | FW`. Used to lay out the Squad of the Tournament formation.
- **`birthDate`** — `YYYY-MM-DD`. Powers the "Artilheiro mais jovem" record; a missing date just
  excludes that player from the age comparison.

---

## 4 · `player-events.json` — the event log (the big one)

An append-only log; **everything on the Players screen is derived from it** (top scorers, assists,
discipline, goal-time records). Roughly 600 entries.

```json
{ "type": "goal", "player": "ESP-9", "team": "ESP", "matchId": 104,
  "minute": 106, "goalType": "open", "assist": "ESP-10" }

{ "type": "card", "card": "yellow", "player": "ARG-5", "team": "ARG",
  "matchId": 104, "minute": 63 }
```

| Field | Notes |
|---|---|
| `type` | `goal` or `card` |
| `player` / `team` | must match `players.json` / `teams.json` ids |
| `matchId` | must be a **finished** match — an event on a non-finished match disables the section |
| `minute` | integer; use 91–120 for extra time (drives fastest/latest goal records) |
| `goalType` | `open` / `header` / `penalty` (optional, informational) |
| `assist` | player id (optional; only on goals) |
| `card` | `yellow` or `red` (cards only) |

> ### ⚠️ The two consistency rules that switch the section on
> 1. **Goals must reconcile with the scores.** For every finished match, the number of `goal` events
>    per team must equal that team's score in `results.json` — exactly. One missing goal and the
>    entire Players section, its nav chip, the comparator's Players mode and the goal-time records
>    all disappear.
> 2. **Cards must reconcile with `stats.cards`.** Yellow and red event totals across the tournament
>    must equal the sums of the `{y,r}` splits. If they don't, only the "Cartões" chip switches off —
>    the rest of the section survives.
>
> These are deliberate: an incomplete log would silently understate every chart.

**Own goals:** the current model has no `ownGoal` type wired in. Record the goal against the team
that *benefited* (so the reconciliation holds) and skip the scorer attribution, or add the event
under the actual scorer — but be aware the tally will read as a normal goal for them.

---

## 5 · `keeper-stats.json` — goalkeepers

```json
{ "player": "ESP-1", "team": "ESP", "saves": 31, "cleanSheets": 5 }
```

One row per relevant keeper. Purely additive: without this file the "Defesas" chip and the keeper
rows of the player comparator simply don't render; nothing else changes.

---

## 6 · `awards.json` — FIFA awards (quick win)

```json
{
  "goldenBall": "ESP-10",
  "goldenBoot": "ARG-9",
  "goldenGlove": "ESP-1",
  "bestYoung": "ESP-11",
  "goalOfTournament": { "player": "ESP-9", "matchId": 104, "minute": 106 },
  "squadOfTournament": ["ESP-1", "ESP-2", "…", "FRA-11"]
}
```

- Each award renders **only if its player id resolves**; the others still show. Unknown id = that
  card is dropped, silently.
- **`squadOfTournament` needs exactly 11 resolvable ids** or the formation block doesn't render.
- **Consistency check:** the `goldenBoot` winner should be the same player who tops your event-log
  scoring table — otherwise the award card contradicts the podium right above it. (This exact
  mismatch happened with the mock data and had to be fixed.) The podium ranks by goals ↓, then
  assists ↓, then name ↑.

---

## 7 · `curiosities.json` — editorial cards (🟡 review, not collect)

Six bilingual cards already exist, built on real facts from the refresh logs, but the copy is
**unreviewed**. Rewrite or replace as you like.

```json
{
  "id": "esp-first-48",
  "type": "story",
  "priority": 1,
  "titleEN": "…", "titlePT": "…",
  "bodyEN": "…",  "bodyPT": "…",
  "matchId": 104,
  "teamId": "ESP"
}
```

- **Bilingual with fallback:** if one language is missing, the other is shown — never a blank card.
  A card lacking *both* a title and a body in every language is dropped.
- `priority` sets the display order (ascending). `matchId` adds a "Ver jogo" button that opens the
  match modal; `teamId` adds a flag to the title. Both optional.

---

## 8 · `all-time-baselines.json` — ✅ nothing to do

Historical records for the "Esta Copa vs história" panel — real values already
(Qatar 2022's 172 goals, USA 94's attendance, Fontaine's 13, etc.).

```json
{ "totalGoals": { "value": 172, "holder": "Qatar 2022" } }
```

A row appears only when **both** sides exist: the baseline entry *and* this Cup's value from an
available model block. So if attendance degrades away, its two history rows go with it. All metrics
read "higher beats the record" — beating one paints the row gold with a "Novo recorde" badge.

---

## Verifying your work

Serve the site locally (Claude Preview `worldcup2026`, port 8126 — `fetch()` of JSON fails on
`file://`, see gotcha #1) and open the **Stats** tab:

1. **Console must be clean.** A view that throws now fails in isolation (it won't blank the app), so
   *check the console* rather than assuming a blank section means "not enough data yet".
2. **Walk the sub-nav:** Visão geral · Seleções · Jogadores · Recordes · Comparador. A missing chip
   means that section's data isn't complete — that's the contract working, not a bug.
3. **Spot-check reconciliation:** open the match modal for a game you just edited and confirm the
   attendance, the card split and "Decidido em".
4. **Check both languages** with the EN/PT toggle.
5. Data changes need **no cache step** — every fetch carries `?t=Date.now()`.

Then: bump `APP_VERSION` in `assets/js/i18n.js` (line 9), commit following the convention in
`how-refresh-data.md`, and push — Dokploy redeploys automatically. Finally, run **Lighthouse against
the deployed URL** (the last unchecked item on the project's acceptance checklist).

---

## What is *not* mock

Worth stating plainly, so nothing real gets "fixed" by accident: all 104 scores, statuses,
penalties, possession and shot counts are **real**, as are `decidedIn`, the yellow-card counts,
`confederation`, `wcDebut`, the stadium coordinates and every historical baseline. The tournament
itself — Spain 1–0 Argentina after extra time — is real and verified.
