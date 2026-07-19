# Project Memory — World Cup 2026 Hub

Persistent memory for this project. **Read before any significant change.**

**Fixed structure (keep this order):** Context · Architecture & Decisions · Gotchas ·
Operational Runbooks · Stats Screen · Patterns & How-tos · Current State.

> **Maintenance rule (set 2026-06-17):** this file holds **durable** knowledge only —
> architecture, decisions, gotchas, patterns. Per-match daily-refresh detail lives in **git
> commits** (see the commit convention), *not here*. The **Current State** section keeps a rolling
> window of the **last 3 refreshes** and is **pruned on each update** (do not append new dated
> refresh logs). New *decisions / gotchas / patterns* are appended to their section. Content is kept
> in its original language (EN or PT) where it was written that way; new scaffolding is in English.

---

## Context

Static web app for the FIFA World Cup 2026 (Mexico/USA/Canada, 48 teams) — schedule, group
standings, interactive knockout bracket with user simulation, stadiums, and a post-tournament stats
screen. All content from `data/*.json`. Started 2026-06-11 from two spec documents; built
step-by-step with user approval between steps; now live with **real** WC2026 data, refreshed daily.

**What it is:** a **personal/portfolio** piece (visual polish is a primary goal); a **static SPA**
(one `index.html`, ES-module vanilla JS, JSON as the only "database"); maintained by **editing JSON
only** — code should never need touching to update scores/teams.

**What it is not:** no backend, database, build step, bundler, CDN dependency, or framework; no
automated tests / linter (explicit spec constraint).

**Spec source of truth:** `world-cup-2026-hub-spec-en.md` + `complement-spec-worldcup2026-en.md`
(**complement wins on conflict**).

---

## Priority objectives

1. **Spec compliance** — complement spec wins on conflict.
2. **Visual quality** — FIFA/UCL/Apple-inspired, glassmorphism, smooth animations; portfolio-grade.
3. **Interactive bracket** — hover path highlight, zoom, drag, simulation; the centerpiece feature.
4. **Easy maintenance** — real data drop-in via JSON; `bracket-config.json` is the only structural
   file edited after the group stage.
5. **Performance/accessibility** — Lighthouse > 90, first render < 2s, JS < 300KB, ARIA + keyboard nav.

---

## Architecture & Decisions

### Stack & module pattern
- **Vanilla HTML/CSS/JS ES2022+, ES Modules**, relative paths, no bundler/CDN/framework — spec
  mandate (GitHub Pages / Hostinger serve static files only).
- **EN/PT-BR UI toggle** via `i18n.js`: tiny dict + `t(key)`, persisted in `wc2026_prefs.lang`.
  Static HTML uses `data-i18n` / `data-i18n-aria` re-applied by `applyI18n()`; dynamic renders call
  `t()` and listen for `langchange`. Phases via `translatePhase()` (PT: R32 = "16 avos de final").
  Default language: `navigator.language` startsWith `pt` → PT, else EN; only persisted on toggle.
- **`storage.js`** is the only access path to `localStorage` (`wc2026_*` keys, auto JSON). Holds
  prefs (`lang`, `lastTab`, `timeMode`), `wc2026_favorites`, `wc2026_simulation`.
- **Per-view modules** (`schedule/groups/bracket/stadiums/stats`) + `app.js` entry. **Circular
  imports `app.js` ⇄ view modules are intentional and safe** in native ESM — all cross-calls happen
  at render runtime, after every module has evaluated. `stats.js` imports `getBracketTree`,
  `getFavorites`, `openMatchModal` this way too.
- **Custom events on `document`** drive re-renders — each view owns its own: `langchange`,
  `simchange`, `favchange`, `timemodechange`, `datachange` (live refresh). No shared render loop.

### Error & loading copy cleanup (2026-07-10)
`app.comingSoon` ("This section arrives in a later build step.") was a leftover from the
step-by-step build — the 5 non-home panels (`index.html`) showed it as a static placeholder until
each view's `init*()` replaced it. Since all 12 build steps have long shipped, the text read as
"unbuilt" on the live site even though it only ever showed for the instant `loadData()` was in
flight. **Key removed; the 5 panels now reuse `app.loading`** ("Loading data…"/"Carregando
dados…") — same semantics as the Home hero's loading state, one fewer i18n key to maintain.
Separately, `showError()`'s (`app.js`) fatal-load fallback had a dev-only hint ("serve via `python
-m http.server`") and rendered the raw `error.message` in the UI — both wrong for a production
visitor. **`app.errorHint` now reads "Please check your connection and try reloading the page." /
"Verifique sua conexão e tente recarregar a página."**, and the raw error goes to `console.error`
instead (still inspectable via DevTools, just not shown to visitors). Verified both paths in
preview (normal load + a forced `results.json` 404 via temporary rename).

### Stats knockout-resolution fix + non-fatal view init (2026-07-19)
The whole app died behind the "check your connection" error screen (home hero blank, Stats tab empty)
from **one** `TypeError` in `stats.js` → `highScoreCardHTML`. Two independent defects:
1. **`stats.js` read `m.homeTeam`/`m.awayTeam` raw** — the exact class of bug called out in the hero
   entry (2026-06-28). Knockout matches (ids 73–104) carry only `bracketRef`, so once a knockout game
   became the highest-scoring match (id 103, FRA 4–6 ENG, 10 goals) the card crashed on
   `teamById.get(undefined).name`. Silently wrong before it crashed: **`aggregateTeams()` was bucketing
   every knockout result into a single `undefined` row**, so the 48-team table, leader cards, comparator
   and win-streak record only ever counted the group stage (England showed 3 played, now 8). Fix: new
   **`teamIdsOf(match)`** helper in `stats.js` — `m.homeTeam` when present, else
   `resolveBracketTeams(match)` → ids (null when unresolved, caller `continue`s). Now the single
   participant-id source for `aggregateTeams` + all three `computeRecords` passes (biggest win, win
   streak, highest-scoring). **Never read `match.homeTeam` raw outside group-only code.**
2. **`init()` (`app.js`) wrapped `loadData()` AND all 7 view inits in one `try`** — any view crash
   aborted the rest and rendered the fatal connection error, which is about *data loading*, not code.
   Split: `loadData()` failure alone is fatal (`showError` + `return`); the views now run in a loop,
   each in its own `try`, logging `[wc2026] "<name>" failed to initialise:` and continuing. A broken
   view can no longer blank the home page.
`APP_VERSION` → **v1.0.4**.

### Post-Cup home hero + Bracket Step 4 celebration (2026-07-19, shipped hours before the Final)
Two features closing known gaps, both gated on the REAL Final (same verdict rule as stats):
1. **Post-Cup hero (`app.js`)** — `renderHero`'s empty-featured branch no longer blanks the home.
   `heroVerdict()` (local copy of the stats gate: FINAL `finished && !simulated && winner`) picks
   between **`heroEpilogueHTML()`** (trophy + champion flag/name/crown, Final score line with
   `status.pending`/pens, runner-up + third podium, CTA button → `navigateTo('stats')`) and
   **`heroAwaitingHTML()`** (Final matchup + `status.pending`) for the window between clock-over and
   the results push. The flip is automatic: heroTick flips upcoming→awaiting at kickoff+3h with no
   JSON edit; the 90s poll's `datachange` → `renderHome` flips awaiting→epilogue. CTA is delegated on
   `#hero-content` (survives re-renders). New i18n keys `hero.tournamentOver` / `hero.viewStats`;
   CSS `.hero-champ*`/`.hero-podium*`/`.hero-cta` in `style.css` (motion reduced-motion-gated).
2. **Champion celebration (`bracket.css` only)** — fires on `has-champion` in all 3 views:
   wallchart/pager `.bk-champion` gets breathing `champ-glow` + `champ-sheen` sweep + `champ-pop`
   trophy; radial `.bk-center` gets `champ-glow` + expanding `champ-ring` ripple. Color runs through
   **`--celebrate`** (gold `212,175,55`; `.is-sim` overrides to blue `30,136,229` — a simulated
   champion celebrates in blue, never gold). All animation inside
   `@media (prefers-reduced-motion: no-preference)`; the pre-existing static glows are the
   reduced-motion presentation. `.bk-champion.bk-flow` gained `position: relative` (sheen pseudo
   needs a positioning context; chart canvases are already absolute).
Verified by simulation (results.json temporarily marked 104 finished 2–2 pens 3–4, then
`git restore`d; awaiting state via a `Date.now` override — heroTick flipped it alone): epilogue,
podium, CTA, stats verdict, debut-champion fact, gold celebration ×3 views, sim-blue ×2, sim never
leaking into the home epilogue, console clean. `APP_VERSION` → **v1.1.0** (closes the bracket
redesign Steps 1–4). **Preview gotcha discovered:** when the Browser pane is hidden,
`document.visibilityState === 'hidden'` → Chromium freezes rAF/IntersectionObserver/paint, so
count-up tiles sit at "0" and screenshots hang — verify via `data-countup` attrs / computed styles,
not pixels (extends gotcha #7).

### Data model
- **All match times are UTC** in `matches.json`; converted at render by `formatMatchTime(match,
  stadium, mode)` via `Intl.DateTimeFormat` (`mode` = `"local"` browser tz, or `"stadium"`
  timezone). `.ics` export depends on this.
- **Match ids:** group matches **1–72 = chronological by UTC kickoff** (≠ 6-per-group blocks);
  **73–104 = FIFA official match numbers** (knockout, carry `bracketRef`).
- **Knockout matches carry `bracketRef`, not teams** — resolved at runtime from standings +
  `bracket-config.json`; rounds after R32 have no config and are generated by **sequential pairing
  of winners** (indices 0-1 → 0, 2-3 → 1, …).
- **Simulation never mutates JSON** — overlay in `localStorage.wc2026_simulation`, keyed by
  bracketRef (`R32-6: { winner: "FRA", score: "2-1" }`, score home-away).
- Team ids are **3-letter uppercase** (`MEX`, `BRA`). Knockout ids: `R32-1`…`R32-16`, `R16-1`…,
  `QF-1`…, `SF-1`/`SF-2`, `THIRD-PLACE`, `FINAL`.

### Standings (`groups.js`)
- **Only `status:"finished"` counts** toward standings (live scores ignored until full-time → stable
  standings + deterministic bracket resolution).
- **Tiebreak:** points → goal difference → goals for → team id alphabetical (stable fallback).
- `computeStandings()` (per-group, finished only) and `isGroupFinished()` are exported and reused by
  `bracket.js` / `stats.js` (no recompute).
- **Best third-placed teams table (2026-06-28).** `computeThirdPlaceRanking()` (exported) takes each
  group's 3rd row (`standings[letter][2]`), ranks the 12 across groups by the same key (Pts → GD → GF →
  id) and flags the top 8 `qualified`. Rendered as a full-width section **below** the 12 group cards in
  the Grupos tab, **gated on `allGroupsFinished()`** (meaningless mid-stage → omitted from the DOM).
  Reuses `.standings-table` styling, header tooltips and the favorite-row highlight; gold `.row-third`
  + ✓ for the 8 that advance, muted `.row-out` + — for 9–12, a dashed `.cut` line between 8 and 9. It
  only **ranks** the thirds for display — the slot→group allocation still lives in
  `bracket-config.json` (FIFA combination table), never derived from this ranking.

### Bracket (`bracket.js`)
- **Tree is language-neutral**: slots are `{ teamId }` or `{ ph: {kind,…} }`; placeholder text is
  produced at render time by `slotDisplay()`, so language switches never invalidate the tree.
- **Tree is cached**; `invalidateBracket()` drops it (simulation overlay + live refresh).
- **`resolveBracketTeams(matchOrRef)`** → `{ home, away }` of `{ team: Team|null, label }` for any
  match (group or knockout); reused by schedule cards, modal, and search/team filters (so knockout
  matches become searchable/filterable once resolved). `getBracketTree()` → `{ rounds, third,
  nodesByRef, champion }`.
- ~~**CSS connectors depend on an equal-height invariant:** all columns share height with `flex:1`
  slots, so pair children sit at 25%/75% and the next node at 50%; pure-CSS stubs meet exactly.
  Column gap = 2 × stub (44px desktop / 36px ≤767). **Breaking equal height breaks the lines.**~~
  **RETIRED 2026-07-03** by the wallchart redesign — see "Bracket redesign (2026-07-03)" below;
  connectors are now SVG paths generated from the same JS geometry as the cards, so no CSS
  invariant exists anymore.
- **Simulation:** `decide()` applies only real finished results; `applySimulation()` overlays user
  picks afterwards and **never overrides a real result** (so `simulated:false` ⇒ real). Stale entries
  (winner no longer resolved) are silently ignored. Eligible nodes (both teams resolved, real result
  still `scheduled`) get dashed blue borders + a SIM chip.
- **Interactions:** full-path highlight computed from ref arithmetic (`floor(i/2)` up, `2i`/`2i+1`
  down), no tree lookup. Zoom = CSS `transform:scale()` on the canvas + a sized `#bracket-zoom` box,
  pointer-anchored, clamped 0.4–2; natural size measured lazily (`ensureMeasured()` — panel may be
  `hidden` at render). Pan/pinch via Pointer Events, `touch-action:none` on the wrap. Drag–click
  conflict: capture pointer only **after** the >5px threshold (gotcha #6).
- **Share/import:** `?prediction=base64(simulation)` via `getShareableLink()` /
  `loadPredictionFromURL()`; stripped from the URL (`history.replaceState`) whether applied or not;
  unknown refs rejected wholesale. **Challenge** card scores sim vs real finished knockout results.

### Bracket redesign — center-out wallchart (2026-07-03, Step 1 of 4)
Full redesign spec settled via /grill-me: **two switchable chart layouts** (center-out wallchart =
default, radial = Step 3) + a **mobile round pager** default ≤767px (Step 2), stadium-night art
direction, lean escalating cards, fit-whole-chart initial framing, gold-real/blue-sim champion
celebration (Step 4), built **directly on master** (deploy still gated on user-approved push).
Step 1 (shipped): wallchart replaces the old left-to-right columns.
- **`computeWallchartLayout()` in `bracket.js` is the single geometry source:** absolute px
  positions for every card/title/champion box (`GEO` constants; R32 1–8 left half, 9–16 right,
  later nodes at feeder midpoints) **and** the SVG bezier connectors + champion stem derived from
  the same numbers — cards and lines cannot drift apart. Tree/sim/share/challenge logic untouched;
  DOM contract preserved (`data-ref`, `data-match-id`, delegation, keyboard activation).
- **Fit-to-chart zoom:** geometry is computed (never DOM-measured); a `ResizeObserver` on
  `#bracket-wrap` computes `view.fit` when the panel becomes visible (hidden panel = clientWidth 0)
  and re-fits on resize unless the user zoomed. **Zoom label "100%" = fit**, reset returns to fit,
  clamp = [fit, 2]. The wrap carries an inline `aspect-ratio: W/H` from the engine so the fit view
  is never letterboxed (capped `max-height: min(80vh, 840px)`).
- **Cards:** lean two-row + microline (`.bk-meta`: kickoff via `kickoffShort()` honoring the
  Local/Stadium toggle — bracket now listens to `timemodechange`; LIVE pulse; FT = `t('bracket.ft')`,
  new i18n key EN/PT). Tier classes `bk-r32…bk-final` escalate size/heat; the Final hero card also
  shows venue (`.bk-venue`). Champion box: `has-champion` gold; **`is-sim` = blue + SIM chip**
  (a simulated champion must never read as real — same rule as the stats verdict; previously the
  old champion box showed sim champions in gold).
- **Path highlight** now also lights SVG connectors: a path turns gold when **both** its
  `data-from`/`data-to` endpoints are in `pathRefs()`; the champion stem carries FINAL→FINAL.
- **Motion:** cards rise + connectors draw (`pathLength="1"` + dash animation), staggered by round,
  all inside `@media (prefers-reduced-motion: no-preference)`; replays on each tab open (display:none
  restarts CSS animations) — intentional "chart assembles" effect.
- ~~**Interim states until later steps:** mobile ≤767 shows the pinch-zoom wallchart (pager = Step 2);
  no view toggle yet (registry lands with the second view).~~ Superseded same day — Steps 2+3 below.

### Bracket redesign — Steps 2+3: view toggle, rounds pager, radial "orbit" (2026-07-03)
- **View toggle:** segmented `Fases | Chaveamento | Radial` in the toolbar; explicit choice persists
  in `wc2026_prefs.bracketView`; with no stored pref the default follows the breakpoint (≤767px →
  rounds pager, else wallchart; a `matchMedia('change')` listener re-renders while unset). Zoom
  controls render only for chart views. `render()` dispatches: pager / `chartHTML` →
  `wallchartInnerHTML` | `radialInnerHTML`. Switching chart layouts resets to a fresh fit
  (`view.layoutId` check in `initInteractions`).
- **Rounds pager — button navigation ONLY (user decision):** the first build used a scroll-snap
  swipe track; the user rejected horizontal scrolling, so pages are plain sections toggled with
  `hidden` by the chips (`initPager` ~15 lines, no ResizeObserver/height-clamp needed). Grid is
  **max 2 columns** (≥700px) — 3–4 columns made cards too narrow (user feedback). Opens on the
  first round with an unfinished match (`firstOpenPage`); `pagerIndex` survives re-renders. Cards
  (`.bk-pcard`) carry venue·city + status row and reuse `teamRowHTML` + the same
  `data-ref`/`data-match-id` delegation (modal + sim editor work unchanged).
- **Radial = "orbit" view, redesigned to a user-supplied reference image** (circular predictions
  bracket with the trophy at center). NOT rectangular cards: **circular flag tokens** on concentric
  rings — outer ring = 32 entrants, each ring inward = a round's **winner slots** (a match's winner
  slot doubles as the next match's participant), trophy centerpiece (= the FINAL's winner slot,
  champion flag + name when decided, sim-blue when simulated), third-place = small labeled pair
  below the circle. `TGEO` radii chosen so adjacent/consecutive rings never collide (validated with
  an automated pairwise-overlap eval in preview — keep doing that after any radius change).
  **Semantics:** elbow route lines (radial segment + bend dot) turn **gold = real advancement**,
  **dashed blue = simulated pick**; eliminated entrants grey out (`tk-out`), TBD slots are striped
  discs (`tk-tbd`); names/scores live in the shared app tooltip (`has-tip`/`data-tip`, delegation
  in app.js `initTooltips`) and the modal. **Sim affordance lives on the winner slot** (`opts.slot`,
  not `opts.winner` — a TBD slot is exactly the simulatable one; that inversion was a shipped-then-
  fixed bug). Path highlight generalized: `showPath` lights ANY `[data-ref]` element + `.bk-le`
  endpoints; hover/focus delegation uses `closest('[data-ref]')`.
- **Toolbar gotcha:** `.bracket-tools-left` holds 6 controls — needs `flex-wrap: wrap` or it forces
  ~500px of page overflow at 375px (found via body scrollWidth sweep on mobile).

### Modal (`modal.js`)
- **Native `<dialog>` + `showModal()`** → focus trap, Esc, `::backdrop` come free. Backdrop click =
  `event.target === dialog`. Focus restored to the opener on close. Card→modal is **event delegation
  on `#schedule-root`** (click + Enter/Space), surviving list re-renders. `openMatchModal(matchId)`
  is the public API for every view.
- **Match stats in modal:** optional `stats` field per game in `results.json`
  (`{ possession, shots, cards }`, home/away following `homeTeam`/`awayTeam`; possession %, total
  shots, yellow cards). Renders real stats when present, else the `—` placeholder + `modal.statsSoon`
  note. Adding stats to more games = edit `results.json` only.

### Hero — hybrid clock+JSON (`app.js`)
- The home hero advances by the **clock**, not only by the JSON. **`matchState(match, result, now)`**
  (pure, **exported**, reused by the schedule occurrence filter): `over` if `status==='finished'`
  **OR** `now ≥ kickoff + window`; `live` if `status==='live'` **OR** `now ≥ kickoff`; else
  `upcoming`. **JSON always wins** (finished/live force); the clock only advances when JSON lags.
  Window: `GROUP_WINDOW_MS = 2h` for `Group*`, else `KO_WINDOW_MS = 3h`.
- **`findFeaturedMatches(now)`** picks the earliest non-`over` match and returns **all** sharing that
  exact kickoff → the hero stacks simultaneous group-final matches (last round = 12 pairs, always 2);
  1-match render is DOM-identical to before. One persistent **1s `heroTick`**; signature
  `"id:state"` (joined for the set) → full `renderHero()` on change, else just `updateCountdown()`.
  `renderHero` is idempotent and re-arms the timer (`if (heroTimer) return`).
- **Hero resolves teams via `resolveBracketTeams(match)`** (not raw `match.homeTeam`), so knockout
  featured matches show real teams/flags once resolved and a placeholder label otherwise — same path as
  schedule cards/modal. `heroTeamHTML(slot)` takes a `{team,label}` slot. **Bug fixed 2026-06-28:** the
  hero previously read `match.homeTeam/awayTeam` directly; harmless during the group stage (those fields
  exist) but the moment the next match became an R32 game (ids 73+, which carry only `bracketRef`) the
  home hero showed "A definir vs A definir". Watch for this class of bug anywhere that reads
  `match.homeTeam` raw instead of resolving.
- Live score shown only if `result.homeScore/awayScore` are non-null; no elapsed-time clock
  (would be inaccurate on a static site). Badge "Bola rolando!" = key `hero.inProgress` (renamed from
  `hero.kickoff`); `hero.live` still used by schedule/modal. **Scope: hero only** — Matches/Modal/
  Bracket live badges stay JSON-`status`-driven (small transient inconsistency accepted). When the
  Final goes `over`, the hero is empty (post-Cup home state is a TODO).

### Live data refresh — poll `results.json` without F5 (2026-06-16, Option A⁺)
- The data is **not live** — it's a manual push after each match. So poll is **fixed**
  (`POLL_INTERVAL_MS = 90s`), not state-based. `startResultsPolling()` (called at the end of
  `init()`, after views register listeners) arms one `setInterval` (`if (pollTimer) return`).
  `pollResults()` fetches `data/results.json?t=${Date.now()}` with `cache:'no-store'`. (As of
  2026-06-18 the initial `loadData()` fetch also uses `?t=Date.now()`; the old hand-bumped
  `?v=DATA_VERSION` cache-buster was removed — see Cache-busting runbook.)
- **Signature = full response text** (catches score corrections, `stats` backfill, penalties — a
  finished-count signature would miss them). On change: rewrite `data.results` **and rebuild
  `data.resultByMatchId`** (the derived map), `invalidateBracket()`, dispatch `datachange`.
- **3 reinforcements over plain fixed poll:** (1) Page Visibility — interval no-ops when
  `document.hidden`; `visibilitychange` does an immediate fetch on return. (2) **Stop at the end** —
  `tournamentOver()` checks `FINAL`'s JSON `status==='finished'` (not clock-`over`, which would stop
  3h after kickoff before the score lands) → `stopResultsPolling()`. (3) Content signature (above).
- **`bracket-config.json` piggybacks the change event:** the poll fetches only `results.json` each
  tick, but on a detected change it **also refetches `bracket-config.json`** the same cycle
  (`data.bracketConfig`) — the one-time 3rd-place fill ships in the same push as a results change, so
  no per-tick config polling, but the open tab still gets the new `thirdPlaceAssignment` without F5.
- **Fan-out:** every view has a `datachange` listener (`app.js`→`renderHome`,
  `schedule.js`→`renderList`, `groups.js`→`render`, `bracket.js`→`render`, `stats.js`→rebuild model).
  Not handled (accepted, rare changes): open modal doesn't auto-update; re-render during drag/typing.

### Performance & responsive/a11y
- **No `backdrop-filter` on repeated cards** — `.match-card` overrides `.glass` blur (huge paint ×
  104 cards). Same rule for any future card grid.
- **Fixed gradient lives on `body::before` (position:fixed)**, not `background-attachment:fixed`
  (avoids repainting the background on scroll).
- **Breakpoints:** ≤767 (tight; bracket `--node-w:168px`/gap 36px — stub offsets stay at gap/2),
  768–1100 (two-band header), **1100+** (single-row header; the flip moved 768→1100, see header
  pattern), 1440+ (`.container` widens to 1360px).
- WAI-ARIA tabs: roving tabindex + Arrow/Home/End in `initTabs()`, focus follows activation.
  Dialogs get `aria-label` at open; schedule count `aria-live="polite"`; countdown `role="timer"`.
  Entry animations (panel fade, card stagger) all gated by `prefers-reduced-motion`.

---

## Gotchas

1. **`fetch()` of JSON fails on `file://`** — always serve via `python -m http.server` (Claude
   Preview `worldcup2026`, port 8126). Symptom: blank app + CORS errors.
2. **GitHub Pages / Hostinger serve under a subpath** — use **relative paths** everywhere
   (`data/matches.json`, `assets/...`); root-absolute (`/data/...`) 404s in production.
3. **`.ics` requires CRLF line endings** (`calendar.js`) — RFC 5545 mandates `\r\n`; some calendar
   apps silently reject `\n`.
4. **Third-place slots are `null` until filled** (`bracket-config.json.thirdPlaceAssignment`) —
   `resolveBracketTeams()` must return placeholder labels ("Best 3rd #1", "Group A Winner") whenever
   a slot is `null` or its group isn't finished. Symptom if forgotten: crash / "undefined" in R32.
5. **Stale JS modules in the dev browser** — `python -m http.server` sends no cache headers, so
   browsers heuristically cache ES modules. Hard-reload via `Promise.all(files.map(f => fetch(f,
   {cache:'reload'}))) → location.reload()`, or DevTools hard reload.
6. **`setPointerCapture` on pointerdown kills element clicks** (`bracket.js`) — capturing retargets
   the eventual `click`, so delegation never matches → modal/sim clicks die. Capture only after the
   >5px drag threshold, in `pointermove`, try/catch. **Verify click flows with `preview_click`
   (trusted input), not `element.click()`.**
7. **Claude Preview screenshots can hang** (tooling, not app) — `preview_eval` keeps working;
   `preview_stop` + `preview_start` recovers. Verify state via `preview_eval` before suspecting the app.
8. **Claude Preview: resize beyond the native window (~791 CSS px) breaks clicks/screenshots** —
   viewport emulation desyncs the capture surface. At emulated widths > native, navigate via
   `preview_eval` + `navigateTo()` and verify geometry via eval/inspect; trust screenshots only at
   widths ≤ native. `preview_resize preset: desktop` resets it.
9. **Never read `match.homeTeam` / `match.awayTeam` raw** — only group matches (ids 1–72) have them;
   knockout matches carry `bracketRef` only. Always go through `resolveBracketTeams()` (or
   `stats.js`'s `teamIdsOf()`). Symptom: "A definir vs A definir", `undefined` rows, or a
   `Cannot read properties of undefined (reading 'name')` crash — bit the hero (2026-06-28) and
   `stats.js` (2026-07-19).
10. **`aspect-ratio` + `min-height` can transfer size INTO width** (bracket wallchart, 2026-07-03) —
   on a box with `width: auto`, a violated `min-height` transfers back through the ratio and widens
   the element past its container (on mobile the 220px min became 585px of page overflow). Fix: give
   the box a definite width (`width: 100%`); then the ratio only drives height and min/max-height
   clamp it without transfer.

---

## Operational Runbooks

### Daily data refresh
Follow **`how-refresh-data.md`** (project root) before touching any `data/*.json`. In short: edit
`data/results.json` (scores/status, two-source rule, `penalties` only on knockout ids 73–104) →
verify in preview → commit (two-commit convention) → push (user's go) → deploy.
Frozen files (never edit): `stadiums/teams/groups/bracket-config.round32/assets/code`.
`how-update.md` stays as the schema reference for the (completed) mock→real migration.

### `thirdPlaceAssignment` (one-time, after the group stage ~Jun 27–28)
When all 72 group matches are `finished`, fill `bracket-config.json.thirdPlaceAssignment`
(slot → group **LETTER**, per FIFA's published allocation — never derive it yourself). Each group
letter appears in **at most one** slot; unfilled slots stay `null`:

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

### Cache-busting (2026-06-18: DATA_VERSION removed)
`app.js` `loadData()` appends `?t=${Date.now()}` to every `data/*.json` fetch — same scheme the
live-refresh poll already used. **There is no `DATA_VERSION` constant to bump anymore** (removed
2026-06-18); every load gets a unique URL, so Hostinger can never serve a stale `results.json` and
the daily refresh has zero cache step. ~~Previously appended `?v=${DATA_VERSION}` (a hand-bumped
`YYYY-MM-DD-revN` constant) — retired because the manual bump was easy to forget and `Date.now()`
guarantees freshness.~~ Note: **JS/CSS are not versioned** (no build step) — on Hostinger returning
visitors may serve stale code until their browser re-fetches; new visitors / hard-refresh see it at
once. Accepted.

### App version (footer)
Single source of truth: **`assets/js/i18n.js` line 9** — `const APP_VERSION = 'v1.0.X'`. Auto-shown
in both EN and PT footers via `t('footer.note')`. Bump after a notable ship (new section, major
bugfix, schema change, deploy). Commit e.g. `refactor(footer): bump version to vX.Y.Z`.

### Commit convention (standardized 2026-06-15)
Every `/update-worldcup` run = **two commits** (full spec in `how-refresh-data.md`):
1. **Data commit** (`results.json`, + `bracket-config.json` on the 3rd-place day):
   - 1 game → `data: update DD/MM/YYYY HH:MM HOMExAWAY HxA`
   - N games → `data: update DD/MM/YYYY — N jogos` + one body line per game.
   - Penalties (knockout only): suffix `(pen HxA)`.
2. **Docs commit:** `docs: log daily refresh DD/MM/YYYY` (`.agents/` + TODO).

Rules: `DD/MM/YYYY` + `HH:MM` are the match's **UTC** kickoff (as in `matches.json`); codes = 3
uppercase letters; separator lowercase `x`. `.agents/` is excluded from the FTP deploy → keeping it
a separate commit keeps the data commit's diff clean.

### Deploy — Hostinger via FTP (GitHub Actions, 2026-06-14) — RETIRED 2026-07-05
> **RETIRED 2026-07-05** — `deploy.yml` was deleted at the Dokploy cutover; the repo no longer deploys
> to Hostinger (see "Dokploy cutover — FTP retired" below). Kept as historical reference.
- `.github/workflows/deploy.yml`: every `push` to `master` (or `workflow_dispatch`) deploys via
  `SamKirkland/FTP-Deploy-Action@v4.3.5` (`protocol: ftps`, `port: 21`, `local-dir: ./`,
  `server-dir: worldcup2026/`).
- **origin** = `https://github.com/LucasKalil-Programador/world-2026-hub.git` (branch `master`).
  Push via Windows credential manager (**gh CLI is NOT installed** on this machine).
- **Secrets** (repo → Settings → Secrets → Actions): `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`
  (from Hostinger hPanel). Without them the workflow fails.
- **Gotcha:** the Hostinger FTP account logs in **already inside `public_html`**, so `server-dir` is
  relative to it — do **not** prefix `public_html/` (causes `public_html/public_html/...`). Final
  path: `public_html/worldcup2026/`. If FTPS is rejected, switch `protocol` to `ftp`.
- `exclude` removes `.git*`, `.github/`, `.agents/`, **`docs/`**, `README.md`, **`DEVELOPMENT.md`**,
  `how-*.md`, `*-en.md` specs — only `index.html` + `assets/` + `data/` reach the site. New `data/` /
  `manifest.json` / `assets/icons/` files **are** deployed. Incremental sync state
  (`.ftp-deploy-sync-state.json`) lives only on the server — don't commit it.

### Deploy — Dokploy via Docker/nginx (2026-07-05, in parallel with Hostinger)
Migrating the live host to **Dokploy** (self-hosted PaaS on a VPS: Docker + Traefik). Hostinger/FTP
is **kept in parallel** until Dokploy is 100% confirmed — the FTP workflow is untouched (only its
`exclude` grew to drop the new infra files). Target URL: **`app.lucaskalil.com/worldcup2026`** — a
**subpath** (the user's plan: every mini-app at `app.lucaskalil.com/<appname>`).
- **3 new root files (no app-code change — paths were already relative, gotcha #2):**
  `Dockerfile` (nginx:1.27-alpine, no build step, single-stage `COPY`), `nginx.conf`
  (server config), `.dockerignore` (mirrors the FTP exclude; keeps `.git`/docs out of the context).
- **Subpath is served INSIDE the container** — files copied to
  `/usr/share/nginx/html/worldcup2026/` and nginx serves them there, so container path == public path
  1:1 (same mental model as Hostinger's `public_html/worldcup2026/`). **Dokploy domain must set Strip
  Path = OFF** (Host `app.lucaskalil.com`, Path `/worldcup2026`, Container Port `80`). If strip were
  ON, Traefik would forward `/` and nginx would 404 — this is the one setting that breaks it. This
  "serve under /appname, no strip" is the **reusable template** for the other mini-apps.
- **nginx cache policy is deliberate** (no build step ⇒ unversioned JS/CSS ⇒ gotcha #5): `index.html`
  + JS + CSS = `Cache-Control: no-cache` (revalidate); `data/*.json` = `no-store` (the 90s live poll
  owns freshness); media (svg/png/ico/…) = `max-age=604800`; `manifest.json` gets
  `application/manifest+json` MIME. `absolute_redirect off` so the behind-Traefik trailing-slash
  redirect stays relative. `/healthz` (200) for the Docker `HEALTHCHECK`; `/` 302→ the app.
- **New deploy flow:** push to `master` → Dokploy rebuilds the image + redeploys (in addition to the
  FTP job). Heavier than FTP's incremental sync, but trivial for a tiny static image. **Status:
  files added, first Dokploy build NOT yet verified** (Docker isn't installed on the dev box, so no
  local `docker build` was possible — validate in Dokploy).

### Auto-deploy behind an SSH tunnel + migration plan (2026-07-05)
The **Dokploy dashboard is not publicly exposed** (accessed via an SSH tunnel), so the GitHub App /
webhook (inbound) can't reach it — **only outbound clone works** (which is why manual/CI-triggered
deploys build fine). Auto-deploy is done **in reverse**: `.github/workflows/dokploy-deploy.yml`
SSHes into the VPS on push to `master` and `curl -X POST`s Dokploy's **deploy webhook on localhost**
(uses `appleboy/ssh-action`). **Secrets required:** `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`VPS_SSH_PORT`, `DOKPLOY_DEPLOY_WEBHOOK` (the app's Dokploy webhook URL with the host swapped to
`http://localhost:3000`, keeping the `/api/deploy/…` token path). Recommend a **dedicated SSH deploy
key** (optionally a forced-command `authorized_keys` entry that only runs the curl). Test the webhook
by SSHing in and running the curl by hand **before** trusting CI. Runs parallel with the FTP job.
**Gotcha (2026-07-05):** the deploy webhook only parses the request as a push (and reads the branch
from `ref`) when it gets the **`X-GitHub-Event: push` header** — this was the real blocker. Without it,
**every** branch returns `{"message":"Branch Not Match"}` (it never even extracts the branch). The full
working call is `-H "Content-Type: application/json" -H "X-GitHub-Event: push" -d '{"ref":"refs/heads/master"}'`
→ `{"message":"Application deployed successfully"}` (confirmed the app's branch is `master`). Dokploy
answers **HTTP 200 even on failure**, so `curl -f` stays green on a mismatch — the workflow greps the
body for `deployed successfully` to fail the job properly.
- **Migration phases (Hostinger → Dokploy):** (1) **now** — parallel auto-deploy on both (this
  workflow + FTP). (2) **soak** — run a real daily refresh, confirm on `app.lucaskalil.com/worldcup2026`
  that the new score shows, the 90s live-refresh poll works, manifest/PWA + assets are 200 (no 404).
  (3) **cutover** — make `app.lucaskalil.com/worldcup2026` the canonical URL: update README badge/live-
  demo link + this memory (**DONE 2026-07-05, repo side** — see the "Dokploy cutover" entry below),
  optional Hostinger redirect old→new so existing links survive. (4) **retire FTP** — delete
  `deploy.yml`, remove the FTP secrets, clean `public_html/worldcup2026/` (or leave only the redirect).

### Dokploy cutover — FTP retired, repo side (2026-07-05)
**Fase 3 (canonical URL) + Fase 4 (retire FTP) done _in the repo_.** Removed the FTP workflow
(`deploy.yml` deleted) so **push → Dokploy is the only deploy** (`dokploy-deploy.yml`). Swapped the
public URL **`lucaskalil.com/worldcup2026` → `app.lucaskalil.com/worldcup2026`** everywhere it appeared
(README badge + "try it now", `DEVELOPMENT.md` deploy section, `project-map.md`). Reworded the stale
Hostinger/FTP references in `DEVELOPMENT.md` (deploy section → Dokploy), `how-refresh-data.md`,
`.dockerignore`, `nginx.conf`, and the `app.js` cache comment. **Still pending (out of repo — GitHub/
Hostinger side):** delete the `FTP_SERVER`/`FTP_USERNAME`/`FTP_PASSWORD` GitHub secrets and clean or
redirect Hostinger's `public_html/worldcup2026/`. **Caveat:** the Fase 2 soak test (confirm a real
daily refresh lands on `app.lucaskalil.com/worldcup2026`) was NOT explicitly re-run before this cutoff.

### Real-data migration (DONE 2026-06-12)
All 6 `data/*.json` hold real WC2026 data (sources: Wikipedia per-group + knockout articles,
cross-checked vs ESPN/FOX/olympics.com). **Stadiums trimmed 30 → 16**; cities use FIFA host-city
names ("New York/New Jersey", "San Francisco Bay Area", "Boston") — `matches.json` and
`stadiums.json` must match exactly. **bracket-config app-order ↔ FIFA mapping:** R32-1..16 = FIFA
matches 74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87 (so the app's sequential
pairing reproduces the official R16/QF/SF progression). Re-verify near Jul 6: **match 94** (R16,
Lumen Field) kickoff was single-source (Wikipedia 17:00 PDT vs an ESPN summary implying 14:00 PDT).

---

## Stats Screen (`feature/stats-final-screen`)

Full post-Cup stats screen built from **`.agents/stats-screen-plan.md`** (stages A–J). The pure-UI
build (**A–D + F**, E skipped) **+ J round 1 polish** was **merged to `master` 2026-06-17** and is
live. `master` keeps the partial screen + daily refreshes. Live sub-nav chips: **Overview · Teams ·
Records · Comparator**. Data-layer stages (G/H/I) + a second J polish remain for near/after the Cup.

### Plan & first-order requirement
Plan generated 2026-06-14 via a 5-sub-agent workflow; scope = **4 data layers** (✅ existing · 🟡🧩
cheap additions · 🔴 player data · 📝 editorial). **First-order requirement — graceful degradation:**
when a datum is missing, the UI must not break **nor reveal to the end user that anything is missing**
— no `—`, no empty cards, no "coming soon". A datum/section renders only when complete enough to be
authoritative; otherwise it is **removed from the DOM** (not hidden). Sub-nav chips of empty sections
disappear too; `loadData()` tolerates a missing optional file (empty default, not an exception).

### Stage A — degradation engine + scaffolding
- **Fault-tolerant `loadData()`:** the 6 core files still **throw** on failure (fatal); 6 optional
  layers (`players`, `player-events`, `awards`, `keeper-stats`, `curiosities`, `all-time-baselines`)
  load via `loadOptional(name, fallback)` → absent/404 returns the empty default **silently**, warns
  only on a present-but-malformed file. Core + optional fetch concurrently.
- **Section-gating — `SECTIONS` registry in `stats.js`:** each section `{ id, navKey,
  available(model), body(model) }` renders (and shows its chip) only when `available` holds; else it
  is **omitted from the DOM entirely** and the nav never points at emptiness.
- **Sticky scrollspy sub-nav:** hero + `<nav.stats-subnav>` (anchor chips) + one section per
  available section + footer. Chips are `<a href="#stats-{id}">` but **`preventDefault` +
  `scrollIntoView`** — they **NEVER set `location.hash`** (the tab router listens on `hashchange`; a
  real `#stats-teams` would route to an unknown tab → bounce to Home). Scrollspy is **position-based**
  (rAF-throttled `scroll` reading `getBoundingClientRect`) + an explicit "at page bottom → last
  section" rule (an IntersectionObserver band left a short final section unlit).
- **`--header-h` CSS var** kept live by `trackHeaderHeight()` (`ResizeObserver` on the variable-height
  sticky header). Sub-nav sticks at `top: var(--header-h)`; sections use `scroll-margin-top`.
- **Media fallback (§0.3):** `flagImg(team,w,h)` emits the flag with `data-monogram="<id>"`; a
  one-time capture-phase `error` listener replaces a broken flag with a 3-letter `<span.flag-fallback>`
  — never a broken-image icon.

### Stage B — verdict hero + goals-by-round
- `heroHTML()` → `model.verdict ? verdictHeroHTML() : aggregateHeroHTML()`. The verdict hero (champion
  + 2/3/4 podium, shared count-up tiles) is **gated on the REAL final:** `computeVerdict()` reads
  `getBracketTree().nodesByRef.get('FINAL')` and returns `null` unless
  `status==='finished' && !simulated && winner` (a user's simulated champion never leaks). Falls back
  to the aggregate "in progress" hero until the final is really finished.
- **Goals-by-round chart** (Overview): group stage split into 3 matchdays (`computeGroupMatchdays`:
  sort each group's 6 fixtures by kickoff, chunk into pairs — `matches.json` has no matchday field)
  plus each knockout round. Hidden until ≥2 rounds have data.

### Stage C — final ranking 1–48, favorites, team records
- **Canonical ranking 1–48 (`assignRanks` → `computeRankTiers`):** primary key is the deepest stage
  **reached** from REAL knockout results (champion 0 → … → group 7), then points → GD → GF → id.
  **Real results only** (same `!simulated && finished` gate as the verdict). During groups everyone is
  tier 7 → it's the global points table; post-knockout the champion is #1 even with fewer points.
- **`#` column = canonical rank AND the default sortable header.** The `#` cell always shows the
  canonical rank regardless of active sort; non-rank sorts fall back to `a.rank - b.rank`.
- **Favorite-team row highlight (gold):** `row-fav` when `getFavorites()` includes the team;
  `favchange` re-renders the table only (favorites aren't in the model). Highlight-only, no stars.
- **Team record cards (Teams):** longest win streak (≥2, hidden below) + champion's path (gated on
  verdict). `stats.js` imports `getFavorites` (storage.js) + `openMatchModal` (modal.js).

### Stage D — Records section + format-48 debuts
- `records` section is **always available** (`body: recordsSectionHTML`). Sub-nav = Overview · Teams ·
  Records. **Match-record cards live here:** biggest win (margin) + highest-scoring match (combined
  goals); high-score card **deduped** when it's the same match as biggest win. (`biggestWin` moved out
  of Teams into Records for a clean C/D split.)
- **"Format debuts" band:** firsts of the 48-team era (48 teams, 104 matches, 12 groups, "Round of 32"
  via `translatePhase`, 8 best thirds advance, first 48-team champion — lights up post-final from
  `model.verdict`). Counts come from `getData()`/model, not hardcoded.

### Stage E — SKIPPED (Option B, 2026-06-17)
The in-tab 104-match results archive will **not** be built. The Matches tab (`schedule.js`) already
lists all 104 with filters/search/sort/occurrence/"My matches"/modal — an in-tab archive would
duplicate it. The footer keeps a **"See all matches →"** link (`#stats-see-matches` →
`navigateTo('matches')`). The `archive` entry stays `available:()=>false` / `body:()=>''` — a dormant
slot, **don't delete the registry line**. If revisited, the lighter "phase-accordion, results-only"
variant (Option C) was the recommended shape.

### Stage F — team comparator
- `comparator` section, `available:(m)=>m.finishedCount > 0`. Two `<select>`s (alphabetical, 48
  teams) default to the **top-2 ranked**; choice survives langchange (module-level `cmpA`/`cmpB`). On
  change, only the bars panel re-renders. **Diverging mirrored bars** scaled to `max(a,b,1)`; higher
  side's number gold. Metrics `CMP_METRICS` are all non-negative (P, W, GF, GA, CS, Pts — **GD
  excluded**, it can be negative). `cmp-grow` scaleX animation, off under `prefers-reduced-motion`.
- **Players side deferred to Stage H** (graceful degradation, not the plan's literal Teams/Players
  toggle — a disabled toggle would be a visible dead control). Teams comparator only for now.

### Stage J round 1 — release polish + merge to master (2026-06-17)
Polish over A–F: i18n audit (no hardcoded strings), a11y (sections `aria-label`led + `tabindex=-1`,
table caption + sort buttons + `aria-sort`, sub-nav is a `<nav>`), reduced-motion gating, cross-tab
regression — **no code fixes were needed**. README got a Stats bullet. **Deferred to the actual
deploy:** the Lighthouse run (the once-deferred final `DATA_VERSION` bump is moot — `DATA_VERSION`
was removed 2026-06-18). **Merge sequence:** merge latest
`master`→branch (resolve conflicts on the branch, never on master), re-verify, then `master ← branch
--no-ff`. Pushing to origin (which triggers the deploy) is the user's explicit final go.

### Sub-nav polish — inner track + edge fades + spy-suppress (2026-06-17, on master)
- **Edge fades** mirror the header tabs: chips live in an inner `.stats-subnav-track` (the scroll
  container); the fade `mask-image` is on the **track**, so the pill's background/rounded ends stay
  crisp. `.stats-subnav` is `overflow:hidden`; `updateSubnavFades(nav)` toggles `.fade-left/-right`
  from the **track's** scroll metrics. All sub-nav scroll JS targets the track, not the nav.
- **Scrollspy "jump" on chip click fixed:** a chip click sets `suppressSpyUntil = Date.now()+700`
  (0 under reduced-motion) and `updateSpy()` early-returns while suppressed, so the clicked chip owns
  the active state until the smooth scroll settles.

### Leader cards — tied-team carousel (2026-06-19)
The Team-statistics "leader" cards (Best attack / Best defense / Most clean sheets) became a
**config-driven set of 6** and each now **rotates through ALL teams tied on its headline metric**
(was: only the single top team). New cards: **Most wins**, **Most goals conceded**, **Best goal
difference** (GD value shows a `+` sign when positive).
- **Tie grouping is by the headline metric ALONE** (decided via /grill-me) — `gf` / `ga` / `cleanSheets`
  / `won` / `ga` / `gd` — *not* the secondary tiebreakers, so e.g. all teams level on goals-for share
  one card. Within the group the existing `cmp` (with tiebreakers) sets order, so the **first team
  shown is unchanged** from before. Driven by the `LEADER_CARDS` array in `stats.js`; `computeLeaders`
  now returns `[{ id, labelKey, metric, group: Row[] }]` (was an object of single rows).
- **Carousel UX:** auto-advance every `ROTATE_MS = 3500`; **pauses on hover/focus**, **disabled under
  `prefers-reduced-motion`** (arrows still work). ◀▶ arrows are **circular** (wrap-around); a manual
  click effectively restarts the cadence (it resumes fresh on pointer/focus-leave). Indicator =
  **dots** (one per tied team, active = gold) up to `DOTS_MAX = 8`; **above 8 the dots become an
  `"i / n"` counter** (keeps the card compact — e.g. early-Cup Best defense routinely has 8 teams at
  GA 0). A **1-team group renders the plain static card, identical to before** (no arrows/dots/timer).
- **Timer lifecycle (cf. gotcha #6):** `setupLeaderCarousels(root)` runs at the end of `render()`;
  intervals are tracked in module-level `leaderTimers` and **cleared at the top of `render()`**
  (`clearLeaderTimers()`) so a `langchange`/`datachange` re-render never leaves a timer firing on
  detached DOM. `favchange` does not touch these cards, so their carousels survive it untouched. Only
  the flag+name swap on rotate — the big value is shared by the whole tied group, so it never changes.
- i18n keys added (EN+PT): `stats.mostWins`, `stats.mostConceded`, `stats.bestGoalDiff`,
  `stats.leaderPrev`, `stats.leaderNext`. CSS: `.leader-stage/.leader-nav/.leader-dots/.leader-dot/
  .leader-counter` in `stats.css`.

### Partial stats tab built during the Cup (foundation, 2026-06-14)
The 6th `stats` tab was first shipped incrementally as the evolving foundation of the post-Cup plan
(same tab/module; post-Cup sections "light up" later). Files: `assets/js/stats.js` +
`assets/css/stats.css`. Philosophy (decided via /grill-me): current-to-date aggregates, **only
`status==='finished'`** (consistent with `computeStandings`); "X of 104" is framing, not a gap.
`aggregateTeams()` is its own tournament-wide aggregation (group + knockout); optional per-game
`stats` enters with per-game gating. Memoized model (`let model`), re-render of labels on `langchange`.

---

## Patterns & How-tos

### How to add a UI label
1. Add the key to **both** `en` and `pt` dicts in `assets/js/i18n.js`.
2. Use `t("key")` at the render site — never hardcode UI text in HTML/JS. (Data values — team/stadium
   names, cities — come from JSON and are **not** translated.)

### How to add a new localStorage preference
1. Extend the `wc2026_prefs` shape (document the new field here).
2. Read/write only via `storage.js` `get`/`set`.

### Tooltips + mobile legend (2026-06-14)
- Table-header abbreviations (Stats team table + the 12 Groups tables) get a **custom glass tooltip**
  (not native `title`). `initTooltips()` in `app.js`: a single `position:fixed` `.app-tooltip` via
  event delegation on `document` (so it survives re-renders and is never clipped by `overflow-x:auto`
  containers); clamps to viewport, flips below if it doesn't fit above.
- **Give a header a tooltip:** add `has-tip` + `data-tip="<text>"` + `aria-label="<abbr> — <text>"`;
  texts in `i18n.js` namespace `tip.*` (EN/PT), reused by both tables.
- **Mobile legend:** `<p class="stats-legend">` (`display:none` desktop, `flex` ≤600px) — covers
  touch where hover doesn't fire. `legendHTML()` in `stats.js` / `groups.js`. CSS lives in
  `stats.css` (loaded globally, so it also applies to Groups).

### How to add a stadium SVG
Follow the trimmed structure of the 16 existing ones (chrome stripped 2026-06-14 — `stadiums.js`
renders name/city/capacity as HTML, so the SVG must **not** duplicate them): `<svg viewBox="...">`
(**no** `width`/`height`) → `<defs><style>` with only the
`struct/thin/hair/concrete/stands/canopy/void/pitch/pline/acc/accs/green/ribs/louver` classes +
`frit` pattern → a single `<g>` illustration cropped tightly (~10px padding). Aim for a viewBox aspect
ratio near **4:3** (~1.2–1.3) to match `.stadium-img { aspect-ratio: 4/3; object-fit: cover }` in
`style.css` (4:3, not 16:9 — the SVGs' natural ratios are ~1.07–1.32, and 16:9 cropped ~28% of
height, slicing the illustrations). The white tower shapes on some cards (`class="void"`) are the
press-box/scoreboard — intentional, don't remove.

### PWA — installable (Tier 1, 2026-06-16)
Scope shipped = **Tier 1** (manifest + icons + meta tags) — meets every install criterion; **no JS
changed**. Files: `manifest.json` (root), `favicon.ico` (root), `assets/icons/` (icon.svg master +
192/512 PNGs any + maskable + apple-touch 180 + favicon-16/32). `index.html` `<head>` got the PWA
block (manifest link, `<meta theme-color #081421>`, favicons, apple-mobile-web-app-* meta). Manifest:
`name "World Cup 2026 Hub"` / `short_name "WC 2026 Hub"`, `display:standalone`, colors `#081421`
(`--bg-primary`), `start_url:"."` + `scope:"./"` **relative** (gotcha #2). Named `manifest.json` (not
`.webmanifest`) for safe MIME on Hostinger. **To change the icon:** edit the SVG(s) and re-run the
ImageMagick rasterize commands (`magick -background none icon.svg -resize NxN ...`; favicon.ico =
16+32). **Tier 2 (service worker / offline) is deliberately deferred** — see `issues.md`; if built it
**must exclude `data/*.json`** from the cache or it breaks the live-refresh poll.

### Responsive header — 2 bands + scrollable tabs (2026-06-15)
Single-row flip (`.tabs { flex:0 1 auto; margin-inline:auto }`) moved from `@media (min-width:768px)`
→ **`@media (min-width:1100px)`** (single row needs ~950px of content; below that the controls
overflowed). Below 1100px: **two stable bands** (band 1 = logo + controls, band 2 = scrollable tabs).
Edge fades via `mask-image` toggled by `updateTabFades()`; active tab kept visible via
`scrollActiveTabIntoView()` (uses `scrollLeft`, **not** `scrollIntoView`, to avoid scrolling the
page). The time button collapses to a 🕐 icon at ≤420px (a11y intact via `data-i18n-aria`). This
supersedes the old "768–1439 single-row header" note.

### Docs — README showcase + DEVELOPMENT.md split (2026-07-04)
The root README was reframed (via /grill-me) from a dev/maintenance guide into a **non-technical
showcase** (English): tagline, shields.io badges, prominent live-demo link
(**https://app.lucaskalil.com/worldcup2026** — the public URL since the 2026-07-05 cutover; was
`lucaskalil.com/worldcup2026` on Hostinger, not previously recorded anywhere),
per-page **screenshot gallery** (Home/Matches/Groups/Knockout/Stadiums/Stats), and a plain-language
"Under the hood" section. All the old technical content (run locally, project structure, JSON
maintenance, local storage, deploy, acceptance criteria, roadmap) moved to a new **`DEVELOPMENT.md`**;
the README's stale "mock data / GitHub Pages" framing was corrected to real-data + the real Hostinger
deploy. Screenshots live in **`docs/screenshots/*.png`**, captured with **headless Edge**
(`msedge --headless=new --window-size=1366,H --virtual-time-budget=6000 --lang=en-US --screenshot`,
`--lang=en-US` forces the EN UI; served from Claude Preview `worldcup2026` on :8126) — repeat that to
refresh them. **Deploy exclude updated** to drop `docs/` + `DEVELOPMENT.md` (docs never ship to the
live site — see Deploy runbook). No app-code/version change (`APP_VERSION` untouched; docs are
excluded from deploy).

### How to record a decision (after finishing a unit of work)
1. Tick the item in `.agents/TODO.md`.
2. Append the new decision/gotcha/pattern to the right section here (don't rewrite existing entries;
   don't add dated refresh logs — those go in git + the Current State rolling window).
3. Rewrite `project-map.md` if structure/functions changed.

---

## Current State

**Updated 2026-07-19 (Final day).** **Bracket redesign Steps 1–4 COMPLETE on `master`**: the
Knockout tab has 3 switchable views — center-out wallchart (desktop default), radial "orbit" (flag
tokens per the user's reference image), rounds pager (mobile default, button-only navigation, ≤2
columns) — plus the Step 4 champion celebration (gold real / blue sim). The home has a post-Cup
state (champion epilogue + awaiting-result fallback) that lights up by itself when tonight's Final
result is published. See Architecture → "Bracket redesign" (both entries) and "Post-Cup home hero +
Bracket Step 4 celebration".
`thirdPlaceAssignment` **FILLED** (8 best thirds → R32 — see the rolling refresh list below).
Cache-busting is now automatic (`?t=Date.now()`; `DATA_VERSION` removed 2026-06-18). `APP_VERSION = v1.1.0`
(bumped 2026-07-19; v1.0.4 same day was the stats knockout-resolution fix + non-fatal view init —
see those entries).
**Data as of 2026-07-19 (tournament COMPLETE):** **104/104 finished.** The Final (104) ended
**ESP 1–0 ARG after extra time** — **Spain are World Champions**; the post-Cup hero epilogue and the
gold champion celebration are live (verified, non-simulated). No further daily refreshes are due.
Build: all 12 steps + real-data migration
done; Stats stages A–D + F + J(r1) merged to `master` and live (E skipped). Stats Team-statistics
leader cards now rotate through tied teams + 3 new metric cards (Most wins / Most goals conceded /
Best goal difference) — see Stats Screen → "Leader cards — tied-team carousel".

### Recent refreshes (rolling — keep the last 3, prune older; full detail in git)
- **2026-07-19** — **FINAL (match 104): ESP 1–0 ARG (a.e.t.)** at MetLife Stadium, New York/New
  Jersey. Ferran Torres 106' (assist Nico Williams, seconds into the second period of extra time);
  0–0 after 90. Enzo Fernández (ARG) sent off 90+3' for a second yellow, so Argentina played extra
  time with 10. **Spain's 2nd World Cup** (first since 2010); reported as Messi's last World Cup
  match. Confirmed FIFA match centre + ESPN (+ Yahoo/Fox live coverage). Stats: poss 65/35, shots
  20/2 (ESPN, xG 1.94 × 0.17), cards 0/5 (ARG: L. Martínez, Paredes, Enzo ×2 → red; Spain unbooked).
  No `penalties` field — decided in extra time. Verified in preview: FINAL home=ESP away=ARG,
  champion ESP `simulated:false`, hero epilogue + stats verdict + gold celebration all lit,
  console clean.
- **2026-07-09** — **QF-1 (match 97): FRA 2–0 MAR** (Gillette Stadium, Boston) — Mbappé 60' (his 8th
  of the tournament) and Dembélé 66' sent France to a 3rd straight semifinal; Bounou saved a Mbappé
  penalty in the first half. France remain the only team to win all 6 games in regulation. 2-source+
  confirmed FIFA match centre/CNN/NBC News/Fox Sports/Yahoo/Olympics.com/Boston.com/ESPN. Stats: poss
  48/52, shots 24/4 (ESPN match box). Cards 0/1 (Diop MAR 63' only — no France booking reported across
  Sofascore/ESPN live blog/Fox boxscore). Regulation, no penalties. Winner propagated: FRA → SF-1
  (verified in bracket). Next: QF-2 ESP×BEL (98, 2026-07-10 19:00 UTC).
- **2026-07-07** — **R16 ids 95–96** (committed same day, `2a626d5`/`4e4ad72` — this run is a memory
  catch-up, per-goal detail wasn't logged at the time): Match 95 (R16-7): **ARG 3–2 EGY**. Match 96
  (R16-8): **SUI 0–0 COL, SUI 4–3 pens**.

> **Gap note (2026-07-19):** refreshes for **QF-2/3/4 (98–100), both SFs (101–102) and the
> third-place match (103)** were committed + pushed normally between 07-10 and 07-18 but never got a
> Current State entry — same pattern as the 07-03→07-07 gap below. Scores and stats are in
> `results.json` and git; the per-match narrative for that window wasn't captured.

> **Note (2026-07-09):** memory went unmaintained 07-03→07-07 while daily data commits + pushes
> continued normally (R32 ids 83–88 and R16 ids 89–94 finished + committed with the standard subject
> format, just without a following `docs:` commit or Current State update). No data was lost — git is
> authoritative — but the detailed per-match narrative for that window (scorers, source list) was never
> captured and isn't recoverable beyond the scores. If this recurs, catch up memory the same day rather
> than letting it compound.

### Pending / next
- **Dokploy migration — Fase 1+2 DONE.** Fase 2 soak test confirmed 2026-07-09: fetched
  `app.lucaskalil.com/worldcup2026/data/results.json` live and it matched local state through match 96
  exactly (stats included) — auto-deploy has been working transparently across all the 07-03→07-07
  pushes. **Fase 3 (canonical URL) + Fase 4 repo-side DONE 2026-07-05** — `deploy.yml` deleted, every
  URL swapped to `app.lucaskalil.com` (see "Dokploy cutover — FTP retired" above). **Remaining
  out-of-repo (low priority):** delete the `FTP_*` GitHub secrets and clean/redirect Hostinger
  `public_html/worldcup2026/`.
- **Tournament OVER — no more data refreshes.** All 104 matches are `finished`; `/update-worldcup`
  has nothing left to update (running it should be a no-op). Anything further is app work, not data.
  **Note:** R32 id 75 (NED×MAR) card count is single-source (Sofascore, only Diop 47') — never
  re-confirmed; low-stakes, leaving as-is.
- **`thirdPlaceAssignment` — DONE (2026-06-28).** All 8 slots filled from FIFA's official combination
  table; bracket verified. No longer pending.
- **Lighthouse > 90** run (needs a deployed URL).
- ~~**Post-Cup home state**~~ — **DONE 2026-07-19** (shipped in v1.1.0 and now live with the real
  champion; see "Post-Cup home hero + Bracket Step 4 celebration").
- **Stats Stage G** (Layer-2 cheap data — `cards`→{y,r} migration is breaking for `modal.js` +
  `stats.js`; **schedule LATE**, conflicts with daily `results.json` edits), **Stage H** (players +
  the deferred comparator Teams/Players toggle), **Stage I** (editorial), **Stage J round 2** polish.
- **PWA Tier 2** (service worker + offline) — deferred; must exclude `data/*.json` (see `issues.md`).

### Success metrics
Lighthouse > 90; first render < 2s; total JS < 300KB (74 KB measured at build). Spec §18 acceptance
criteria all checked (README checklist).

### Communication
User communicates in an English/Portuguese mix; docs in English where practical (retained PT passages
kept as written). **Ask before each build step** — never chain into the next without explicit go-ahead.
