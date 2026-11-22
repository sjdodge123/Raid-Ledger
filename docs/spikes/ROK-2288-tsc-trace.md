# ROK-2288 spike: type-instantiation hotspots in the api typecheck

Date: 2026-11-22. Base: `origin/main` @ `9de1e02c4`. Run on fleet slot 2 (6 vCPU, 15 GB).

## TL;DR

- **There is no single hotspot worth fixing.** Check time is spread across thousands of files:
  5,310 of the 5,708 checked files take under 10 ms each, and together they account for 15.1 s
  of the 28.4 s of check time. The median file costs 2.4 ms.
- **The suspected Drizzle relational types are real but small and are paid once.** The costliest
  single comparison in the whole program is `ExtractTablesWithRelations<typeof schema>` against
  `TablesRelationalConfig` (426 ms). TypeScript caches the result, so the 1,230 files that type a
  `db` as `PostgresJsDatabase<typeof schema>` or `PgDatabase<…, typeof schema>` do not pay it again.
- **Specs, not app code, are the memory lever.** Adding the spec files (`api/tsconfig.json`
  compared with `api/tsconfig.build.json`) adds +1.43 GB of `Memory used`, +666k types,
  +1.56M instantiations and +14.6 s of check time. That is half of the full program's check time
  and a third of its memory.
- **Recommendation:** do not spend a story rewriting Drizzle or Zod typings for memory. If the
  aim is lower typecheck or lint memory, the only candidate is a project-reference split: specs
  check against the app's emitted declarations instead of re-checking app source. Its peak is
  **unmeasured**. The app-only program peaks at 2.9 GB, but a spec program that imports app
  source (two plain sequential `tsc` runs) still loads app + specs and peaks near the full 4.4 GB,
  so that variant saves nothing. Each type-level fix in the table below saves under 1 s of check
  time and an unmeasured, probably small, amount of memory.

## Method

All commands were run from the repo root on the runner, so `node_modules/typescript` 5.9.3 is used,
not `api/node_modules/typescript` 6.0.3 (see memory `reference_tsc_from_api_dir_picks_tsc6`).

```sh
npm run build -w packages/contract
node node_modules/typescript/lib/tsc.js --noEmit --incremental false --extendedDiagnostics -p api/tsconfig.build.json
node node_modules/typescript/lib/tsc.js --noEmit --incremental false --extendedDiagnostics -p api/tsconfig.json
NODE_OPTIONS=--max-old-space-size=10240 node node_modules/typescript/lib/tsc.js --noEmit --incremental false \
  -p api/tsconfig.json --generateTrace /tmp/rok-2288-trace/out
npx -y @typescript/analyze-trace /tmp/rok-2288-trace/out --forceMillis 120 --skipMillis 80
```

- Peak RSS was measured with Python `resource.getrusage(RUSAGE_CHILDREN)` around each `tsc`,
  because `/usr/bin/time` is not installed on the runner.
- Per-file check time was computed from the `checkSourceFile` B/E pairs in `trace.json`. Each file
  has two pairs, which are summed.
- Type counts per generic come from `types.json`, grouped by `instantiatedType` → `symbolName` and
  by the declaring package of `firstDeclaration`.
- **Gotcha:** `--generateTrace` with the default Node heap **aborts with a core dump** (exit 134)
  while it writes the 400 MB `types.json`. Give it `--max-old-space-size=10240`.
- **Gotcha:** per-file times depend on check order. The first file that forces a shared generic
  (the Drizzle schema config, ioredis `Redis` variance, a Zod chain) pays for it, and the result is
  cached for everyone after it. In the aborted first run a different set of files topped the list.
  So the top files below show where shared types were first computed. They are not files that are
  expensive in themselves.

## `--extendedDiagnostics` totals (tsc 5.9.3)

| Metric | `api/tsconfig.build.json` (app only) | `api/tsconfig.json` (app + specs) | Delta from specs |
|---|---:|---:|---:|
| Files | 6,114 | 8,982 | +2,868 |
| Lines of TypeScript | 413,785 | 1,032,568 | +618,783 |
| Lines of definitions | 363,728 | 395,633 | +31,905 |
| Symbols | 3,036,072 | 5,150,620 | +2,114,548 |
| Types | 878,948 | 1,545,129 | +666,181 |
| **Instantiations** | **5,487,406** | **7,044,043** | **+1,556,637** |
| **Memory used** | **2,839,580K (2.84 GB)** | **4,269,328K (4.27 GB)** | **+1.43 GB** |
| Peak RSS | 2,925 MB | 4,404 MB | +1,479 MB |
| Assignability cache | 450,069 | 674,976 | +224,907 |
| Program time | 1.73 s | 3.22 s | |
| Bind time | 0.86 s | 1.32 s | |
| **Check time** | **11.48 s** | **26.05 s** | **+14.57 s** |
| Total time | 14.08 s | 30.60 s | |
| Errors | 0 | 0 | |

There is no separate spec tsconfig. `api/tsconfig.json` is the spec typecheck (it is what
`validate-ci.sh` runs), and `tsconfig.build.json` only excludes specs, `test/` and
`src/common/testing/**`. The api ESLint config uses `projectService: true`, so lint also builds the
full `api/tsconfig.json` program at about 4.3 GB. That fits ROK-2279's finding that narrowing which
files lint sees saved only 0.14 GB: the type program stays the same size.

With tracing on, the full program peaked at 5,412 MB RSS and took 52.9 s.

## Where check time goes (traced, `api/tsconfig.json`)

- Total `checkSourceFile` time is 28.4 s across 5,708 files: specs and test infra 14.3 s, app code
  14.1 s, `node_modules` about 0.
- The top 10 files take 6.0 s, the top 100 take 9.6 s, and only 17 files take more than 100 ms.
- By area: `plugins` 5.7 s, `discord-bot` 4.0 s, `notifications` 3.2 s, `guilds` 2.9 s,
  `admin` 2.8 s, `lineups` 1.6 s, `events` 1.0 s, `users` 1.0 s, `calendar-sync` 0.9 s,
  `drizzle` (schema, 150 files) 0.8 s.

### Ranked hotspots

| # | Location | Cost | What drives it | Shared, paid once? |
|---|---|---:|---|---|
| 1 | `api/src/admin/demo-test-core.controller.spec.ts` | 1,233 ms file | Jest mock factories (`ReturnType<typeof createMockService>`), plus a 184 ms deferred node at pos 14467 | Mostly, first big jest-mock spec |
| 2 | `api/src/guilds/forum/discord/hub-forum-discord-outbound.service.ts` | 842 ms file | First touch of the forum Drizzle query builders | Yes |
| 3 | `api/src/notifications/roster-notification-buffer.service.spec.ts` | 795 ms file | Jest `Matchers`/`MockInstance` instantiation | Yes |
| 4 | `api/src/notifications/notification.service.ts` | 684 ms file | `PostgresJsDatabase<typeof schema>` injection, 2× 184 ms `checkVariableDeclaration` | Yes |
| 5 | `api/src/notifications/role-gap-alert.service.spec.ts` | 605 ms file | Jest mocks | Yes |
| 6 | `api/src/discord-bot/services/channel-bindings-uniqueness.helpers.ts` | 435 ms file, of which **426 ms is one comparison** | `ExtractTablesWithRelations<typeof schema>` vs `TablesRelationalConfig` (drizzle `relations.d.cts:139`), checking `PgDatabase<PostgresJsQueryResultHKT, typeof schema>` | Yes, cached after the first time |
| 7 | `api/src/users/users-query.helpers.ts:198` | 393 ms file / 374 ms expression | `db.query.users.findFirst` (relational query API over the 168-table schema) | Yes |
| 8 | `api/src/queue/queue.module.ts:25` | 378 ms file / 376 ms variance | `new Redis(...)`: ioredis `Redis<ReplyMapping>` variance computation (307 ms compare); 120 ms more for `ChainableCommander` | Yes |
| 9 | `api/src/plugins/wow-common/forever-instance-aliases.spec.ts` | 339 ms | Imports `dungeon-quest-data.json` (296 KB); the JSON literal type costs 332 ms | Yes, per JSON file |
| 10 | `api/src/igdb/igdb-name-dedup.helpers.ts` | 252 ms file / 194 ms compare | `typeof import("schema")` assigned to `Record<string, unknown>` | Yes |
| 11 | `api/src/guilds/forum/discord/hub-forum-discord-event-lock.ts` | 217 ms | Deeply nested `or(and(...))` SQL helpers in one `.select()`, about 180 ms chain at pos 3427 | Per file |
| 12 | `api/src/plugins/wow-common/data/boss-loot-data.spec.ts` | 215 ms | `boss-loot-data.json` (2.3 MB, 81k lines) literal type, 204 ms | Per JSON file |
| 13 | Zod `.optional()`/`.exactOptional()`/`.refine()` relations | 106–113 ms each, about 8 spans | Zod v4 generic method signatures compared structurally | Mostly |
| 14 | `api/src/users/users-delete.helpers.ts` | 133 ms | Drizzle query builders | Per file |
| 15 | `api/src/notifications/notification-prefs.helpers.ts` | 132 ms | Drizzle query builders | Per file |

### Type volume by origin (`types.json`, 1,545,129 types)

| Declaring origin | Types | Share |
|---|---:|---:|
| Anonymous (object literals, unions, signatures) | 452,159 | 29% |
| `typescript` lib (Array, Promise, iterators) | 266,269 | 17% |
| **`drizzle-orm`** | **250,333** | **16%** |
| **`zod`** | **208,645** | **14%** |
| `api/src/plugins` | 69,072 | 4% |
| `@types/jest` | 58,941 | 4% |
| `api/src/discord-bot` | 51,789 | 3% |
| `ioredis` | 18,900 | 1% |

Most-instantiated generics: `Array` 72.0k, Zod `$ZodType`/`ZodType`/`_ZodType` 70.0k combined,
jest `Matchers` 18.9k, Drizzle `QueryPromise` 15.2k, `PgSelectQueryBuilderBase` 14.7k,
`TypedQueryBuilder` 14.0k, `PgSelectBase` 9.6k, `Column` 9.5k, and `DriverValue{Decoder,Encoder,Mapper}`
about 5.2k each.

Drizzle's cost comes from per-query builder instantiations (one `PgSelect*` chain per query, in
every file that runs queries). The relational `typeof schema` config is not the driver. That
per-query cost scales with how many queries the code base has, and it can't be "fixed" without
changing how queries are written.

Duplicate packages: `@sentry/core` (11.12.0 plus 2× 11.10.0) and `@sentry/conventions` (0.32.0 / 0.29.0).
These add a little to lib parse, nothing material.

## Recommendation

**No type-level fix pays for itself. The structural fix (split the program) does.**

| Option | Estimated saving | Risk |
|---|---|---|
| **A. Project-reference split** (CI typecheck `tsconfig.build.json` with `composite` + declaration emit; a `tsconfig.spec.json` that references it, so specs check against `.d.ts`; lint run per program) | Unmeasured. The app program peaks at 2.9 GB; the spec program's peak depends on how much cheaper the declarations are than app source. Two plain sequential `tsc` runs do **not** help: specs import app source, so the spec program still holds app + specs (≈4.4 GB) | Medium. `composite` + declaration emit for the app is a sizeable tsconfig change. Lint's `projectService` needs an explicit per-glob `project` so it doesn't fall back to the full program |
| B. Drop `{ schema }` from `drizzle()` and the `typeof schema` generic (the relational API is used in only 7 non-spec files) | Under 1 s check (the 426 + 374 + 194 ms spans, paid once); memory unmeasured, estimated in the tens of MB | High churn: 1,230 files name the db type, and the 7 `db.query.*` callers must be rewritten to the select API. Not worth it for the saving |
| C. Type the big WoW JSON imports (`boss-loot-data.json` 2.3 MB, `dungeon-quest-data.json` 296 KB) through a `.d.ts` or a `readFileSync` + Zod parse instead of `resolveJsonModule` literal inference | About 0.55 s check plus the literal types for 81k lines (likely the largest single memory item of the three type-level options; unmeasured) | Low to medium. Runtime loading changes and the data needs a schema. Specs that import them change too |
| D. Annotate ioredis connections as `Redis` with an explicit type and avoid generic variance (`queue.module.ts:25`) | About 0.4 s, paid once | Low, but negligible gain |
| E. Slim jest mock factories (`ReturnType<typeof createMock…>` over large services) | Diffuse, about 1–2 s across specs | Low per file, high total effort; not targeted |

## Suggested follow-up stories (not filed)

1. **`perf: split the api typecheck into app and spec programs`** (option A). Start with a measurement
   spike: build the app with `composite` + declarations, then check a spec-only config that
   references it, both with `--extendedDiagnostics`, to measure the spec program's peak before
   changing CI or lint wiring (a spec config that imports app source would not show a saving).
2. **`perf: load the WoW data JSON without literal type inference`** (option C). First measure
   `Memory used` with the two big JSON imports stubbed, to put a number on it.
3. (Optional, low value) **`chore: dedupe @sentry/core`** so a single version is installed.

## Handover

Done. All numbers above come from fleet slot 2. The raw trace stayed on the runner under
`/tmp/rok-2288-trace` and was not committed. No code was changed. Option A's saving is unmeasured (Codex P2, 2026-11-22: a sequential
split that re-checks app source inside the spec program saves no peak memory).
