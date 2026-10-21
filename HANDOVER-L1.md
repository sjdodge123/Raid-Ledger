# HANDOVER — ROK-1888 lane L1 (scope + keying + queueUpdate + grace backstop)

## Commits
- `94a04fc36` test (WIP red): new `services/ad-hoc-quick-play-cross-channel.integration.spec.ts` (AC1/AC2/AC3),
  2 unit cases in `ad-hoc-event.service.voice.spec.ts`, flipped the ROK-1851 "born on ANOTHER channel is not reused"
  case to "is reused" (`listeners/voice-state.rok-1851...integration.spec.ts:266`).
- `9b6c96cb5` fix: the implementation below.

## Red proof (fleet task 14085f2b3901, verbatim)
- unit `adoptEvent shares the live state` → `- Expected - 3 / + Received + 1` (separate empty state).
- unit `a join from channel B edits the creating binding's card` → `Expected: 220, "binding-a" / Received: 220, "binding-b"`.
- AC1 → `expect(second).toEqual({ eventId: first?.eventId, existing: true })` deep-equality diff.
- AC2 → `Expected: 1 / Received: 2` (two event ids).
- AC3 → `expect(jest.fn()).not.toHaveBeenCalled() … Received number of calls: 1` (grace enqueued).
- 1851 flipped case → `expect(live).toEqual([otherEvent])` received 2 rows.

## Green proof (fleet task 181dfa632c02)
- Unit: 36 suites / 308 tests pass (`services/ad-hoc-event*`, `ad-hoc-server*`, `ad-hoc-voice-leave*`, `listeners/voice-state*`).
- Integration: 5 suites / 41 tests pass (new cross-channel spec, ROK-1851 spec, server-presence spawn/routing/base).
- `npx tsc --noEmit -p api/tsconfig.json` clean; eslint on touched files: 0 errors.

## What changed (all `api/src/discord-bot/services/`)
- `ad-hoc-event-channel-scope.helpers.ts`: `bornOnSpawningChannel` deleted (AC10: `git grep` empty). `onBindingChannel` kept.
- `ad-hoc-game-spawn-lock.ts`: `findVoiceSpawnTarget(db, gameId)` — **`bindingId` param removed**; game-only.
- `ad-hoc-event.service.ts`: `adoptEvent` → `adoptEventState` (shared memberSet); `processLeave` skips grace when
  `hasOpenVoiceParticipants` is true.
- `ad-hoc-event.handlers.ts` `handleJoinExisting`: `queueUpdate(eventId, existing.channelBindingId ?? bindingId)`.
- `ad-hoc-server-presence.helpers.ts`: new `hasOpenVoiceParticipants(db, eventId)` (`in_voice AND left_at IS NULL`).

## Interface for L2
```ts
// ad-hoc-game-spawn-lock.ts — THE live-Quick-Play predicate, shared with L1.1
export function liveQuickPlayFilter(gameFilter: SQL): SQL | undefined;
// usage: db.select({ gameId: events.gameId }).from(events)
//          .where(liveQuickPlayFilter(inArray(events.gameId, ids)))
```
Build `findLiveQuickPlayGameIds(db, gameIds)` on it (return empty Set early for `[]` — `inArray` with an empty list).
L2 also owns `voice-state.rok-1851…integration.spec.ts:332` "does not link a same-game Quick Play born on ANOTHER
channel" (`findLinkedEvents`): it will flip once `findLinkedEvents` takes the room's group gameIds.

## For L5 (companion-bot smoke)
- Cross-channel join: a member in bound channel B playing the live game joins A's event; the card is edited (no 2nd
  card post) and its routing is A's notification channel. Grace does not start while anyone is in either channel.
- Known console noise in the integration run: `[VoiceAttendanceService] Failed to flush session …` after truncation
  (an `event_voice_sessions` insert racing `truncateAllTables`) — not an assertion failure.

## OQ2 audit (for the Lead to file in TECH-DEBT-BACKLOG.md — I did not edit the shared file)
- `lfg-now/lfg-now-event.helpers.ts:92` `createLfgNowEventRow` inserts an `isAdHoc:true, adHocStatus:'live',
  channelBindingId:null` event under the **LFG group** advisory lock, not `withGameSpawnLock(1801, gameId)`. So a
  voice/server spawn and an LFG-now start for the same game can still make two live rows. Severity med.
  Suggested: take `pg_advisory_xact_lock(1801, gameId)` inside the LFG-now spawn tx too (and reuse an existing live
  Quick Play). Voice (`createVoiceQuickPlay`) and server (`spawnOrFindServerQuickPlay`) paths are both locked.
- Behaviour note: LFG-now events were already a voice spawn target before this story (null binding matched
  `isNull(channelBindingId)`), so nothing changes for them here.

## Not done / deliberately left
- `onModuleInit` recovery unchanged (spec says so).
- No unique index (OQ2 ruling).
- `handleVoiceJoin` 42-line function warning is pre-existing; not touched.
