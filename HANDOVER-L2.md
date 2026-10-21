# Handover — L2 (ROK-1876 tab row "More" menu)

## Where it is
- `0d7ee4d92` feat: TabRow More menu — `web/src/components/ui/tab-row.tsx`, `tab-row-fit.ts` (split + `useTabRowFit`), `tab-row-more.tsx` (`TabRowMore`, `TabRowMeasure`), `tab-row.classes.ts`, `tab-row-more.test.tsx`, `tab-row.test.tsx` (scroller moved to the `<ul>`).
- `94baddfbf` docs: design-system.md TabRow row (More menu + `New pattern:` line), `/dev/design-system` demo `tab-row-more-demo.tsx`, DesignSystemPage test.
- Laptop: the 3 touched specs 74/74 green; web app + test tsc clean on touched files; eslint --quiet clean.
- Fleet slot 4 task `42452d1d3b33`: vitest hub/test/dev + tsc app/test + eslint (result in the final report).

## Decisions (keep them)
- TabRow lives in `web/src/components/ui/` (not `components/hub/` as the brief said) — edited there.
- The More behaviour applies at ANY width when the row overflows (ruling: ≥768 unchanged unless it still overflows), so also the admin `hubs-panel` row.
- Widths come from `offsetWidth` of an invisible measure layer whose labels are CSS `content` (no duplicate text nodes for getByText / screen readers). jsdom has no layout → `clientWidth` 0 → every tab stays in the row, so existing hub tests are unaffected.
- Recompute via ResizeObserver only (fires on observe, before paint) — no synchronous setState in the effect.
- Sideways scroll kept as fallback; the scroller is now the `<ul>` (`tab-row-scroller`) so the menu isn't clipped by the nav.

## Not done
- Bundle sizes not measured (needs a web build + `scripts/check-bundle-size.mjs`).
- No Playwright spec (smoke lane's job). Testids: `tab-row-more-trigger` (`data-active="true"` when it names the active tab), `tab-row-more-menu`, `tab-row-more-item-<id>`, `tab-row-scroller`.
