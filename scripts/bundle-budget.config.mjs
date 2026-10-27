/**
 * bundle-budget.config.mjs — ROK-1154 web bundle-size budgets, read by
 * `scripts/check-bundle-size.mjs`.
 *
 * Operator ruling 2026-09-27: each budget is TODAY's measured gzip size +15%
 * (HEADROOM), per class. A budget is a ratchet against regressions, not a
 * target: the story's absolute limits (entry 250 KB, vendor 200 KB, route
 * 100 KB) sat so far above the real sizes that moving recharts into the entry
 * would still have passed.
 *
 * Units: KB = 1024 bytes of `zlib.gzipSync(file, { level: 9 })` output.
 * Per-chunk budgets cover `.js` chunks under `web/dist/assets` only; the
 * stylesheets index.html links count toward `totalInitial` alone. `.map`
 * files never count.
 *
 * Baseline measured 2026-09-26 from `npm run build -w web` on origin/main
 * 542b542a2 (Vite 8 / rolldown, 175 JS chunks, 1041 KB gz in total).
 *
 * Recapture (only on a PR that intentionally grows the bundle): rebuild, run
 * `node scripts/check-bundle-size.mjs --all`, copy the new "gzip KB" values
 * into BASELINE_KB below, re-date this comment and justify it in the PR body.
 * This file lives under `scripts/**` so editing it trips the CI `code` filter.
 *
 * Raising one chunk's budget (operator ruling 2026-10-23): set its baseline to
 * the chunk's NEW measured gzip KB so the budget lands at measured +15%. Never
 * nudge the baseline to the smallest value that passes: a budget with 0%
 * headroom fails the next story's gate for 0.1 KB (hub-page did this on most
 * hub stories in October). Justify the new baseline in the PR body.
 */

/** Growth allowed over the measured baseline before the check fails. */
export const HEADROOM = 1.15;

/** Baseline KB × HEADROOM, rounded UP to 0.1 KB. */
export const withHeadroom = (kb) => Math.ceil(kb * HEADROOM * 10) / 10;

/** Measured 2026-09-26 (gzip -9 KB). Budgets below are derived from these. */
export const BASELINE_KB = {
  // The `<script type="module">` chunk index.html loads (index-*.js).
  entry: 143.67,
  // Entry + every chunk index.html loads eagerly (57 files: the entry script
  // plus every `<link rel="modulepreload">`), plus the stylesheets it links
  // (2 files: index-*.css + calendar-vendor-*.css, 39.59 KB) — they load and
  // block render on every page. Catches growth that is spread across many
  // small eager chunks, or moved from a vendor chunk into another eager chunk,
  // which no per-chunk budget would notice.
  // Recaptured 2026-09-26 when CSS joined the total: 490.70 JS + 39.59 CSS
  // (the JS-only baseline was 490.71).
  totalInitial: 530.29,
  // Keys are the output chunk names from VENDOR_CHUNKS in web/vite.config.ts.
  // Rolldown emits @sentry/react as TWO `sentry-*` chunks; every chunk
  // sharing a vendor name is summed into one group. Recaptured 2026-10-14 for
  // Sentry 11: Session Replay moved to its own lazy `sentry-replay` chunk
  // (below), so the eager group fell 88.27 -> 55.49 KB (54.24 + 1.25).
  vendor: {
    'react-vendor': 62.54,
    'query-vendor': 10.02,
    'calendar-vendor': 62.49,
    sentry: 55.49,
    socket: 12.38,
  },
  // Largest lazy chunk WITHOUT a named entry below (game-detail-page when
  // measured; it has its own entry since ROK-1797). Its
  // +15% is the default cap for every other lazy/shared chunk, including new
  // ones — a new chunk bigger than this needs its own named entry.
  lazyDefault: 9.76,
};

/**
 * Named lazy/shared chunks: every non-vendor chunk ≥ 10 KB gz today. Rolldown
 * names a chunk `<name>-<8-char hash>.js`; the checker strips the hash, so
 * `name` is the stable part and survives every rebuild. It changes only when
 * the source module is renamed — the chunk then falls to the default cap and
 * the check says so, which is the moment to rename the entry here.
 * `pattern` covers dependency-owned names that change on a version bump.
 */
const LAZY_NAMED = [
  { name: 'CategoricalChart', kb: 75.37, why: 'recharts core, shared by every chart' },
  { name: 'SocialGraphCanvas', kb: 56.55, why: 'react-force-graph-2d (insights)' },
  { name: 'use-auth', kb: 3.9, why: 'api client + auth hooks; +0.4 KB ROK-1811 viewer-private cache drop on identity change. ROK-1803 re-measured 3.7 -> 3.9 KB: with the contract package `sideEffects: false` the contract schemas the auth hooks use now ship with them instead of in the old shared `dist` chunk' },
  { name: 'schemas', kb: 25.11, why: "zod v4 runtime only (zod/v4/core + classic + the en locale; 0 contract modules per the .js.map sources) — rolldown names it after zod's schemas module. ROK-1803: `packages/contract/package.json` `sideEffects: false` lets rolldown tree-shake the @raid-ledger/contract barrel per importer, so each schema now ships with the chunks that use it. Before: one shared `dist` chunk (zod + every contract schema) 48.8 KB gz; after: this zod-only chunk 25.1 KB gz, sum of all JS 1171.6 -> 1165.7 KB gz. A schema used only by a lazy route no longer reaches this chunk (measured: +0.95 KB on lfg-group-page, 0 here). zod's own size moves it, contract schemas never should" },
  { name: 'lineup-detail-page', kb: 27.51, why: 'route' },
  { name: 'chart-chrome', kb: 26.64, why: 'recharts (bar/line/radar) — ROK-1937: the shared token tooltip/axis module web/src/components/ui/chart-chrome.ts now sits in this shared chunk, so rolldown names it after that module (was `BarChart`); same chunk, +0.26 KB gz measured, baseline unchanged' },
  { name: 'games-page', kb: 19.7, why: 'route' },
  { name: 'scheduling-poll-page', kb: 18.8, why: 'route; ROK-2020 baseline reset to the measured 18.8 KB gz (was 16.29, cap 18.73) per the 2026-10-23 raise rule: the Manage-menu Remove participant row + its confirm dialog live only on this page' },
  { name: 'SchedulingWireframesPage', kb: 16.18, why: 'DEMO_MODE dev route' },
  { name: 'DesignSystemPage', kb: 20.8, why: 'DEMO_MODE dev route; ROK-1942 baseline reset to the measured 20.8 KB gz (was 17.9, cap 20.6) per the 2026-10-23 raise rule: the hub Gallery widget + dialog demo (DEMO_MODE-only, dev route never shipped to members) grew the chunk 0.2 KB past the cap; +0.7 KB ROK-1837 §4.25 map viewport demo (FogCanvas, PinLayer, MapControls + demo data have no other eager importer, so they land in this chunk; a lazy split measured +0.3 KB, not less — same as the ROK-1595 band); measured 20.1 KB gz vs the 19.5 cap, operator-approved 2026-10-19; +0.26 KB ROK-1595 busy band, radio cards, away rows (their components are already shared chunks, so a lazy split measured +0.2 KB, not less); +0.3 KB ROK-1774 §4.22 server-schedule layer frame; +0.9 KB ROK-1785 TabRow demo (TabRow + useHashTab have no other importer yet, so they land in this chunk until the guild page ships); +0.3 KB ROK-1876 TabRow More-menu demo + 320px row (a lazy split measured 21.6 KB, worse), cap 20.6 KB operator-approved 2026-10-22' },
  { name: 'SimplifyWireframesPage', kb: 14.61, why: 'DEMO_MODE dev route' },
  {
    pattern: /^chunk-[A-Z0-9]{8}$/,
    label: 'chunk-* (react-router)',
    kb: 13.65,
    why: "react-router's own dist chunk name (chunk-BV7QT456 today); it changes on a react-router bump",
  },
  { name: 'markdown-editor', kb: 138.9, why: 'ROK-1868 TipTap 3.31.4 + ProseMirror + @tiptap/markdown (marked); lazy, loaded only when an editor opens the hub post composer/editor (or /dev/design-system); never modulepreloaded. The only path in is the dynamic import in `ui/markdown/lazy-markdown-editor.tsx` (guarded by lazy-markdown-editor.guard.test.ts); measured 138.9 KB gz 2026-10-20' },
  { name: 'sentry-replay', kb: 38.8, why: 'Sentry 11 Session Replay, dynamically imported after Sentry.init (src/lib/sentry-replay.ts); split out of the eager sentry vendor group' },
  { name: 'app-entry', kb: 190.0, why: "Operator ruling 2026-10-25: baseline recaptured to the measured 190.0 KB (main dc378ca86: 194,552 B gz, 8 B under the old 190 KB cap; per-build chunk-hash noise of ~±15 B failed PR #1796 at random, its app-entry byte-identical to main's minus hashes), so the budget is 218.5 KB, measured +15%; ROK-1901 (app-entry diet) still owed. Operator ruling 2026-10-22: raised 187.7 → 190 KB to unblock UI branches while ROK-1901 (app-entry diet) brings it back down. ROK-1779: the former entry body (App, router, query client, shared core). main.tsx now imports it dynamically, after the telemetry decision and Sentry.init, so Sentry's fetch/XHR wrappers exist before native-fetch.ts captures them; measured 2026-10-15, and the index-* entry fell to 5.4 KB by the same move" },
  { name: 'calendar-page', kb: 13.4, why: 'route; +0.7 KB ROK-1893 P4 hub chip + hub filter on the calendar (operator ruling 2026-10-22: raise to 15.5 KB limit; lazy-splitting the filter grew the chunk), +0.13 KB ROK-1775 server-schedule layer in Month (date-header glyph) and Schedule (muted rows), +0.1 KB Schedule lists server-only days with a muted header (Lead ruling) — the layer pieces share the calendar chunk with CalendarView, their only importer' },
  { name: 'lfg-group-page', kb: 11.81, why: 'route' },
  { name: 'valheim-planner-hub-tab', kb: 11.84, why: 'route; ROK-1948 Planner spoiler gating (withheld-ingredient chips + discovery filter); measured 11.84 KB gz vs the 11.3 default cap (0.5 KB over); operator-approved 2026-10-24' },
  { name: 'game-detail-page', kb: 10.4, why: 'route; was on lazyDefault (9.76). +0.3 KB ROK-1797 per-game notification bell: trigger, anchored popover / BottomSheet panel, deep-link hook; measured 11.6 KB gz vs the 11.3 default cap (fleet build 0.3 KB over). +0.2 KB ROK-1905 Forever hub widgets: five eager WoW plugin registrations (titles, descriptions, useVisible probes + roster-insights hook) ride along wherever the plugin registry loads; measured 11.8 KB gz vs the 11.73 cap (fleet build 0.0 KB over)' },
  { name: 'hub-page', kb: 13.0, why: 'route; was on lazyDefault (9.76). Operator ruling 2026-10-23: baseline recaptured to 13.0 KB (ROK-1918 arrange mode measured 12.9 KB gz + ROK-1893 P3 hub polls), so the budget is 15.0 KB, measured +15%, like every other chunk; earlier raises had nudged the baseline only far enough to pass, leaving 0% headroom and a failed gate on nearly every hub story. +0.3 KB ROK-1891 (operator ruling 2026-10-23): per-kind hub copy + the /hubs path helpers; measured 12.7 KB gz vs the 12.6 cap, cap now 12.9. +0.24 KB ROK-1787 guild S3: Raids tab, schedule, attendance leaderboard, role composition, hero Next-raid chip; measured 11.57 KB gz vs the 11.57 default cap (fleet build 0.0 KB over). +0.9 KB ROK-1788 guild S4: lazy mirror/picker loader glue — the `__vite__mapDeps` preload list for the mirror chunk (1.16 KB gz, ~60 asset paths, since the chunk reaches app-entry); module set otherwise identical to main. Mirror 3.61 KB + picker 1.73 KB split out; measured 12.52 KB gz (main 11.29), cap 12.6. ROK-1830 S5: the route chunk is named `hub-page` since the guild page became the game-agnostic hub (`guild-page.tsx` -> `components/hub/hub-page.tsx`) — same route, renamed entry, baseline deliberately unchanged so the cap stays 12.6. The S5 onboarding checklist first measured 13.0-13.2 KB gz; it is now lazy and editor-only (`hub-overview.tsx`), which brought the chunk to 11.6 KB gz, 1.0 KB under the cap' },
];

const mapValues = (obj, fn) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

/** Budgets consumed by the checker (KB). */
export default {
  entryKB: withHeadroom(BASELINE_KB.entry),
  totalInitialKB: withHeadroom(BASELINE_KB.totalInitial),
  vendorGroupsKB: mapValues(BASELINE_KB.vendor, withHeadroom),
  lazyDefaultKB: withHeadroom(BASELINE_KB.lazyDefault),
  lazyOverrides: LAZY_NAMED.map(({ kb, ...rest }) => ({
    ...rest,
    baselineKB: kb,
    budgetKB: withHeadroom(kb),
  })),
};
