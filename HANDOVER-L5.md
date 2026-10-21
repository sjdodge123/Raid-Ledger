# ROK-1888 L5 handover (drop before PR)

Commits: `c4bbb2c5e` (api DEMO seams + units), `9187d22a9` (companion-bot smoke).

## Fixture routes (JWT + AdminGuard + DemoModeGuard)
- NEW `POST /admin/test/quick-play/server-join` `{gameId, steamId(SteamID64), displayName, pelicanServerId?}` —
  `api/src/admin/demo-test-quick-play-server.controller.ts` (registered in `admin.module.ts`). Calls the real sink
  `AdHocServerPresenceService.playerJoined`. Attach-only: 409 when the game has no live Quick Play or ad-hoc is off;
  400 when the SteamID belongs to an RL account. Returns `{eventId}`. Spec: `.controller.spec.ts` (5 cases).
- `POST /admin/test/quick-play/voice-join` now takes `discordOnly: {discordUserId, displayName}` in place of `userId`
  (exactly one; zod refine) → a `user_id NULL` voice row, for the join hint. 2 new spec cases.

## Smoke
- NEW `tools/test-bot/src/smoke/tests/quick-play-one-per-game.test.ts` (registered in `run.ts` after
  quick-play-announcements): (a) two `game-voice-monitor` binds (last two voice channels) → same eventId, exactly one
  card in T; (b) server-join → `**name** · on server`, author ` 2 playing`, 3 roster names, no hint;
  (c) discordOnly join → ` 3 playing` + `Join Raid Ledger ↗](…/login)`.
  Assumption to watch on CI: the monitor binds set `notificationChannelId` = T AND a QP-announcements(G) bind on T.
- `fixtures-quick-play.ts`: `quickPlayServerJoin`, `randomUnlinkedSteamId`, `discordOnly` target.
- `roster-count.spec.ts`: suffix row = one entry; hint line adds none (10/10 PASS via tsx).
- Unchanged on purpose: `voice-activity.test.ts` `:427`/`:724` (lobby presence card — ruling 1/OQ1, linked seeded
  members), `push-content.test.ts` (scheduled event "signed up"), `quick-play-announcements.test.ts` (its single-binding
  "one card" assertions still hold), `lobby-server-presence.test.ts`.
- Not done: optional nudge-DM smoke.

## Results
- api `tsc -p api/tsconfig.json` clean; eslint 0 errors on touched files. Fleet slot 1 jest: 2 suites / 21 PASS.
- test-bot `tsc --noEmit`: only `src/helpers/voice.ts` TS2307 `@discordjs/voice` (missing local install in this
  worktree, not this diff); `lint:no-sleep` OK. Bot smoke runs on GitHub CI.
