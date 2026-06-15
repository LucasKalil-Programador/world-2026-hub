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
- [ ] Update `results.json` as the tournament progresses (results updated through match id 13 on 2026-06-15)
- [ ] Real stadium photos + team flag SVGs in `assets/images/` (10 new-team flags created 2026-06-12 in placeholder style)
- [ ] **Pós-Copa: estado final da home.** Quando a Final encerrar, o hero fica vazio (por design atual). Criar um estado pós-torneio (campeão/epílogo) na home — ver entrada "Hero cronômetro inteligente (2026-06-15)" em project-memory; provavelmente converge com a aba Stats (`stats-screen-plan.md`).

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
