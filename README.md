# World Cup 2026 Hub

A static, single-page hub for the FIFA World Cup 2026 (Mexico · USA · Canada, 48 teams):
full match schedule, live group standings, an interactive knockout bracket with a
prediction/simulation mode, and a stadium guide. Built with vanilla HTML/CSS/JS —
no backend, no framework, no build step. All content lives in JSON files.

**UI languages:** English / Português (toggle in the header, auto-detected on first visit).

---

## Features

- **Schedule** — all 104 matches with filters (date, group, phase, team, stadium),
  free-text search, date sorting, and a "My matches" favorites filter.
- **Groups** — standings computed live from results (3/1/0 points, goal difference,
  goals for), qualification highlights.
- **Knockout bracket** — generated dynamically from standings + `bracket-config.json`;
  hover highlights a match's full path; mouse-wheel/pinch zoom; drag to pan.
- **Simulation mode** — pick winners and scores for unplayed knockout matches; picks
  propagate through the rounds, persist locally, and never touch the JSON data.
- **Bracket challenge** — once real knockout results land, your saved picks are scored
  ("X of Y picks correct", per phase).
- **Share prediction** — copy a link that carries your bracket picks (base64 in the URL).
- **Favorites** — star teams anywhere; their matches get highlighted across the app.
- **Time zones** — show kickoff times in your local time or the stadium's time.
- **Add to calendar** — download any match as an RFC 5545 `.ics` file.
- **Match modal** — details for every match, with space reserved for future stats.
- Responsive (mobile / tablet / desktop), keyboard-accessible, honors
  `prefers-reduced-motion`.

## Run locally

```sh
python -m http.server
# open http://localhost:8000
```

Any static file server works. A server **is required** — opening `index.html` directly
from disk fails because browsers block `fetch()` of local JSON files.

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. Repository **Settings → Pages → Source**: deploy from branch, `main` / root.
3. Done — the site works under `https://<user>.github.io/<repo>/` because every
   asset and data path in the code is **relative** (never start a path with `/`
   when editing).

## Project structure

```
worldcup2026/
├── index.html              SPA shell (header, tabs, hero, panels, modal root)
├── assets/
│   ├── css/                style.css · bracket.css · animations.css
│   ├── js/                 app.js (entry) · schedule.js · groups.js · bracket.js
│   │                       modal.js · stadiums.js · storage.js · i18n.js · calendar.js
│   └── images/             flags/*.svg · stadiums/*.svg (placeholders)
└── data/                   ← the only thing you edit to maintain the site
    ├── teams.json          48 teams: { id, name, flag }
    ├── groups.json         { "A": [4 team ids], … } × 12
    ├── matches.json        104 matches (UTC times; knockout uses bracketRef)
    ├── results.json        one entry per match: scores + status (+ penalties)
    ├── stadiums.json       name, city, capacity, image, IANA timezone
    └── bracket-config.json Round-of-32 slots + best-third assignment
```

## Maintaining the data

> The current files contain **mock data** (real country names, fictional results)
> so every feature can be exercised. Replace them with real data as the
> tournament unfolds — no code changes needed.

### Updating a result

Edit the match's entry in `data/results.json`:

```json
{ "matchId": 74, "homeScore": 1, "awayScore": 1,
  "penalties": { "home": 4, "away": 3 }, "status": "finished" }
```

- `status`: `scheduled` → `live` → `finished`. Standings and the bracket only
  count `finished` matches.
- `penalties` is optional — only for knockout draws.

### Adding / changing matches

`data/matches.json`. **All times are UTC** (the UI converts to local or stadium
time). Group matches carry `homeTeam`/`awayTeam`; knockout matches carry a
`bracketRef` (`R32-1`…`R32-16`, `R16-1`…, `QF-…`, `SF-…`, `THIRD-PLACE`, `FINAL`)
and their teams are resolved automatically.

### After the group stage: fill the third-place slots

`data/bracket-config.json` is **the only file to edit** once the 8 best
third-placed teams are known. Map each slot to a group letter:

```json
"thirdPlaceAssignment": { "1": "C", "2": "A", "3": null, … }
```

A slot's team becomes `standings[group][3rd]`. Slots left `null` show a
"Best 3rd #N" placeholder. The 16 `round32` entries define the bracket order
(array position = bracket position) — they normally never change.

### Teams, stadiums, images

- `teams.json` — `flag` is a path relative to `assets/images/` (e.g. `flags/bra.svg`).
- `stadiums.json` — `timezone` must be a valid IANA name (e.g. `America/Mexico_City`);
  it drives the "stadium time" display and stays correct across DST.
- Replace the placeholder SVGs in `assets/images/` with real artwork keeping the
  same file names (or update the JSON paths).

### UI labels (EN/PT)

Every UI string goes through `t(key)` — add new labels to **both** dictionaries
in `assets/js/i18n.js`. Data values (team/stadium names) are not translated.

## Local storage

| Key | Content |
|---|---|
| `wc2026_simulation` | `{ "R32-6": { "winner": "FRA", "score": "2-1" }, … }` |
| `wc2026_favorites` | `["BRA", "MEX"]` |
| `wc2026_prefs` | `{ "lang": "en"\|"pt", "timeMode": "local"\|"stadium", "lastTab": "bracket" }` |

Clearing site data resets picks, favorites, and preferences — the JSON content
is never modified by the app.

## Acceptance criteria (spec §18)

- [x] All matches are loaded via JSON
- [x] All results are loaded via JSON
- [x] The bracket is generated dynamically (config + standings + winner pairing)
- [x] Works on GitHub Pages (all paths relative, no server-side code)
- [x] Works on desktop and mobile (≤767 / 768–1439 / 1440+ breakpoints)
- [x] Allows knockout-stage simulation (persisted, never mutates JSON)
- [x] Smooth animations (entry, hover, bracket line-draw; reduced-motion safe)
- [x] No backend dependency — fully static, works offline after first load

**Performance:** total JS ≈ 74 KB across 9 ES modules (budget: < 300 KB), no
external dependencies, no blocking third-party requests.

## Roadmap (spec §19)

PWA install, dark/light theme, real-time statistics, results API, FIFA ranking,
World Cup history, team comparison, push notifications.
