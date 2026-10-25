# ROK-1953 L4 handover: web cards + Core declarations + design doc

## Handover

**Status:** L4 done; nothing uncommitted. Commits `1c4a03a18` (card bodies, query layer, helpers), `6dc547646` (Core registration + manifest declarations + MSW + vitest W1–W9), `085c6e6b4` (design-system §4.27 + `/dev/design-system` sample), plus this handover.

Evidence (laptop, from `web/`): `npx vitest run src/components/hub/steam-stats src/plugins src/dev/design-system` → 178 files / 1811 tests pass; `npx tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.test.json` exit 0; `npm run lint` 0 errors (no warnings in touched files); `npm run build` + `node scripts/check-bundle-size.mjs` PASS — app-entry 190.8 / 218.5 KB, hub-page 14.0 / 15.0, DesignSystemPage 20.9 / 24.0; new lazy chunks steam-achievements-widget 1.07 KB gz, steam-playtime-widget 0.61, steam-stats-viewer-callout 1.84, steam-stats-api 0.67. Mutations: dropping the `steam-playtime` manifest decl → ownership guard red (6 tests); making `achievementName` return a hidden name for a masked entry → W1 red (`expected [ 'Demo Secret Ending', …] to deeply equal [ 'Hidden achievement', …]`).

## Files
- `web/src/components/hub/steam-stats/`: `steam-stats.helpers.ts`, `steam-stats-api.ts` (404 → null), `use-hub-steam-stats.ts` (key `['hub-steam-stats', guildId]`, stale 10 min, dynamic fetcher import), `use-steam-stats-visible.ts` (D10), `steam-stats-rows.tsx`, `steam-stats-viewer-callout.tsx`, `steam-achievements-widget.tsx`, `steam-playtime-widget.tsx`, two `*-lazy.tsx`, tests + `steam-stats.test-utils.tsx`.
- `web/src/plugins/core/register.ts` (+ `register.test.ts` W7/W8), `packages/contract/src/plugin-hub-manifests.ts` (two core widget decls), `web/src/test/mocks/hub-steam-stats-handlers.ts`, `web/src/dev/design-system/{hub-widgets-demo.tsx,hub-steam-stats-demo-data.ts}`, `docs/design-system.md` §4.27.

## Selectors for L5 (Playwright)
- Cells: `#hub-widget-core-steam-achievements`, `#hub-widget-core-steam-playtime` (absent entirely when hidden — P2/P3 assert `toHaveCount(0)`).
- Loading: `[data-testid="steam-stats-loading"]`. Bodies: `steam-achievements-body`, `steam-playtime-body`.
- Rows: `steam-race-row` (text = avatar initial + name + "X / Y"), `steam-playtime-row`, `steam-unlock-row`; masked: `steam-masked-achievement` (visible text exactly "Hidden achievement"); sr-only per unlock row "<member>: Hidden achievement, 2.7% of players".
- `steam-rarest` ("Rarest: Hidden achievement · 2.7% — <name>"), `steam-achievements-footnote`, `steam-playtime-footnote`.
- Viewer line `steam-stats-callout`; empty `steam-stats-empty`; button `getByRole('button', { name: 'Link Steam' })` (`data-testid="steam-stats-link"`).
- Seed as B (`community-member-2`): race rows A 5/6, B 3/6; the masked rows must not contain "Demo Secret". Assert the page text never contains `Demo Secret Ending` / `Demo Secret Romance` as B.

## Decisions (do not undo)
1. Race rows = `ok` members only; private/unlinked go to the footnote counts (wireframe). Playtime rows = anyone with `playtimeMinutes > 0` (private keeps library playtime, L3 decision 1).
2. Recent unlocks show 4 of the route's ≤8; "Rare" = `globalPct < 10`, neutral `StatusChip`.
3. Playtime's unlinked-viewer prompt is "Link Steam to add your hours." (the wireframe only drew the race's prompt) — flag to the operator if they want different copy.
4. `useSteamLink` is mocked in vitest (it also fires the steam-status query).
5. "Updated <relative>" uses `syncedAgo`; omitted when `refreshedAt` is null.

## Not done
Playwright P1–P3 + fleet plan (L5). `both families` checked by tokens only — no browser run on the laptop; the verify lane checks `default-dark` + `default-light` on `/dev/design-system#hub-widgets` and the seeded hub.
