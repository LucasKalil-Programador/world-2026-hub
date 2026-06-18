# How to Refresh Data — Daily Tournament Updates

Self-contained runbook (can be pasted as a prompt to an AI agent) for keeping the
hub current **during** the World Cup (2026-06-11 → 2026-07-19). The full mock→real
migration is done (2026-06-12, see `.agents/project-memory.md`) — this guide covers
only what changes **day after day** from here on.

---

## TL;DR — what changes vs what never changes

| File | Changes? | When |
|---|---|---|
| `data/results.json` | ✅ **Daily** | After every matchday — scores + status |
| `data/bracket-config.json` → `thirdPlaceAssignment` | ✅ **Once** | After the group stage ends (last matches ~2026-06-27, ids 61–72) |
| `data/matches.json` | ⚠️ Rare | Only if FIFA officially reschedules a kickoff/venue |
| `data/stadiums.json` | ❌ Never | Venues are fixed for the whole tournament |
| `data/teams.json` | ❌ Never | The 48 qualifiers are final |
| `data/groups.json` | ❌ Never | The draw is final |
| `data/bracket-config.json` → `round32` | ❌ Never | Official bracket structure, already encoded |
| `assets/`, code, `index.html` | ❌ Never | Data-only updates by design |

If you find yourself editing anything in the ❌ rows, stop — something is wrong.

---

## Daily routine: update `results.json`

### 1. Find which matches happened since the last update

Match ids in `matches.json`: **1–72 = group stage, chronological by UTC kickoff**;
**73–104 = knockout, FIFA official match numbers**. Look up matches by `date`
(UTC — a 9 p.m. PDT game lands on the *next* UTC day) and team ids, never assume
id ranges by group.

```
Group stage runs Jun 11–28 (UTC dates) · R32 Jun 28–Jul 4 · R16 Jul 4–7
QF Jul 9–12 · SF Jul 14–15 · 3rd place Jul 18 · Final Jul 19   (UTC dates)
```

### 2. Get real scores — never invent

Web-search each played match and cross-check **two sources** (Wikipedia group/
knockout articles update fast; ESPN/FOX/olympics.com as second source). If a
result can't be confirmed in two sources, leave it `scheduled` and tell the user.

### 3. Edit the entries

Keep the exact schema — only flip these fields:

```json
{ "matchId": 4, "homeScore": null, "awayScore": null, "status": "scheduled" }   ← before
{ "matchId": 4, "homeScore": 2, "awayScore": 1, "status": "finished" }          ← after full-time
{ "matchId": 5, "homeScore": 1, "awayScore": 0, "status": "live" }              ← only if in progress right now
```

Rules:
- `status` enum is exactly `"scheduled"` | `"live"` | `"finished"` — nothing else.
- Only `finished` feeds standings and bracket resolution; `live` is display-only.
- **Knockout matches only:** if decided on penalties, keep `homeScore`/`awayScore`
  as the 90+30-min score (can be equal) and add
  `"penalties": { "home": 4, "away": 3 }`. Never add `penalties` to group matches.
- Never delete/reorder entries; never change a `matchId`.

> ⚠️ First pending item: **match id 4 (USA vs Paraguay)** kicked off 2026-06-13
> 01:00 UTC and is still `scheduled` in the data.

### 4. Bump the cache-busting version

Any time `data/*.json` changes, update `DATA_VERSION` in `assets/js/app.js`
(top of `loadData()`) to today's date, e.g. `'2026-06-14-rev1'`. This is
appended as `?v=...` to every data fetch — without bumping it, visitors on
Hostinger may keep getting yesterday's cached `results.json`. If you edit
data more than once in the same day, increment the `revN` suffix.

---

## One-time: `thirdPlaceAssignment` (after ~Jun 27–28)

When all 72 group matches are `finished`, FIFA publishes the ranking of
third-placed teams and which group's 3rd goes to which R32 slot. Fill
`data/bracket-config.json`:

```json
"thirdPlaceAssignment": { "1": "C", "2": "G", ... }   // slot → group LETTER, not team id
```

Each slot only accepts certain groups (official draw constraint — use FIFA's
published allocation, it will respect this):

| Slot | Feeds (FIFA match) | Allowed groups |
|---|---|---|
| 1 | M74 (vs Winner E) | A/B/C/D/F |
| 2 | M77 (vs Winner I) | C/D/F/G/H |
| 3 | M81 (vs Winner D) | B/E/F/I/J |
| 4 | M82 (vs Winner G) | A/E/H/I/J |
| 5 | M79 (vs Winner A) | C/E/F/H/I |
| 6 | M80 (vs Winner L) | E/H/I/J/K |
| 7 | M85 (vs Winner B) | E/F/G/I/J |
| 8 | M87 (vs Winner K) | D/E/I/J/L |

Each group letter appears in **at most one** slot. Slots without a published
assignment stay `null` (the UI shows "Best 3rd #N" — that's correct).

Partially-finished group stage: you can fill slots early only if FIFA has; do
not derive assignments yourself.

---

## Rare: schedule changes in `matches.json`

Only if FIFA officially changes a kickoff time or venue:
- `date`/`time` are **UTC** — convert from the announced local time yourself.
- `stadium`/`city` must exactly match a `name`/`city` pair in `stadiums.json`.
- Never touch `id`, `phase`, `homeTeam`/`awayTeam`, `bracketRef`.

Known caveat to re-verify near Jul 6: **match 94** (R16, Lumen Field) kickoff was
single-source (Wikipedia 17:00 PDT vs one ESPN summary implying 14:00 PDT).

---

## Verify after every refresh

1. Quick integrity scan of `results.json`: exactly 104 entries, `matchId` 1–104
   unique, every entry has a valid `status`, `penalties` only on ids 73–104.
2. Serve the app (Claude Preview `worldcup2026`, port 8126 — never `file://`),
   hard-reload with cache bypass (browser caches JSON aggressively):
   ```js
   Promise.all(['data/results.json','data/bracket-config.json']
     .map(f => fetch(f, { cache: 'reload' }))).then(() => location.reload())
   ```
3. Spot-check: **Groups** standings of the groups that played vs a real-world
   table; **Home** hero shows the right live/next match; after
   `thirdPlaceAssignment` is filled, **Knockout** R32 shows real team names.
4. Console must stay free of errors.

## Commit convention (standardized)

Every `/update-worldcup` run produces **two commits**, in this order, with these
exact subject formats — do not improvise per run.

### 1. Data commit — `results.json` + `DATA_VERSION` (+ `bracket-config.json` when the third-place fill happens)

- **One match:**
  ```
  data: update DD/MM/YYYY HH:MM HOMExAWAY HxA
  ```
  e.g. `data: update 15/06/2026 18:00 BELxEGY 1x1`
- **Multiple matches:** short subject, one body line per match:
  ```
  data: update DD/MM/YYYY — N jogos

  HH:MM HOMExAWAY HxA
  HH:MM HOMExAWAY HxA
  ```

Rules:
- `DD/MM/YYYY` and `HH:MM` are the match's **UTC** date/kickoff (same UTC used in
  `matches.json` — a 9 p.m. PDT game is the next UTC day).
- Team codes are the 3-letter uppercase ids; separators are lowercase `x`
  (`HOMExAWAY` and `HxA`).
- **Penalties** (knockout only): append `(pen HxA)`, e.g.
  `data: update 04/07/2026 20:00 BRAxARG 1x1 (pen 4x3)`.
- The one-time `thirdPlaceAssignment` fill rides in the same data commit; note it
  in the body line (`+ thirdPlaceAssignment filled`).

### 2. Docs commit — `.agents/` memory + TODO log

```
docs: log daily refresh DD/MM/YYYY
```

`.agents/` is excluded from the FTP deploy, so keeping it a separate commit keeps
the data commit (the one that actually changes the live site) a clean diff.

> The previous habit of letting `/git-semantic-commit` invent a fresh subject
> each run (`data: update match 13 result and stats`, `data: update match 12 …`)
> is **retired** — use the formats above verbatim.

## After finishing

Update `.agents/project-memory.md` → **Current State** section (do **not** append a new dated
section — that habit bloated the file and duplicated git):

1. Refresh the header line: data through match id N, finished count, `DATA_VERSION`, `APP_VERSION`.
2. Update the **"Recent refreshes (rolling — keep the last 3)"** list: add today's entry at the top
   and **delete the oldest** so only the last 3 dated entries remain. Each entry is one compact line
   (`DD/MM or YYYY-MM-DD (revN) — matches X–Y: HOME H–A AWAY, …`); per-match sources live in the git
   commit, not here.
3. Adjust **Pending / next** if a milestone was reached (e.g. `thirdPlaceAssignment` filled).
4. Tick anything completed in `.agents/TODO.md` §6.

Confirm `DATA_VERSION` in `assets/js/app.js` was bumped to today's date (step 4 above) before
committing with the two commits above. Only **durable** new facts (a new gotcha, a decision) go into
the other sections of `project-memory.md` — never a daily refresh log.
