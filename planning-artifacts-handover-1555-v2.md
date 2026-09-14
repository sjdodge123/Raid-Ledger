# ROK-1555 v2 — handover (dev-1555-v2)

Branch `spike/rok-1555-heatmap-ballot`, worktree `/Users/sdodge/Documents/Projects/Raid-Ledger--rok-1555`.
Not pushed, no PR. Working tree clean at `a07b4a17`.

## Status — all three clusters DONE, green

| Gate | Result |
|---|---|
| `npx vitest run src/dev/scheduling-wireframes` (from `web/`) | **3 files, 137 tests PASS** |
| `npx eslint web/src/dev/scheduling-wireframes/` | 0 errors. 3 warnings, all pre-existing (`LayoutBLadder.tsx:33,143`, `LayoutCTimeline.tsx:36` — `max-lines-per-function`). My two files are clean. |
| `npm run build -w web` | PASS (built in 715ms) |

Commits: `cc43bd08` doc · `e60a34b7` panel · `a07b4a17` tests.

## Cluster A — doc
`docs/spikes/rok-1540-scheduling-poll-audit.md`
- §d replaced verbatim with the scratchpad `doc-1555-section-d.md` → now `### d. Two steps, not one grid — operator ruling 2026-09-14` (line 627). §e still starts at 663.
- §c row "Public lineup, non-member" now opens with **Out of scope for ROK-1560/1561 (operator to rule; today's behaviour — the 403 — stays).** and keeps the considered design as trailing prose.
- §h gained **Q-6 — confirm-only save** (new `PATCH /users/me/game-time/confirm` vs a `confirmedAt`-only body on the existing PATCH; the existing save assumes a full template payload).

## Cluster B — panel
New sibling `web/src/dev/scheduling-wireframes/SheetStepOne.tsx` (exports `Stepper`, `StepOne`;
internal `AbsenceAnswer`, `EditLink`) — the split was needed to stay inside both lint caps.
`LayoutBSheetBallot.tsx` is 328 raw lines / lint-clean (counted lines strip blanks + comments).

- **Stepper** `wf-bs-stepper`, first child of `SheetFrame`, above its "Find a better time" header row.
  Two segments `1 Game time` / `2 Vote`, active = `bg-overlay text-foreground` + `aria-current="step"`,
  inactive = `text-muted`. Both always tappable.
- **Step 1** `wf-bs-step1`: `Your game time is 41 days old. Anything changed?` +
  `wf-bs-confirm` / `wf-bs-absence` (reveals `wf-bs-absence-row`, a two-date stub) /
  `wf-bs-edit` (`<a href="/profile#game-time">`) / `wf-bs-skip`.
- `SheetFrame` now owns `step` + `confirmed`. Stale viewer (`viewerGameTimeAgeDays === null || > 7`)
  opens on step 1; fresh viewer opens on step 2 with `confirmed: true`.
- **`StaleStrip` / `wf-bs-stale` deleted.** Replaced by `ViewerRow` (`wf-bs-viewer-row`, attribute
  `data-hatched="true|false"`) — the viewer's own line in step 2, hatched until confirmed. This is
  what "their row un-hatches" is asserted against; `cellStat` also moves one member from `stale` to
  `fresh` when confirmed, so the grid shading reacts too.
- Rationale: the two-step sentence was appended to the `pitch` string — **`Rationale` has no `note`
  prop** (`wireframe-chrome.tsx:148` is `{ pitch, wins, costs }`), so a new prop would have been a
  chrome change outside the brief's file list.

### Two deliberate deviations from the brief's literal class names
Both follow the brief's own deciding rule ("check `index.css` for which steps are remapped and use ONLY those"):
1. `bg-emerald-500/30` **has no `[data-scheme="light"]` rule.** The remapped bg steps are
   `bg-emerald-500/10`, `/20`, `bg-emerald-600/10`, `/30`, `/50` (`index.css:680-684`). FILL is therefore
   `['', 'bg-emerald-500/10', 'bg-emerald-500/20', 'bg-emerald-600/30', 'bg-emerald-600/30 ring-1 ring-inset ring-emerald-500/30']`
   and the legend swatch uses `bg-emerald-600/30`.
2. `bg-surface-raised` **does not exist** — no such token or utility anywhere in `web/src`. The active
   stepper segment uses `bg-overlay` (a real token, the system's raised surface).
   Also applied as briefed: `border-emerald-400`/`border-emerald-500/50` → `border-emerald-500/30`,
   `ring-emerald-400` → `ring-inset ring-emerald-500/30`, `text-amber-200` → `text-amber-300`.
   Note `text-amber-300` itself has no light remap either (only `.hover:text-amber-300:hover` does);
   it is used once, on `ViewerRow`'s "still counted as unknown" label. Flagging rather than
   second-guessing the brief twice.

## Cluster C — tests
`__tests__/sheet-ballot.test.tsx`: the two strip tests are gone; the strip describe is replaced by
`LayoutBSheetBallot — the two-step sheet (operator ruling 2026-09-14)` with 7 cases (step-1 contents,
absence stub reveal, `Looks right` → step 2 + un-hatched, `Skip` → step 2 + still hatched, fresh
viewer opens on step 2, never-set copy, segment 1 tappable from step 2). A `renderBallot(state)`
helper clicks past step 1 in both treatments so the pre-existing ballot tests still exercise the grid.
The weak `toBeEnabled()` case now parses every cell's `aria-label` and asserts the free and unknown
counts are two live, differing numbers summing to ≤ `members`.

**Assertion verified by breaking the fix** (edit + run + restore from a scratchpad copy; no `git stash`).
Removing `setConfirmed(true)` from the `Looks right` handler produced exactly:
`expect(element).toHaveAttribute("data-hatched", "false") … Received: data-hatched="true"`
at `sheet-ballot.test.tsx:135`. Restored and re-run green before committing.

## Next
- Rebase onto `origin/main` before the PR (review MINOR #1 — the base is pre-`e35ffd16`, so the diff
  currently reads as a ROK-1554 revert).
- Operator look at `/dev/wireframes/scheduling` → **B · sheet**, in `default-dark` AND `default-light`
  (the palette changes are the whole point of review MINOR #2).
