# Step 3: Present Dispatch Summary

Present the dispatch summary to the user for approval.

## Dispatch Summary

```
## Dispatch Plan — N stories (X rework, Y new)

### Rework (Changes Requested)
| Story | Title | Feedback Summary |
|-------|-------|-----------------|
| ROK-XXX | <title> | <1-2 line summary> |

### New Work (Dispatch Ready)
| Story | Pri | Title | Key Files |
|-------|-----|-------|-----------|
| ROK-XXX | P1 | <title> | <primary files from spec> |
```

## Parallel Batch Assignment

Group stories into parallel batches:

1. **Contract/migration stories first** — run alone in batch 0
2. **Non-overlapping stories** — group into parallel batches (max 2-3 per batch)
3. **Overlapping stories** — separate batches, ordered by priority

```
=== Parallel Batches ===
Batch 1 (parallel):
  ROK-XXX (P1, rework) — [events]
  ROK-YYY (P1, new) — [theme]
  No file overlap

Batch 2 (after batch 1):
  ROK-ZZZ (P1, new) — [events, db-schema] — needs migration
```

Present the proposed batch plan to the user.
