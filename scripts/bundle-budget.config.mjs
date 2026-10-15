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
  // Largest lazy chunk WITHOUT a named entry below (game-detail-page). Its
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
  { name: 'use-auth', kb: 3.2, why: 'api client + auth hooks, modulepreloaded; ROK-1313 the zod + contract barrel half moved to the `dist` chunk (below) when the lazy FeedbackPanel became a contract importer that does not need use-auth — rolldown split the old 50.6 KB use-auth chunk into dist 47.5 + use-auth 3.2, same modules' },
  { name: 'dist', kb: 48.2, why: 'zod + @raid-ledger/contract barrel (packages/contract/dist), modulepreloaded; split out of use-auth by ROK-1313 (lazy FeedbackPanel imports FEEDBACK_SCREENSHOT_MAX_BYTES). Inherited use-auth history: +0.9 KB ROK-1754 in-memory token store, boot gate, cross-tab auth, nativeFetch; +1.0 KB ROK-121 Pelican plugin registration (pelican.schema in the contract barrel); +0.2 KB ROK-1313 feedback clientContext schema reach this chunk through the contract barrel (barrel bloat already in TECH-DEBT-BACKLOG); +0.3 KB ROK-1743 character-lockouts schema reaches this chunk through the contract barrel (barrel bloat already in TECH-DEBT-BACKLOG); +0.4 KB ROK-1786 guild-content schemas via the contract barrel (TECH-DEBT 2026-10-15: barrel imports pull every schema into this chunk)' },
  { name: 'lineup-detail-page', kb: 27.51, why: 'route' },
  { name: 'BarChart', kb: 26.64, why: 'recharts bar chart' },
  { name: 'games-page', kb: 19.7, why: 'route' },
  { name: 'scheduling-poll-page', kb: 16.29, why: 'route' },
  { name: 'SchedulingWireframesPage', kb: 16.18, why: 'DEMO_MODE dev route' },
  { name: 'DesignSystemPage', kb: 16.9, why: 'DEMO_MODE dev route; +0.26 KB ROK-1595 busy band, radio cards, away rows (their components are already shared chunks, so a lazy split measured +0.2 KB, not less); +0.3 KB ROK-1774 §4.22 server-schedule layer frame; +0.9 KB ROK-1785 TabRow demo (TabRow + useHashTab have no other importer yet, so they land in this chunk until the guild page ships)' },
  { name: 'SimplifyWireframesPage', kb: 14.61, why: 'DEMO_MODE dev route' },
  {
    pattern: /^chunk-[A-Z0-9]{8}$/,
    label: 'chunk-* (react-router)',
    kb: 13.65,
    why: "react-router's own dist chunk name (chunk-BV7QT456 today); it changes on a react-router bump",
  },
  { name: 'sentry-replay', kb: 38.8, why: 'Sentry 11 Session Replay, dynamically imported after Sentry.init (src/lib/sentry-replay.ts); split out of the eager sentry vendor group' },
  { name: 'app-entry', kb: 163.2, why: "ROK-1779: the former entry body (App, router, query client, shared core). main.tsx now imports it dynamically, after the telemetry decision and Sentry.init, so Sentry's fetch/XHR wrappers exist before native-fetch.ts captures them; measured 2026-10-15, and the index-* entry fell to 5.4 KB by the same move" },
  { name: 'calendar-page', kb: 12.7, why: 'route; +0.13 KB ROK-1775 server-schedule layer in Month (date-header glyph) and Schedule (muted rows), +0.1 KB Schedule lists server-only days with a muted header (Lead ruling) — the layer pieces share the calendar chunk with CalendarView, their only importer' },
  { name: 'lfg-group-page', kb: 11.81, why: 'route' },
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
