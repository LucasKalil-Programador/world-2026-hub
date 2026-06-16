# Issues & Optimization Candidates

Tracked optimization proposals and known issues. Analyzed but not yet implemented.

---

## Event-Driven Scheduling for Match State Transitions (2026-06-15)

**Status:** Analyzed, deferred (no implementation yet)

### Issue
Latency in the Matches tab when a match transitions to "over" state. Currently, the system uses polling (`OCC_TICK_MS = 60s`) to check if any match has entered "over" status (either via JSON `status==='finished'` or clock reaching `kickoff + window`). This causes up to 60 seconds of delay between the actual state change and the UI update (the "Pendente de resultado" chip appearing on a match card).

### Proposed Solution
Implement event-driven scheduling instead of polling:
- Calculate exact timestamps when each match will transition states (kickoff → "live", kickoff + window → "over")
- Use `setTimeout` to schedule precise callbacks for these moments
- Render the list only when a timeout fires
- Revalidate/reschedule timeouts when `getData()` updates (daily refresh)

### Benefits
- **Latency:** Reduced from up to 60s to ~0s
- **Efficiency:** Zero CPU wasted on unnecessary checks between state changes
- **Deterministic:** Transition moments are calculable with precision

### Technical Feasibility
✅ **Viable.** The `matchState()` function already computes state based on kickoff and window, so timestamps are known. Logic to manage ~200 timeouts (104 matches × 2 transitions) is straightforward but requires cleanup/reschedule logic on `getData()` updates.

### Why Not Implemented Yet (Cost-Benefit Analysis)

**Complexity vs. impact trade-off:** The improvement is real but limited:

1. **Limited real-world UX impact**
   - The "match over but JSON not updated" state is **transitory** (~minutes), lasting only until the daily manual refresh lands
   - Most users either watch the **hero** (which updates every 1s and already flips to the next match instantly) or check the Matches tab after a refresh
   - Polling at 60s is already so infrequent (0.017 Hz) that CPU cost is negligible

2. **Moderate implementation cost**
   - Managing 200+ live timeouts and cleaning up old ones on data refresh adds complexity
   - Must handle race conditions: JSON update and timeout firing simultaneously
   - Adds another system to maintain/debug

3. **Narrow use case**
   - Would matter if thousands of simultaneous matches existed, or if users commonly left the Matches tab open for hours
   - Current tournament is 72 group matches + 32 knockout matches (104 total); no real-time data updates (daily manual refresh)

### When to Implement
Only if:
- Latency in the Matches tab becomes a reported UX complaint
- The tournament adds **real-time data feeds** (WebSocket/API polling) instead of manual daily refresh
- Similar polling patterns accumulate elsewhere and warrant a systematic refactor

### How to Implement (if revisited)
1. Create `scheduleMatchStateChanges()` in `schedule.js`
2. For each match, calculate `kickoffTime` and `kickoffTime + matchWindowMs(match)`
3. Schedule `setTimeout` callbacks for both transitions
4. On `getData()` refetch, cancel old timeouts and reschedule
5. Callback directly fires `renderList()`
6. Guard against duplicate timers (similar to `startHeroClock` pattern in `app.js`)

---

## PWA Tier 2 — Service Worker + Offline (2026-06-16)

**Status:** Analyzed, deferred (Tier 1 shipped 2026-06-16 — see project-memory "PWA — installable app").

### Context
The PWA install issue was delivered as **Tier 1** (manifest + icons + meta tags), which already meets
every acceptance criterion (installable, correct name/icon, standalone launch from the OS shortcut, no
app-pipeline risk). Tier 2 — a service worker for offline launch and the strongest cross-browser
"app feel" — was intentionally left out. It is **not** required for the install prompt in modern
Chrome/Edge.

### Why deferred (the real risk)
A naïve precaching SW would cache `data/*.json` and **silently defeat the 2026-06-16 live-refresh
system** (the 90s `results.json` poll with `cache:'no-store'` + the `DATA_VERSION` cache-buster) —
open tabs would stop seeing new scores, and `DATA_VERSION` bumps would do nothing. It would also make
the "stale JS module" gotcha (#5) *permanent* (cached assets live until the cache name changes).

### How to implement (if revisited) — constraints, not optional
1. **Never cache `data/*.json`.** Use network-only, or network-first with the cache only as an
   offline fallback (so an offline launch shows the last-seen results). The 90s poll must stay the
   owner of freshness.
2. **Version the SW cache** with a constant mirroring/derived from `DATA_VERSION`; clean up old caches
   on `activate` — otherwise every code deploy risks serving stale JS forever (gotcha #5).
3. **Register at the subpath** (`worldcup2026/sw.js`) so the SW scope matches the deploy (gotcha #7);
   keep `start_url`/`scope` relative as they already are.
4. App-shell strategy: cache-first (versioned) for `index.html` + `assets/css` + `assets/js` +
   `assets/icons`; precache on `install`.
5. Verify the poll still updates an open tab **with the SW active** (the easy thing to regress).

### When to implement
Only if offline launch / a fuller install experience is actually wanted, and only with the data-cache
exclusion + cache-versioning above. Otherwise Tier 1 is sufficient.

---

## Live Data Refresh — Stale Results Until Page Reload (2026-06-15)

**Status:** ✅ **Implemented 2026-06-16** (Option A⁺ — "Fixed polling done right"). The analysis below
is kept for the rationale; the shipped implementation (functions, files, verification) is documented in
`project-memory.md` → "Live data refresh — poll de results.json sem F5 (2026-06-16, Opção A⁺)".

### Issue
A user with the tab open keeps seeing the data that was loaded once at page load. When the daily
refresh publishes a new `results.json` (final score + stats for a finished match), open tabs do not
pick it up — only a full F5 reloads it. `loadData()` runs once and memoizes `data` in a module-level
variable ([app.js:16-37](../assets/js/app.js)); nothing ever refetches `results.json` afterward.

### Reframe (the key architectural fact)
This is **not** a live-feed problem. `results.json` is updated **manually** (the `/update-worldcup`
runbook: edit → commit → push → FTP deploy), and always **after** a match has ended — never during
play. So:
- During a "live" match there is **no new data on the server** to fetch — the server's `results.json`
  still has no score until the dev pushes the final result.
- The only latency that matters is **"dev pushes the final result → how long until an open tab shows
  it"**, which is bounded by the poll interval regardless of match state.
- The "site feels dead" symptom is already largely solved by the clock-driven hero
  (`matchState`/`heroTick`, [app.js](../assets/js/app.js)) which advances upcoming→live→over and
  switches to the next match with no new data. What's missing is purely **surfacing newly-published
  server data** (final scores + stats) without an F5.

This kills the premise behind the "30s during live" tier of dynamic-polling proposals: there is
nothing new to fetch during the live window, so a faster poll there buys nothing.

### Options considered
- **Fixed polling (5 min) + compare** — right direction; two real but cheaply-fixable weaknesses
  (fixed interval wastes cycles when idle; "finished-count" signature is too weak).
- **Dynamic/state-based polling (30s live / 60s post / 5 min gaps)** — rejected: optimizes a scenario
  the data model doesn't have (no live server data), paying state-machine complexity + double-schedule
  risk (cf. gotcha #6) for no real gain.
- **Fuzzy "smart timing" (lower poll near kickoff)** — rejected (self-refuting): lowering the poll
  10 min before kickoff doesn't help when the update lands ~3h later, post-match.

### Proposed Solution — "Fixed polling done right" (recommended)
Fixed-interval poll of `results.json` only, with three cheap upgrades that remove both weaknesses of
the naive fixed poll **without** the dynamic-polling complexity (~35-40 lines):

1. **Pause when the tab is hidden** (Page Visibility API). `visibilitychange` stops the `setInterval`
   in background and fires one immediate fetch on return. Eliminates the idle/battery cost — ~80% of
   the dynamic option's battery benefit in ~3 lines instead of a state machine.
2. **Stop entirely when nothing remains to fetch.** `clearInterval` once `FINAL` is `over` (tournament
   done) — polling forever afterward is pure waste. (Optionally slow the interval when all of the
   day's matches are already `over` by clock.)
3. **Content-based signature, not finished-count.** Compare the raw response text (or a cheap hash).
   A count-of-finished signature misses score corrections (1-0 → 2-0, same count), **`stats` backfill
   on an already-finished match** (done routinely — see 2026-06-14 stats backfill), and added
   penalties. `results.json` is ~10-20KB, so full-text compare is free and catches everything.

**Cache-busting (mandatory):** the poll must NOT use `?v=${DATA_VERSION}` ([app.js:25](../assets/js/app.js))
— that constant is frozen in the open tab and Hostinger sends no cache headers (gotcha #2), so the
same URL serves the cached copy. Use `data/results.json?t=${Date.now()}` with `cache: 'no-store'`.

### Benefits
- **Latency:** "infinite (needs F5)" → bounded by the interval (~90-120s).
- **Efficiency:** zero polling in background tabs and after the tournament ends; re-render only fires
  when the content signature actually changes (rare — a few pushes/day), so no DOM churn.
- **Low risk:** reuses the existing event-driven re-render pattern; no new state machine.

### Technical Feasibility
✅ **Viable, ~35-40 lines** for the loop. The real work is the **re-render fan-out**, not the loop.
`data` is a single object with **derived maps** ([app.js:30-35](../assets/js/app.js)), so applying new
results means, in order:
1. `data.results = newResults`
2. **rebuild** `data.resultByMatchId = new Map(...)` (consumed by schedule/groups/bracket/stats —
   reassigning `data.results` alone leaves it stale)
3. `invalidateBracket()` (the tree is cached — project-memory step 7)
4. `document.dispatchEvent(new Event('datachange'))`

Each view then re-renders itself on `datachange`, exactly like it already does for
`langchange`/`simchange`/`favchange`/`timemodechange` ([schedule.js:34-36](../assets/js/schedule.js)).
Only a `datachange` listener per view (schedule, groups, bracket, stats, hero) is added — no new
paradigm.

Gotchas:
- **Simulation:** go through `invalidateBracket()` + tree rebuild, not a partial patch, so `decide()`
  (real) and `applySimulation()` (user picks) recombine under the existing "real result wins over sim"
  rule (project-memory step 9). Via the rebuilt tree this works for free.
- **`thirdPlaceAssignment` lives in `bracket-config.json`, not `results.json`** — polling results alone
  would leave the open tab on the old in-memory `bracketConfig` (the 8 third-place slots needing an F5),
  even though the server updated both files together (the poll never fetches the config). **Resolved in
  the shipped version** by piggybacking: when the poll detects a results change it refetches
  `bracket-config.json` in the same cycle and swaps `data.bracketConfig`. The one-time 3rd-place fill
  always ships in the same daily push as a results change, so this costs one extra fetch only on the
  rare change event — no per-tick config polling.
- **Mid-interaction re-render:** a re-render while the user is dragging the bracket, has a modal open,
  or is typing in the search filter could be jarring. Low risk because the signature changes only a
  few times/day; if it bites, defer re-render of the view currently being interacted with.

### Why Not Implemented Yet
Same posture as the entry above: the symptom is real but bounded (a stale tab between a manual push
and the user's next F5), and the hero already keeps the home feeling alive. Worth doing before/at the
knockout stage when more users may keep a tab open, but not urgent.

### Relationship to "Event-Driven Scheduling" (above)
Complementary, not overlapping. That entry is about **clock-state latency** (the "Pendente de
resultado" chip via the 60s `OCC_TICK_MS` poll); this one is about **server-data freshness** (new
scores/stats). Both can coexist: the clock advances state instantly; this poll surfaces the published
result within one interval.

### How to Implement (if revisited)
1. Add `startResultsPolling()` to `app.js` (near the hero clock); call it from `init()`. Guard against
   duplicate timers (`if (resultsTimer) return`, like `startHeroClock`).
2. Each tick: `fetch('data/results.json?t=' + Date.now(), { cache: 'no-store' })` → read as text.
3. Compare text to the last-seen signature; bail if equal.
4. On change: `JSON.parse`, set `data.results`, rebuild `data.resultByMatchId`, `invalidateBracket()`,
   `dispatchEvent('datachange')`.
5. Interval ~90-120s while `!document.hidden`; pause on `visibilitychange` (hidden) + immediate fetch
   on return; `clearInterval` once `FINAL` is `over`.
6. Add a `datachange` listener to schedule, groups, bracket, stats, and the hero (mirrors the existing
   `langchange` listeners).

---
