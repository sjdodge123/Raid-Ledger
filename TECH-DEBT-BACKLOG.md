# Tech Debt Backlog

Working document for reviewer findings that don't warrant immediate fixes. Appended by `/build`, `/dispatch`, and `/fix-batch` reviewer reports. Operator triages: file Linear stories for items worth doing, delete the rest.

**Why this exists:** findings used to be auto-filed as Linear `tech-debt:` stories, which created a self-perpetuating queue (reviewer flags items → Lead files story → next batch picks up the story → reviewer flags more items → loop). Findings now land here instead. Nothing in this file should be acted on by an agent without an explicit operator instruction.

## Format for new entries

Append to the bottom under a new dated section. The Lead does this as part of the batch's commits — no separate PR.

```
### 2026-05-03 — fix/batch-2026-05-02 (PR #XXX)

- **[low]** `path/to/file.ts:42` — short description.
  Suggested: one-line fix idea (optional).
- **[med]** `path/other.tsx` — description.
```

Severities: `crit` should never land here (those are auto-fixed during review or sent back to dev). Use `high` / `med` / `low` / `nit`.

## Operator workflow

1. Read new entries when reviewing the PR diff.
2. For each entry: file a Linear story manually, OR delete the entry, OR leave it for later.
3. Pruning is part of triage — old or duplicate items should be removed, not left to bloat.

## Format for skills that parse this file

A future triage skill (or operator-invoked agent) can rely on:

- Each batch is a level-3 heading: `### YYYY-MM-DD — <branch> (PR #<num>)`. Date is ISO. PR ref optional if the PR doesn't exist yet.
- Each finding is a single bullet starting with `- **[<sev>]**` where `<sev>` ∈ {`high`, `med`, `low`, `nit`}.
- File path follows in single backticks; `path:line` is preferred over `path` alone.
- Description is the rest of the bullet up to optional `Suggested:` line indented two spaces.
- The append marker (`<!-- agents append below this line -->`) divides header from entries — skills should read from there forward.

A skill's job is typically: parse → group duplicates by file path → propose Linear stories grouped by area label → present for operator approval. Never auto-file.

---

<!-- agents append below this line -->

### 2026-05-03 — rok-1067-public-shareable-lineup (ROK-1067)

- **[low]** `api/src/drizzle/migrations/0135_lineup_public_share.sql:6-14` — Migration is unsafe under rolling/blue-green deploys: ADD COLUMN nullable → backfill → SET NOT NULL has a window where old app instances can insert NULL slugs and trip the `SET NOT NULL` step. Not applicable to RL's current single-instance Synology Docker topology (Watchtower stops old container before starting new), but worth documenting if we ever move to multi-instance / k8s.
  Suggested: phased migration (separate PRs for backfill vs `SET NOT NULL`) or DB-side default that the new app code overwrites.
- **[low]** `nginx/monolith.conf.template:75-84` and `nginx/default.conf:52-61` — The existing ROK-393 `/i/:code` crawler block also lacks `proxy_set_header X-Real-IP` / `X-Forwarded-For`, so the invite-OG endpoint's rate-limit buckets all crawlers under the upstream IP too. Same class of bug as the ROK-1067 finding (fixed for `/p/lineup/:slug` in this PR); the invite block was the precedent and inherited the gap.
  Suggested: mirror the four `proxy_set_header` lines in the `/i/:code` location block.
