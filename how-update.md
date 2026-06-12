# How to Update — Real Data Migration Guide

This document is a self-contained runbook (and can be pasted as a prompt to an AI
agent) for replacing the **mock data** currently in `data/*.json` with **real FIFA
World Cup 2026** data. The app reads these files at runtime — if the JSON keeps the
exact same shape, **no code changes are needed**.

---

## Ground rules — do not break these

1. **Schema is frozen.** Every object key, every id format, every enum value
   listed below must stay exactly as documented. The JS reads by exact field
   name/value (e.g. `phase === "Group A"`, `status === "finished"`).
2. **Team ids are 3-letter uppercase codes** (FIFA/IOC style: `MEX`, `BRA`, `ARG`).
   Whatever code you pick for a team must be used **identically** across
   `teams.json`, `groups.json`, and every `homeTeam`/`awayTeam` in `matches.json`.
3. **All match `date`/`time` are UTC**, format `"YYYY-MM-DD"` / `"HH:MM"` (24h).
   The UI converts to local/stadium time at render time — do not pre-convert.
4. **Paths stay relative** (`flags/xxx.svg`, `stadiums/xxx.svg`) — required for
   GitHub Pages.
5. **Code files, localStorage keys, and i18n keys are out of scope.** This task
   only touches files inside `data/` (plus optionally `assets/images/*`).
6. Work inside the **running preview** (`python -m http.server` / Claude Preview,
   port 8126) and hard-reload after each file edit — `fetch()` doesn't work on
   `file://` and JSON is aggressively cached by the browser (see gotcha #5 in
   `.agents/project-memory.md`).

---

## Where to find real data

Use web search/fetch against authoritative sources, e.g.:

- `https://www.fifa.com` — official site: confirmed teams, groups, fixtures, results, venues.
- `https://en.wikipedia.org/wiki/2026_FIFA_World_Cup` and its sub-articles
  (groups, schedule, venues, squads) — usually the fastest single reference,
  kept current during the tournament.

Cross-check at least two sources for the schedule and current results, since
the tournament is live and Wikipedia/FIFA update at slightly different speeds.

---

## Order of operations

Each step depends on ids/names introduced by the previous one. Don't skip ahead.

1. **`stadiums.json`** — confirm the host venues (names, cities, capacities, timezones).
2. **`teams.json`** — confirm the final 48 qualified teams and their codes.
3. **`groups.json`** — confirm the official group draw (A–L, 4 teams each), using ids from step 2.
4. **`bracket-config.json` → `round32`** — confirm the official Round-of-32 draw structure (fixed pre-tournament, rarely changes).
5. **`matches.json`** — full 104-match real schedule (dates/times/venues, `homeTeam`/`awayTeam` or `bracketRef`).
6. **`results.json`** — real scores/status as of today; future matches stay `scheduled`.
7. **`bracket-config.json` → `thirdPlaceAssignment`** — fill in once group-stage standings make it determinable (see step 7 detail below); leave `null` for slots not yet known.
8. **`assets/images/`** (optional) — swap placeholder SVGs for real flags/stadium art, same filenames or update the JSON path.

---

## File-by-file reference

### 1. `data/stadiums.json` — array, currently 30 entries

```json
{ "id": 1, "name": "Estadio Azteca", "city": "Mexico City", "capacity": 87000,
  "image": "stadiums/azteca.svg", "timezone": "America/Mexico_City" }
```

- `id`: integer, unique, referenced by nothing else (informational only — `matches.json` links by `name`/`city`, not `id`).
- `timezone`: valid IANA name — drives "stadium time" mode and must stay DST-correct.
- `image`: path relative to `assets/images/`.

**Decision point:** the official 2026 tournament uses **16 venues** (3 in Mexico,
11 in USA, 2 in Canada), but this file currently lists **30** (the original bid
shortlist). Recommendation: trim to the 16 confirmed match venues so every row
in `stadiums.json` is actually used by `matches.json` — but confirm with the user
first if they'd rather keep the extra 14 as a broader "host city guide".

### 2. `data/teams.json` — array, 48 entries

```json
{ "id": "MEX", "name": "Mexico", "flag": "flags/mex.svg" }
```

- `id`: 3-letter uppercase code, **unique**, used as the cross-file key everywhere.
- `flag`: path relative to `assets/images/`, convention `flags/<lowercase id>.svg`.
- `name`: display name, shown as-is (not translated — i18n covers UI strings only).

### 3. `data/groups.json` — object, keys `"A"`–`"L"`, each an array of exactly 4 team ids

```json
{ "A": ["MEX", "SUI", "KOR", "JAM"], "B": [...], ..., "L": [...] }
```

- 12 groups × 4 teams = 48 — must cover every id in `teams.json` exactly once.
- Order within the array doesn't affect standings (sorted by points/GD/GF), but
  conventionally keep host nation first where applicable.

### 4. `data/bracket-config.json`

```json
{
  "round32": [
    { "id": "R32-1", "home": { "type": "group", "ref": "A", "pos": 1 },
                      "away": { "type": "third", "slot": 1 } },
    ...
  ],
  "thirdPlaceAssignment": { "1": null, "2": null, ..., "8": null }
}
```

- `round32`: 16 entries, `id` = `"R32-1"`..`"R32-16"` (order = bracket position,
  feeds `R16-1`..`R16-8` by sequential pairing `0-1→0, 2-3→1, …`, then `QF`, `SF`,
  `FINAL`, with `THIRD-PLACE` from the two `SF` losers).
  - `home`/`away` each are either:
    - `{ "type": "group", "ref": "<A-L>", "pos": 1 | 2 }` → group winner/runner-up, or
    - `{ "type": "third", "slot": 1-8 }` → one of the 8 best third-placed teams.
  - **Only edit `ref`/`pos`/`slot` values** if the *official* Round-of-32 draw
    structure differs from what's encoded here — don't change `id` values or
    array order (that's the bracket's visual/geometric layout, tied to the CSS).
- `thirdPlaceAssignment`: maps slot `"1"`–`"8"` → group letter `"A"`–`"L"` or
  `null`. Fill in **step 7**, after the group stage actually finishes, following
  FIFA's official "ranking of third-placed teams" rules. Until a slot is filled,
  `resolveBracketTeams()` shows a "Best 3rd #N" placeholder — that's expected and
  correct for slots not yet determined.

### 5. `data/matches.json` — array, 104 entries, ids `1`–`104`

ID ranges (keep this layout — `resultByMatchId` is keyed by `id`, not position,
but contiguous chronological ids match the existing convention):

| ids | phase | count |
|---|---|---|
| 1–72 | `"Group A"` … `"Group L"` (6 matches each) | 72 |
| 73–88 | `"Round of 32"` | 16 |
| 89–96 | `"Round of 16"` | 8 |
| 97–100 | `"Quarterfinals"` | 4 |
| 101–102 | `"Semifinals"` | 2 |
| 103 | `"Third Place"` | 1 |
| 104 | `"Final"` | 1 |

**Group-stage match:**

```json
{ "id": 1, "phase": "Group A", "date": "2026-06-11", "time": "16:00",
  "stadium": "Estadio Azteca", "city": "Mexico City",
  "homeTeam": "MEX", "awayTeam": "SUI" }
```

- `homeTeam`/`awayTeam` **must** be 2 of the 4 ids listed for that group in
  `groups.json` (see integrity rule #1 below — violating this crashes the
  standings table).
- `stadium`/`city` must match a `name`/`city` pair in `stadiums.json` exactly
  (case-sensitive string match used for cross-links and the stadiums view).

**Knockout match:**

```json
{ "id": 74, "phase": "Round of 32", "date": "2026-06-29", "time": "16:00",
  "stadium": "Gillette Stadium", "city": "Boston", "bracketRef": "R32-2" }
```

- No `homeTeam`/`awayTeam` — teams are resolved at runtime from standings +
  `bracket-config.json`.
- `bracketRef` must be exactly one of: `R32-1`..`R32-16`, `R16-1`..`R16-8`,
  `QF-1`..`QF-4`, `SF-1`, `SF-2`, `THIRD-PLACE`, `FINAL` — each value used **once**.

### 6. `data/results.json` — array, 104 entries, one per match id

```json
{ "matchId": 1, "homeScore": 1, "awayScore": 1, "status": "finished" }
{ "matchId": 61, "homeScore": 1, "awayScore": 0, "status": "live" }
{ "matchId": 62, "homeScore": null, "awayScore": null, "status": "scheduled" }
{ "matchId": 74, "homeScore": 1, "awayScore": 1, "status": "finished",
  "penalties": { "home": 4, "away": 3 } }
```

- `status`: `"scheduled"` (not started, scores `null`) → `"live"` (in progress,
  real scores) → `"finished"` (full-time).
- `penalties`: **optional**, only on knockout matches finished level after
  extra time — `homeScore`/`awayScore` stay the 90+30-min score (can be equal).
- Set this from real, up-to-date results as of "today". Anything not yet played
  stays `"scheduled"` with `null`/`null` — this is the normal/expected state for
  future fixtures, not a placeholder to "fix".
- Only `"finished"` matches feed standings (`groups.js`) and bracket resolution
  (`bracket.js`) — a `"live"` match's score does **not** affect either.

---

## Cross-file integrity checklist

Run through this after editing, **before** trusting the preview:

1. **Every Group-stage `homeTeam`/`awayTeam` in `matches.json` is one of the 4
   ids in `groups.json[<that group letter>]`.** If not, `computeStandings()`
   throws (`rows.get(...)` is `undefined`) and the Groups tab breaks entirely.
2. **`groups.json` covers all 48 `teams.json` ids exactly once**, 4 per group, A–L.
3. **`results.json` has exactly one entry per `matches.json` id, 1–104, no gaps/dupes.**
4. **Every `bracketRef` value (`R32-1`..`R32-16`, `R16-1`..`R16-8`, `QF-1`..`QF-4`,
   `SF-1`, `SF-2`, `THIRD-PLACE`, `FINAL`) appears exactly once** across the 32
   knockout entries in `matches.json`.
5. **`matches.json`'s `stadium`/`city` strings exist in `stadiums.json`** (exact
   string match — used by `setStadiumFilter` cross-links).
6. **`bracket-config.json.round32[i].home/away` group `ref` values are valid
   letters A–L** and `pos`/`slot` are in range (`pos`: 1-2, `slot`: 1-8), each
   `slot` 1-8 used exactly once across the 16 entries.
7. **No team id appears in two different groups.**

---

## Optional: real artwork

`assets/images/flags/*.svg` and `assets/images/stadiums/*.svg` are currently
placeholders. To replace:

- Keep the **same filenames** referenced by `teams.json`/`stadiums.json` (e.g.
  `flags/mex.svg`), or update the `flag`/`image` JSON value if you use different
  names.
- SVG is not required by the code — any image format works as long as the path
  in JSON matches the actual file extension.

---

## Verification steps

1. `preview_start` (or `python -m http.server` from the project root), then hard
   reload (`location.reload()` after `fetch(..., { cache: 'reload' })`, or
   DevTools "Empty Cache and Hard Reload").
2. **Home** — hero shows the right live/next match; dashboard counts look sane.
3. **Matches** — spot-check a few real fixtures (date/time/venue), filters
   (group/phase/team/stadium) still populate correctly.
4. **Groups** — all 12 tables show real teams, standings order matches a
   real-world source for finished matchdays.
5. **Knockout** — R32 slots show real teams where standings allow, placeholders
   ("Group X Winner", "Best 3rd #N") elsewhere; hover-path highlight and zoom
   still work.
6. **Stadiums** — cards match the trimmed/confirmed venue list; "view matches"
   cross-link filters correctly.
7. Toggle **EN/PT** and **local/stadium time** — no console errors, times shift
   correctly across at least two different stadium timezones.

---

## After finishing

Per this project's conventions, update `.agents/`:

- Check off the relevant items in `.agents/TODO.md` section 6 (Post-launch).
- Append a dated entry to `.agents/project-memory.md` documenting: data source
  used, the stadiums 30→16 decision (and final list if trimmed), and the
  `thirdPlaceAssignment` status (filled / partially filled / still null).
