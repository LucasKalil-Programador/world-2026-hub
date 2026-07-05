# Developer guide — World Cup 2026 Hub

Everything you need to run, understand, deploy and maintain the site. For a non-technical overview of
what the project *is*, see the [README](README.md).

The app is a **static single-page app**: one `index.html`, vanilla ES-module JavaScript, and JSON
files as the only "database". There is **no backend, no build step, no bundler, and no framework**.
You maintain the site by editing JSON — the code never needs to change to update scores or teams.

---

## Run locally

```sh
python -m http.server
# then open http://localhost:8000
```

Any static file server works. A server **is required** — opening `index.html` directly from disk
fails, because browsers block `fetch()` of local JSON files (`file://`).

---

## Project structure

```
worldcup2026/
├── index.html              SPA shell (header, tabs, hero, panels, modal root)
├── manifest.json           PWA manifest · favicon.ico
├── assets/
│   ├── css/                style.css · bracket.css · stats.css · animations.css
│   ├── js/                 app.js (entry) · schedule.js · groups.js · bracket.js
│   │                       stats.js · modal.js · stadiums.js · storage.js
│   │                       i18n.js · calendar.js
│   ├── images/             flags/*.svg · stadiums/*.svg
│   └── icons/              PWA app icons + favicons
└── data/                   ← the only thing you edit to maintain the site
    ├── teams.json          48 teams: { id, name, flag }
    ├── groups.json         { "A": [4 team ids], … } × 12
    ├── matches.json        104 matches (UTC times; knockout uses bracketRef)
    ├── results.json        one entry per match: scores + status (+ penalties, + optional stats)
    ├── stadiums.json       name, city, capacity, image, IANA timezone
    └── bracket-config.json Round-of-32 slots + best-third assignment
```

---

## Maintaining the data

> The data is **real World Cup 2026 data**, refreshed as the tournament progresses. Everything the
> site shows is derived from the six `data/*.json` files — no code changes required.
>
> The day-to-day refresh routine is documented in
> [`how-refresh-data.md`](how-refresh-data.md); the original mock → real migration is kept as a schema
> reference in [`how-update.md`](how-update.md).

### Updating a result

Edit the match's entry in `data/results.json`:

```json
{ "matchId": 74, "homeScore": 1, "awayScore": 1,
  "penalties": { "home": 4, "away": 3 }, "status": "finished" }
```

- `status`: `scheduled` → `live` → `finished`. Standings and the bracket only count `finished` matches.
- `penalties` is optional — only for knockout matches decided on penalties.

### Adding / changing matches

`data/matches.json`. **All times are UTC** (the UI converts to local or stadium time). Group matches
carry `homeTeam`/`awayTeam`; knockout matches carry a `bracketRef`
(`R32-1`…`R32-16`, `R16-1`…, `QF-…`, `SF-…`, `THIRD-PLACE`, `FINAL`) and their teams are resolved
automatically from the standings.

### After the group stage: fill the third-place slots

`data/bracket-config.json` is **the only file to edit** once the 8 best third-placed teams are known.
Map each slot to a group letter (per FIFA's official combination table):

```json
"thirdPlaceAssignment": { "1": "D", "2": "F", "3": "B", "…": "…" }
```

A slot's team becomes `standings[group][3rd]`. Slots left `null` show a "Best 3rd #N" placeholder. The
16 `round32` entries define the bracket order (array position = bracket position) — they normally
never change.

### Teams, stadiums, images

- `teams.json` — `flag` is a path relative to `assets/images/` (e.g. `flags/bra.svg`).
- `stadiums.json` — `timezone` must be a valid IANA name (e.g. `America/Mexico_City`); it drives the
  "stadium time" display and stays correct across DST.
- Replace the SVGs in `assets/images/` with new artwork keeping the same file names (or update the
  JSON paths).

### UI labels (EN / PT)

Every user-facing string goes through `t(key)` — add new labels to **both** dictionaries in
`assets/js/i18n.js`. Data values (team/stadium names, cities) come from JSON and are **not**
translated.

---

## Local storage

The app never modifies the JSON data. User state lives in the browser under `wc2026_*` keys:

| Key | Content |
|---|---|
| `wc2026_simulation` | `{ "R32-6": { "winner": "FRA", "score": "2-1" }, … }` |
| `wc2026_favorites` | `["BRA", "MEX"]` |
| `wc2026_prefs` | `{ "lang": "en"\|"pt", "timeMode": "local"\|"stadium", "lastTab": "bracket", … }` |

Clearing site data resets picks, favourites and preferences.

---

## Deployment

The live site is deployed automatically to **Dokploy** (self-hosted Docker + Traefik on a VPS) by
GitHub Actions ([`.github/workflows/dokploy-deploy.yml`](.github/workflows/dokploy-deploy.yml)) on
every push to `master`, and is served at
**[app.lucaskalil.com/worldcup2026](https://app.lucaskalil.com/worldcup2026)**.

- The image is built from the root [`Dockerfile`](Dockerfile) (nginx, no build step) with
  [`nginx.conf`](nginx.conf); [`.dockerignore`](.dockerignore) keeps docs/dev/CI out of the build
  context, so only `index.html`, `assets/` and `data/` end up in the image. In Dokploy the app serves
  under the `/worldcup2026` subpath with **Strip Path = OFF**.
- The Dokploy dashboard isn't publicly reachable, so the workflow SSHes into the VPS and calls
  Dokploy's deploy webhook on localhost. It needs the repository secrets `VPS_HOST`, `VPS_USER`,
  `VPS_SSH_KEY`, `VPS_SSH_PORT` and `DOKPLOY_DEPLOY_WEBHOOK`.

Because every asset and data path in the code is **relative** (never starting with `/`), the same
folder also works unchanged on **GitHub Pages** or any other static host — just publish the directory.
When editing paths, always keep them relative.

---

## Acceptance criteria (spec §18)

- [x] All matches are loaded via JSON
- [x] All results are loaded via JSON
- [x] The bracket is generated dynamically (config + standings + winner pairing)
- [x] Works on a static host (all paths relative, no server-side code)
- [x] Works on desktop and mobile (≤767 / 768–1100 / 1100+ breakpoints)
- [x] Allows knockout-stage simulation (persisted, never mutates JSON)
- [x] Smooth animations (entry, hover, bracket line-draw; reduced-motion safe)
- [x] No backend dependency — fully static

**Performance:** total JS ≈ 74 KB across the ES modules (budget: < 300 KB), no external dependencies,
no blocking third-party requests.

---

## Roadmap (spec §19)

Dark/light theme, real-time statistics via a results API, FIFA ranking integration, World Cup history,
expanded player-level stats, and push notifications. A service-worker offline mode (PWA "Tier 2") is
designed but deliberately deferred — see [`.agents/issues.md`](.agents/issues.md).

---

## Internal documentation

Deeper architecture notes, decisions and gotchas live in the [`.agents/`](.agents/) folder
(`project-map.md`, `project-memory.md`, `stats-screen-plan.md`, `issues.md`, `TODO.md`). Read those
before making significant changes.
