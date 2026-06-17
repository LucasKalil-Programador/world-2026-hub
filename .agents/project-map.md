# Project Map — World Cup 2026 Hub

Navigation map of the codebase. Use this to find which file owns a concern before reading code.

> **Status 2026-06-12 (all 12 steps + real-data migration done):** everything works with **real World Cup 2026 data** — all views, bracket interactions, simulation, responsive/a11y pass, favorites, time toggle, challenge, share link, `.ics` export. Remaining: keep `results.json` current, fill `thirdPlaceAssignment` after the group stage (~Jun 27), Lighthouse run + GitHub Pages deploy. Spec source of truth: `world-cup-2026-hub-spec-en.md` + `complement-spec-worldcup2026-en.md` (complement **wins on conflict**).
>
> **Branch note (2026-06-16):** the full post-Cup Stats screen (`.agents/stats-screen-plan.md`, stages A–J) is being built on **`feature/stats-final-screen`** (merges to `master` at the end of the Cup). **Stages A–D + F done** on that branch (degradation engine + fault-tolerant `loadData` + sticky scrollspy sub-nav + flag monogram fallback; verdict-or-aggregate hero + goals-by-round chart; final ranking 1–48 by stage-reached + favorite-row highlight + team record cards; Records section = match records + format-48 debuts band; team comparator with diverging bars). Stage E skipped. Sub-nav live chips: Overview · Teams · Records · Comparator. **Stage E (in-tab results archive) skipped by decision** — the Matches tab stays the single surface for browsing; the "See all matches →" link is kept. `master` keeps the partial Stats tab + daily refreshes. Descriptions below reflect the branch.

---

## File tree

```
worldcup2026/
├── .agents/                              ← Internal documentation for AI agents
│   ├── project-map.md                    This file
│   ├── project-memory.md                 Context, decisions, gotchas
│   ├── stats-screen-plan.md              Plan for the post-tournament "final stats" screen
│   │                                       (NOT implemented — planning only, 2026-06-14)
│   └── TODO.md                           12-step build checklist
│
├── .github/workflows/
│   └── deploy.yml                        CI: FTP deploy to Hostinger on push to master
│                                           (needs FTP_SERVER/USERNAME/PASSWORD secrets)
│ .gitignore                              OS/editor junk
│
├── index.html                            ★ SPA shell — header, nav tabs (Home, Matches,
│                                           Groups, Knockout, Stadiums, Stats), hero, dashboard,
│                                           modal container; loads app.js as ES module.
│                                           <head> has the PWA block (manifest link, theme-color,
│                                           favicons, apple-mobile-web-app-* meta)
│
├── manifest.json                         PWA web app manifest (name/short_name, standalone,
│                                           theme/background #081421, icons[]) — relative paths
│                                           (start_url ".", scope "./") for the subpath deploy
│ favicon.ico                             Root favicon (16+32, from the trophy logo)
│
├── assets/
│   ├── css/
│   │   ├── style.css                     ★ Palette variables, glassmorphism base, layout,
│   │   │                                   components — mobile-first
│   │   ├── bracket.css                   Bracket columns, connectors, highlight states
│   │   ├── stats.css                     Stats tab: hero "pulse", overview cards, goals-by-stage chart
│   │   └── animations.css                Entry (fade-in, slide-up/left) + interaction
│   │                                       (hover-scale/glow, pulse, line-draw)
│   ├── js/
│   │   ├── app.js                        ★ Entry point: loadData() (Promise.all over data/),
│   │   │                                   tab routing + lastTab (active-tab scroll-into-view +
│   │   │                                   edge fades on the scrollable nav), formatMatchTime(), dashboard,
│   │   │                                   clock-driven hero (matchState/findFeaturedMatches +
│   │   │                                   1s heroTick: hybrid JSON+clock, 2h/3h window; stacks
│   │   │                                   simultaneous group-final matches, one shared timer),
│   │   │                                   live data refresh (startResultsPolling: 90s poll of
│   │   │                                   results.json, no-store + ?t, content signature, pauses
│   │   │                                   when tab hidden, stops at FINAL; on change also refetches
│   │   │                                   bracket-config.json; fires `datachange`);
│   │   │                                   loadOptional() = fault-tolerant fetch of the stats screen's
│   │   │                                   optional data layers (absent → silent empty default);
│   │   │                                   trackHeaderHeight() keeps the --header-h CSS var live
│   │   ├── schedule.js                   Match list, filters (incl. occurrence toggle
│   │   │                                   Played/Upcoming via hybrid matchState), search,
│   │   │                                   sort, "My Matches"; 60s clock-tick re-render
│   │   ├── groups.js                     Standings computation (3/1/0, GD, GF) + group tables
│   │   ├── stadiums.js                   Stadium cards + "view matches" cross-link
│   │   ├── bracket.js                    ★ Bracket tree resolution, resolveBracketTeams(),
│   │   │                                   simulation, challenge score, share prediction
│   │   ├── modal.js                      Match detail modal (ARIA dialog)
│   │   ├── storage.js                    localStorage wrapper — wc2026_* keys, auto-JSON
│   │   ├── i18n.js                       EN/PT-BR dicts + t(key), lang toggle
│   │   ├── stats.js                      ★ Stats tab: tournament-to-date aggregates (finished
│   │   │                                   matches only); verdict-or-aggregate hero + overview + goals-by-stage/round +
│   │   │                                   48-team table ranked 1–48 by stage-reached (sortable, # = canonical rank) +
│   │   │                                   favorite-row highlight + team record cards (win streak,
│   │   │                                   champion path) + Records section (biggest win/high-scoring
│   │   │                                   match → modal, format-48 debuts band) + team comparator
│   │   │                                   (A-vs-B diverging bars). SECTIONS registry (graceful-
│   │   │                                   degradation gate: section + chip render only if available,
│   │   │                                   else removed from DOM) + sticky scrollspy sub-nav (anchor
│   │   │                                   chips, hash-safe) + flagImg fallback; imports getBracketTree/getFavorites/openMatchModal. Grows into
│   │   │                                   the post-cup plan (.agents/stats-screen-plan.md, A–J).
│   │   └── calendar.js                   .ics export (RFC 5545, CRLF, Blob download)
│   ├── images/                           Team flag SVGs, stadium placeholders
│   └── icons/                            PWA app icons (from the header trophy logo): icon.svg
│                                           (master + manifest SVG), icon-192/512.png (purpose any),
│                                           icon-maskable-192/512.png (safe-zone padded),
│                                           apple-touch-icon.png (180), favicon-16/32.png, favicon.ico
│
├── data/                                 All content — REAL WC2026 data since 2026-06-12
│   ├── teams.json                        48 real qualifiers: { id, name, flag } (FIFA codes)
│   ├── groups.json                       Official draw { "A": [4 team ids], ... } × 12 (A–L)
│   ├── matches.json                      104 real fixtures; UTC times; ids 1–72 chronological
│   │                                       group games, 73–104 = FIFA match numbers (bracketRef)
│   ├── results.json                      { matchId, homeScore, awayScore, penalties?, status } —
│   │                                       update as the tournament progresses
│   ├── stadiums.json                     16 real venues: { id, name, city, capacity, image, timezone }
│   ├── bracket-config.json               ★ official R32 structure + thirdPlaceAssignment (all null) —
│   │                                       the ONLY file to edit once real 3rd places are known
│   │                                       (slot → allowed-groups table in project-memory.md)
│   └── (optional, NOT yet created)        stats-screen data layers loaded fault-tolerantly by
│                                           loadOptional(): players.json, player-events.json,
│                                           awards.json, keeper-stats.json, curiosities.json,
│                                           all-time-baselines.json — absent = silent empty default
│
├── README.md                             Setup, GitHub Pages deploy, JSON maintenance guide
├── how-update.md                         Real-data migration runbook (mock → real — DONE 2026-06-12)
├── how-refresh-data.md                   ★ Daily refresh runbook during the tournament:
│                                           results.json scores/status + one-time
│                                           thirdPlaceAssignment; everything else frozen
├── world-cup-2026-hub-spec-en.md         Main spec
└── complement-spec-worldcup2026-en.md    Complement spec (precedence on conflict)
```

★ = critical files. Most changes touch one of them.

---

## Key flows

### 1. Data load → render

```
index.html (type="module")
  └─ app.js: loadData() ── Promise.all ──> data/*.json
       ├─ hero + dashboard (app.js)
       ├─ schedule.js  ──┐
       ├─ groups.js      ├── render into tab panels
       ├─ bracket.js   ──┘
       └─ modal.js (on match click, from any view)
```

### 2. Bracket resolution

```
groups.json + results.json
  └─ groups.js: standings (pts 3/1/0 → GD → GF)
       └─ bracket.js: R32 from bracket-config.json
            ├─ type:"group" → standings[ref][pos-1]
            ├─ type:"third" → standings[thirdPlaceAssignment[slot]][2]  (null → placeholder)
            └─ R16…FINAL: sequential pairing of winners (0-1→0, 2-3→1, …)
                 └─ wc2026_simulation overlays user picks (never mutates JSON)
```

### 3. Time display

```
matches.json time (UTC) ── formatMatchTime(match, stadium, mode)
  ├─ mode "local"   → Intl.DateTimeFormat()            (browser tz)
  └─ mode "stadium" → Intl.DateTimeFormat({ timeZone: stadium.timezone })
```

---

## Conventions

### Imports
- ES Modules only (`type="module"`), relative paths, no bundler/CDN.

### Naming
- Team ids: 3-letter uppercase (`MEX`, `BRA`). Knockout match ids: `R32-1`…`R32-16`, `R16-1`…, `QF-1`…, `SF-1`/`SF-2`, `THIRD-PLACE`, `FINAL`.
- localStorage keys prefixed `wc2026_`, accessed only through `storage.js`.

### Content / i18n
- All user-facing strings go through `i18n.js` `t(key)` — never hardcode UI text in HTML/JS.
- Data values (team names, stadium names, cities) come from JSON and are not translated.

---

## Where is each thing?

| Question | Answer |
|---|---|
| Where do I update scores / match status? | `data/results.json` |
| Where do I set the 8 best third-place teams? | `data/bracket-config.json` → `thirdPlaceAssignment` |
| Where do I add/translate a UI label? | `assets/js/i18n.js` (both EN and PT dicts) |
| Where is the standings math? | `assets/js/groups.js` |
| Where are knockout teams resolved (placeholders, TBD)? | `assets/js/bracket.js` → `resolveBracketTeams()` |
| Where is simulation state stored/cleared? | `localStorage` key `wc2026_simulation`, via `assets/js/storage.js` |
| Where do I change colors/theme? | CSS variables at the top of `assets/css/style.css` |
| Where do I add a stadium? | `data/stadiums.json` + image in `assets/images/` |
| Where do I change the app name / install icon / theme color? | `manifest.json` (name/short_name/theme) + `assets/icons/` (regenerate PNGs from `icon.svg`) + PWA `<meta>` in `index.html` `<head>` |
| How do I replace mock data with real WC2026 data? | `how-update.md` (root) — done 2026-06-12; kept as schema reference |
| How do I update scores during the tournament? | `how-refresh-data.md` (root) — daily results.json routine + thirdPlaceAssignment how-to |

---

## Main functions

(Planned signatures from the complement spec — confirmed/updated as each step is implemented.)

| Function | File | Parameters | Returns | Description |
|---|---|---|---|---|
| `loadData` | `assets/js/app.js` | `()` | `Promise<AppData>` | Fetches all `data/*.json` in parallel, caches in memory |
| `formatMatchTime` | `assets/js/app.js` | `(match, stadium, mode)` | `string` | UTC → display time; `mode` is `"local"` or `"stadium"` |
| `matchState` | `assets/js/app.js` | `(match, result, now)` | `'over' \| 'live' \| 'upcoming'` | Hybrid JSON+clock state (finished/live win; else clock advances at kickoff/kickoff+window). Used by the hero **and** the schedule occurrence filter / "Awaiting result" chip |
| `get` / `set` | `assets/js/storage.js` | `(key, fallback)` / `(key, value)` | `any` / `void` | localStorage wrapper, auto JSON parse/stringify |
| `t` | `assets/js/i18n.js` | `(key)` | `string` | Translated UI string for current lang |
| `resolveBracketTeams` | `assets/js/bracket.js` | `(matchOrRef)` | `{ home, away }` of `{ team, label }` | Display slots for any match (group or knockout); reused by schedule/modal/filters |
| `getBracketTree` | `assets/js/bracket.js` | `()` | `{ rounds, third, nodesByRef, champion }` | Cached resolved bracket tree |
| `invalidateBracket` | `assets/js/bracket.js` | `()` | `void` | Drop the cached tree (simulation overlay, step 9) |
| `calculateChallengeScore` | `assets/js/bracket.js` | `(simulation, results, bracketTree)` | `{ correct, total, byPhase }` | Compares user picks vs finished results |
| `getShareableLink` | `assets/js/bracket.js` | `()` | `string` | Current URL + `?prediction=base64(simulation)` |
| `loadPredictionFromURL` | `assets/js/bracket.js` | `()` | `void` | Decodes, validates, confirms before overwriting local simulation |
| `toggleFavorite` | `assets/js/storage.js` | `(teamId)` | `void` | Add/remove team in `wc2026_favorites` |
| `computeStandings` | `assets/js/groups.js` | `()` | `{ [letter]: Row[] }` | Sorted standings per group, finished matches only |
| `isGroupFinished` | `assets/js/groups.js` | `(letter)` | `boolean` | All 6 group matches have status finished |
| `navigateTo` | `assets/js/app.js` | `(tab)` | `void` | Programmatic tab switch (cross-view links) |
| `setStadiumFilter` | `assets/js/schedule.js` | `(stadiumName)` | `void` | Reset filters + show one stadium's matches |
| `getFavoriteMatches` | `assets/js/bracket.js` | `(matches, favorites)` | `Match[]` | Matches involving favorited teams (resolved slots); used by schedule |
| `calculateChallengeScore` | `assets/js/bracket.js` | `(simulation, results, bracketTree)` | `{ correct, total, byPhase }` | Picks vs real finished knockout results |
| `getShareableLink` / `loadPredictionFromURL` | `assets/js/bracket.js` | `()` | `string` / `void` | base64 `?prediction=` export/import with validation + confirm |
| `exportMatchToICS` | `assets/js/calendar.js` | `(match, stadium)` | `void` | RFC 5545 VEVENT (UTC, 2h, CRLF, escaped TEXT), Blob download |
