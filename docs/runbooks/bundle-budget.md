# Web bundle size budget (ROK-1154)

A gzip budget on every JavaScript chunk the web build emits, so a heavy
dependency landing in the eager bundle fails the PR instead of reaching users.

## What is checked

`node scripts/check-bundle-size.mjs` (from the repo root) reads `web/dist`,
gzips every `.js` file under `web/dist/assets` at level 9 (`.map` and CSS do not
count; 1 KB = 1024 bytes) and compares each against
`scripts/bundle-budget.config.mjs`. Chunks fall into four classes:

| Class | What it is | Budget |
|-------|------------|--------|
| `entry` | The `<script type="module">` chunk `web/dist/index.html` loads | Its own |
| `vendor` | Chunks named after a `VENDOR_CHUNKS` key in `web/vite.config.ts`. Chunks sharing a name are summed (rolldown emits `sentry` as two files) | One per group |
| `lazy` / `shared` | Everything else: routes, charts, shared app code | Named entries for every chunk ≥ 10 KB today; a default cap for the rest, including new chunks |
| `total` | Initial load: the entry plus every chunk `index.html` modulepreloads | One total |

Each budget is the size measured on 2026-09-26 plus 15% (`HEADROOM`). It is a
ratchet against regressions, not a target. The check exits 1 on any overrun. It
also exits 1 when `index.html` or `assets/` is missing, so an empty build never
passes.

Where it runs:

- **`scripts/validate-ci.sh`**: the `Bundle size budget` row, straight after
  `Build (all workspaces)`, in both `--static` and `--full`. It is SKIPPED on
  `--scope=api`, where web is not built.
- **GitHub CI**: the `lint` job's `Bundle size budget` step, straight after
  `Build web`.
- The checker's own `node:test` spec (`scripts/check-bundle-size.spec.mjs`)
  runs in the `Script node:test specs` row or step of both.

Run it by hand with `npm run build -w web && node scripts/check-bundle-size.mjs`.
`--all` lists every chunk, and `--dist <path>` points it at another build.

## Reading the table

```
chunk                       class    gzip KB  budget KB  headroom
CategoricalChart-….js       lazy        75.4       86.7  11.3 KB (13%)
sentry [2 files]            vendor      88.3      101.6  13.3 KB (13%)
initial load [57 files]     total      490.7      564.4  73.7 KB (13%)
```

- **headroom** is budget minus size, with the percentage of the budget still
  free. A failing row reads `OVER by N KB`. The closing `FAIL —` line names every
  offending chunk.
- `[N files]` marks a grouped row: a vendor group, or the initial-load total.
- Chunks under the default lazy cap are collapsed into one `… N more chunk(s)`
  line. Pass `--all` to list them.
- A `note:` line flags a config entry that matched no chunk, for example a
  vendor group that was renamed. It does not fail the check, but it means the
  config has drifted from the build, so fix the entry.

A named chunk whose source module is renamed drops to the default cap, which
is small, so the check usually fails on the new name. Rename its entry then.

## When the check fails

First, find out what grew. Run `npm run analyze -w web` (next section) and look
for the dependency that moved. The usual cause is a static import of something
heavy (recharts, react-force-graph-2d) from an eagerly loaded module. Load it
through a lazy route or a dynamic `import()` instead.

## Raising a budget deliberately

Only do this when the growth is intended and worth its cost.

1. In the same PR, edit `scripts/bundle-budget.config.mjs`. Update the
   `BASELINE_KB` value, or the `kb` of the `LAZY_NAMED` entry, to the new
   measured size from `node scripts/check-bundle-size.mjs --all`. Re-date the
   baseline comment. Add a `LAZY_NAMED` entry (with a `why`) for any new chunk
   over the default cap.
2. In the PR body, state which budget moved, by how much, and why.
3. Never raise `HEADROOM` to get one chunk through. That loosens every budget
   at once.

The file sits under `scripts/**`, which is in the CI `code` filter, so a
budget-only PR still runs the `lint` job.

## Treemap: `npm run analyze -w web`

Runs a production `vite build` with `ANALYZE=1`. That loads
`rollup-plugin-visualizer`, which writes an interactive treemap with gzip sizes
to `web/.bundle-report/stats.html`. Open it in a browser. The directory is
gitignored.

The report is **never** written into `web/dist`: `Dockerfile.allinone` copies
dist into the nginx image, so a report there would publish the module map in
production. Without `ANALYZE` the plugin is never imported, and a normal
`npm run build -w web` is unaffected.
