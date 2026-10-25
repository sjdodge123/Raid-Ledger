# ROK-1953 — Codex R2 handover (3 P2s fixed)

## Commits
- 883539bdc web: unique recent-unlock keys (`unlockKeys` helper).
- e431ede4f core: shared `STEAM_STATS_JOB_RETRY` (3 attempts, exponential, 10 min base); nightly uses it.
- d15a7dc5e core: link jobs use the retry policy; `STEAM_ACCOUNT_UNLINKED` listener purges the user's
  `steam_user_app_stats` + `steam_user_achievements` (`SteamStatsStorageRepository.purgeUser`); the read
  service builds the viewer's unmask set only when the viewer is linked.

## Approach for P2 #1 (purge, not key-by-steam-id)
`announceSteamLinkChange` emits `unlinked` (old id) BEFORE `linked` (new id) on every replace/clear, and
`steam-id-writer.guard.spec.ts` pins that every `users.steam_id` writer is a sanctioned helper — so the
unlink event is a complete hook. Purge needs no migration on a stacked branch; a steam_id column would need
one plus a backfill. Defence in depth: unlinked viewer unmasks nothing; feeds were already linked-only.
Known residual: a nightly run that fetched account A before the swap could write A's rows after the purge
(sub-second window, next refresh corrects it). Not addressed.

## Verified on laptop
- jest: steam-stats unit specs + bullmq/cron/cron-constants/hub-ownership/steam-id-writer guards — 60/60.
- vitest: web/src/components/hub/steam-stats — 25/25. tsc api + web (app, test) clean. eslint clean (warnings only).
- Red first: L4 (options missing attempts/backoff), L5/L6 (`handleUnlinked` absent), widget test
  (duplicate-key warning `1-2026-10-24T20:00:00.000Z` x2).

## Fleet must run (not run on laptop)
- `api/src/plugins/core/steam-stats/steam-stats.read.integration.spec.ts` — new I11 (unlinked viewer's kept
  SECRET row must not unmask A's rarest) and I12 (replace A->B via `announceSteamLinkChange` → A reads
  `pending`, absent from feeds). Expected red without the fix: I11 gets the full achievement, I12 status `ok`.
