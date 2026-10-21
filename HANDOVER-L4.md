# ROK-1888 L4 handover (drop before PR)

Commits: `dc4cc06ac` (WIP red spec), `127f90913` (implementation + module wiring).

## What shipped (all `api/src/discord-bot/`)
- `services/ad-hoc-steam-link-merge.helpers.ts` — `mergeUnlinkedRowsOnLink(db, userId, steamId)`: finds rows matching
  `UNLINKED_SERVER_ROW_SQL` + that SteamID on live/grace, non-cancelled ad-hoc events; per hit, under
  `withParticipantLock(event, user)`: if the user has a voice row (`discord_user_id` set, `steam_id` NULL) the steam row
  is DELETED first (RETURNING) then its `steam_id/on_server/pelican_server_id/character_*` (and `left_at=NULL` if the
  steam row was open) are written onto the voice row. Delete-first because the identity CHECK forbids clearing
  `steam_id` on a Discord-less row and the `(event_id, steam_id)` unique forbids two holders. Otherwise the row is
  claimed in place (`user_id` + RL display name). Returns `{eventId, channelBindingId}[]`.
- `services/ad-hoc-steam-nudge.helpers.ts` — `findSteamNudgeTargets(db, eventId, discordUserId?)`, copy, TTL, key.
- `listeners/ad-hoc-steam-link.listener.ts` — `AdHocSteamLinkListener` (registered in `discord-bot.module.ts`
  providers): `@OnEvent(STEAM_ACCOUNT_LINKED)` → merge → `queueUpdate(eventId, channelBindingId)` + roster emit;
  `@OnEvent(AD_HOC_EVENTS.PARTICIPANT_JOINED)` → nudge. A voice join (payload has `discordUserId`) narrows to that
  member; a server join (no `discordUserId`) checks every open voice member, so a voice-first / server-second order
  also nudges. Both fire after the write commits (the emit follows the locked upsert). Failures logged by id + error
  name only (never a SteamID) and swallowed.

## Cooldown storage
`NotificationDedupService.checkAndMarkSent('quick-play-steam-nudge:<userId>', 30*24*3600)` — the existing
`notification_dedup` table + Redis fast path. **No migration.** Prefs: `NotificationService.create` skips when
`lineup_steam_nudge.inApp` is off; the Discord DM goes through its normal `dispatchDiscord` pref check. Note the dedup
key is claimed even when prefs are off (the member opted out; not retried for 30 days).

## Tests
`services/ad-hoc-steam-link.integration.spec.ts` (7 cases, AC8 ×3, AC9 ×4). Red proof (fleet task `2f153aed86f5`):
AC8 fold `Expected length: 1 / Received length: 2`; AC8 claim `- "userId": 5 / + "userId": null`; AC9 once
`Expected number of calls: 1 / Received number of calls: 0`; AC9 server-second `Number of calls: 0`. The three negative
cases (ended event, prefs off, Steam linked / no unlinked row) pass both before and after, as negatives do.
Green: fleet task `db81d732007c` — 4 suites / 41 tests pass (this spec + steam-participant, server-presence, cross-channel). tsc clean; eslint 0 errors (1 warn: `findSteamNudgeTargets` 33 lines).

## Gaps / not done
- `PARTICIPANT_JOINED` only fires on a NEW row, so a re-opened unlinked server row (rejoin) does not trigger a nudge.
  The 30-day cooldown makes this minor.
- No unit spec for the listener (the integration spec drives it through the real emitter).

## For L5 (companion-bot smoke)
- No existing smoke covers `lineup_steam_nudge` for Quick Play. Suggested: a DEMO_MODE fixture that seeds an unlinked
  steam row (the one L5 is adding to `admin/demo-test-quick-play-voice.controller.ts`), then a voice join by a test-bot
  user with no Steam → assert the DM embed title `Link your Steam account` + the `Link Steam` button
  (`notification-embed.buttons.ts:140`). Merge-on-link needs a real Steam OpenID link, so it stays integration-only.
