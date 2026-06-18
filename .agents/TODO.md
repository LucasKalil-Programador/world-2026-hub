# TODO — World Cup 2026 Hub

Checklist of what needs to be done. Organized by build step (approved plan, one approval gate per step).

Use checkboxes to track progress. Items marked **🔴 BLOCKER** prevent release; **🟡 IMPORTANT** must be done but don't block; **🟢 OPTIONAL** can be deferred.

---

## 1. Foundation

### 🔴 BLOCKER
- [x] ~~Step 0 — Project memory: `.agents/` + auto-memory pointer + `git init`~~
- [x] ~~Step 1 — File structure + mock data (48 teams, 12 groups, 104 matches UTC, ~30 stadiums, `bracket-config.json` with null third-place slots, mixed results)~~
- [x] ~~Step 2 — Base layout: SPA shell, header + nav, hero (next match + countdown), dashboard cards, `style.css` palette, `app.js` loadData/routing, `storage.js`, `i18n.js` (EN/PT toggle)~~

---

## 2. Core views

### 🔴 BLOCKER
- [x] ~~Step 3 — Match schedule: list, filters (date/group/phase/team/stadium), search, sort~~
- [x] ~~Step 4 — Group standings computed from results (3/1/0, GD, GF)~~
- [x] ~~Step 5 — Stadiums page (cards + matches held)~~
- [x] ~~Step 6 — Match detail modal (result, penalties, future-stats placeholder, ARIA)~~

---

## 3. Bracket

### 🔴 BLOCKER
- [x] ~~Step 7 — Static bracket: R32 from config, sequential pairing to FINAL, placeholders, `resolveBracketTeams()`~~
- [x] ~~Step 8 — Interactions: hover path highlight, animations, wheel/pinch zoom, drag/pan~~
- [x] ~~Step 9 — Simulation mode: pick winner + score, propagate rounds, `wc2026_simulation`, reset~~

---

## 4. Polish & docs

### 🔴 BLOCKER
- [x] ~~Step 10 — Responsiveness (≤767 / 768–1439 / 1440+), accessibility (ARIA, keyboard, focus, contrast), entry animations~~

### 🟡 IMPORTANT
- [x] ~~Step 11 — README (deploy guide, JSON maintenance, `bracket-config.json` how-to) + spec §18 acceptance checklist~~ (done after step 12, at user request)

---

## 5. Extra features (complement spec §6–10)

### 🟡 IMPORTANT
- [x] ~~Step 12a — Favorites + "My Matches" filter (`toggleFavorite`, `getFavoriteMatches`, highlights)~~
- [x] ~~Step 12b — Timezone toggle "Local / Stadium time" (`wc2026_prefs.timeMode`)~~
- [x] ~~Step 12c — `.ics` export (`calendar.js`, CRLF, UTC, 2h duration)~~

### 🟢 OPTIONAL
- [x] ~~Step 12d — Bracket challenge score card (`calculateChallengeScore`)~~
- [x] ~~Step 12e — Share/import prediction via `?prediction=` base64 link~~

---

## 6. Post-launch (real data)

### 🟡 IMPORTANT
- [x] ~~Replace mock `data/*.json` with real World Cup 2026 data~~ (2026-06-12 — full migration + smoke test; see project-memory)
- [ ] Fill `thirdPlaceAssignment` in `bracket-config.json` after group stage ends (~2026-06-27; slot → allowed-groups table in project-memory)
- [ ] Update `results.json` as the tournament progresses (results updated through match id 25 on 2026-06-18)
- [x] ~~Real stadium photos + team flag SVGs in `assets/images/`~~ (flag SVGs added 2026-06-18; stadium photos optional)
- [ ] **Pós-Copa: estado final da home.** Quando a Final encerrar, o hero fica vazio (por design atual). Criar um estado pós-torneio (campeão/epílogo) na home — ver entrada "Hero cronômetro inteligente (2026-06-15)" em project-memory; provavelmente converge com a aba Stats (`stats-screen-plan.md`).

### 🟢 OPTIONAL
- [x] ~~PWA Tier 1 — instalável (manifest + ícones + meta tags; 2026-06-16). Atende todos os critérios de aceitação da issue.~~
- [ ] PWA Tier 2 — service worker + offline (deferido; ver `.agents/issues.md` → "PWA Tier 2". DEVE excluir `data/*.json` do cache p/ não quebrar o live-refresh + `DATA_VERSION`).

---

## 7. Stats final screen — `feature/stats-final-screen`

Build of `.agents/stats-screen-plan.md`, stage by stage with an approval gate each. The **pure-UI
build (A–F, minus skipped E) + a release polish (J round 1)** was **merged to `master` on 2026-06-17**
and is live. The screen renders fully with today's data and auto-lights the post-Cup sections (verdict,
champion path, debuts champion) once the final lands. The **data-layer stages (G/H/I) + a second polish
(J round 2)** remain for when their data arrives near/after the Cup.

### ✅ Shipped to `master` (2026-06-17)
- [x] ~~Stage 0 — branch `feature/stats-final-screen` off `master`~~
- [x] ~~Stage A — degradation engine + fault-tolerant `loadData` + sticky scrollspy sub-nav + media fallback~~
- [x] ~~Stage B — verdict hero (gated on FINAL finished; aggregate-hero fallback) + goals-by-round chart~~
- [x] ~~Stage C — final ranking 1–48 (phase-reached chain), favorite-row highlight, team record cards~~
- [x] ~~Stage D — auto record-cards + "format-48 debuts" band~~
- [x] ~~Stage E — in-tab results archive~~ — **SKIPPED (Option B):** kept the "See all matches → Matches" link; the Matches tab already covers browsing.
- [x] ~~Stage F — team comparator (diverging bars)~~ — teams only; the Teams/Players toggle is deferred to Stage H per graceful degradation.
- [x] ~~Stage J (round 1, release polish) — a11y/responsive/i18n/README audit on A–F~~ — passed clean (no code fixes). **Lighthouse + final `DATA_VERSION` bump still pending an actual deploy.**

### 🔭 Future (data layers + 2nd polish — near/after the Cup)
- [ ] **Stage G — Layer 2 cheap data.** Extend `results.json` (attendance, **`cards`→{y,r} migration** — breaking for `modal.js` + `stats.js` `aggregateTeams`, add a backward-compatible reader; `decidedIn`; backfill `stats`), `teams.json` (`ranking`/`wcDebut`/`confederation`), `stadiums.json` (`lat`/`lng`). Light up records: attendance, discipline/fair-play, ranking upsets, confederation performance, distance. **SCHEDULE LATE — conflicts with master's daily `results.json` refreshes.** Bump `DATA_VERSION`.
- [ ] **Stage H — Layer 3 players.** `players.json` + `player-events.json` + `awards.json` (+ optional `keeper-stats.json`). Top-scorers podium, assists/cards/saves chips, awards block, Squad of the Tournament, **Teams/Players toggle in the comparator** (the deferred half of Stage F), goal-time records. Relative photo paths (gotcha #7).
- [ ] **Stage I — Layer 4 editorial.** `curiosities.json` (bilingual EN+PT) + `all-time-baselines.json`; editorial record-cards + "this Cup vs history" panel.
- [ ] **Stage J (round 2) — polish over the NEW G/H/I features.** Repeat the audit on the added sections (a11y/responsive/perf, Lighthouse, EN/PT review) + bump `DATA_VERSION` for the new data files + README refresh.

---

## Quick final checklist

```
[x] All 104 matches load from JSON
[x] Standings + bracket fully derived from results.json
[x] Simulation works and survives reload (localStorage)
[x] GitHub Pages ready (all paths relative — verified; actual deploy pending)
[x] Mobile: bracket scroll + zoom + drag
[x] JS < 300KB (74 KB measured)   [ ] Lighthouse > 90 (run after deploy)
[x] EN/PT toggle covers every UI string
```
