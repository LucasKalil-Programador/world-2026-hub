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

**Status:** ✅ **Implemented 2026-06-16** (Option A⁺ — "Fixed polling done right"). Full implementation
(functions, files, the 3 reinforcements, the `bracket-config.json` piggyback, verification) is
documented in `project-memory.md` → **Architecture & Decisions → "Live data refresh — poll
`results.json` without F5"**.

**One-line problem it solved:** an open tab loaded `data/*.json` once and never refetched, so a newly
published `results.json` (daily push) only appeared after F5.

**Key decisions worth keeping (rationale):**
- **Not a live-feed problem.** `results.json` is a manual post-match push, so there is no new server
  data *during* a match — a faster "during live" poll buys nothing. A **fixed** 90s poll is correct;
  dynamic/state-based polling was rejected (complexity for no gain, double-schedule risk per gotcha #6).
- **Cache-busting must use `?t=${Date.now()}` + `cache:'no-store'`, NOT `?v=DATA_VERSION`** — that
  constant is frozen in the open tab and Hostinger sends no cache headers (gotcha #2).
- **Signature = full response text**, not a finished-count (a count misses score corrections, `stats`
  backfill on an already-finished match, and added penalties).
- **`thirdPlaceAssignment` lives in `bracket-config.json`, not `results.json`** → on a detected change
  the poll refetches the config in the same cycle (it ships in the same daily push), avoiding a stale
  in-memory `bracketConfig` without per-tick config polling.

---
