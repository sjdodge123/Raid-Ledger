# HANDOVER — ROK-1888 lane L2 (gate bypass + lobby card link + LFG-now lock)

## Commits
- `018e7385f` test (WIP red): partition bypass unit; ROK-1851 `:332` case flipped to "links a same-game Quick Play
  born on ANOTHER channel by game"; new `lfg-now/lfg-now-spawn.quick-play-reuse.integration.spec.ts`.
- `01c51b8b8` fix: implementation below.

## Red proof (fleet task 18c340d9a758)
- unit partition bypass → `- Expected - 3 / + Received + 1` (Valheim dropped).
- LFG-now manual start while voice QP live → `- Expected - 2 / + Received + 2` (new event, spawned:true).
- ROK-1851 flipped → `- Expected - 3 / + Received + 1` (`[]` vs `[otherEvent]`).
- findLiveQuickPlayGameIds → `TypeError … is not a function` (did not exist yet).

## What changed
- `services/ad-hoc-game-spawn-lock.ts`: `findLiveQuickPlayGameIds(db, ids)` (empty → early `new Set()`), and
  `lockGameSpawn(tx, gameId)` (the 1801 lock inside a caller's tx; `withGameSpawnLock` uses it).
- NEW `listeners/voice-live-game.helpers.ts`: `liveGameIdsOf`, `isGameLive`, `bypassesMinPlayers` (needs
  `confirmedCount > 0` — presence-null alone never bypasses, else ROK-1394 null-game degrade for one person).
- `voice-lobby-groups.helpers.ts`: `partitionLobbyGroups(..., liveGameIds = new Set())`; `resolveLobbyGroups`
  passes the live set (so the delayed spawn, leave-cancel and recovery paths all see the bypass).
- Fixed-game gates: `voice-state-gate.handlers.ts` (join gate) and `voice-state-join.handlers.ts`
  (`resolveThresholdSpawnGameId`, delayed spawn). Lobby game-switch gate `voice-state.handlers.ts::switchClearsThreshold`.
- `channel-presence-room.helpers.ts`: `findLinkedEvents(db, bindingId, gameIds = [])` = binding OR game; `buildGroups`
  reads linked events first and partitions with their game ids (an evented group renders qualifying).
  `channel-presence-brief-visit.ts` still calls it binding-only (ended room has no groups) — deliberate.
- LFG-now `lfg-now-spawn.helpers.ts::spawnUnderGroupLock`: after its group lock takes `lockGameSpawn` (order is
  ALWAYS group → game; voice/server paths never take the group lock → no deadlock), and `findOpenSession` =
  LFG-born open event ?? `findVoiceSpawnTarget`. Attach/manual branches then join the live Quick Play
  (`spawned:false`, so no temp voice/announce), and convert the intents onto it.

## Not done / for the Lead
- `recapEvents` is still binding-scoped. The OQ3 ruling ("recap covers everyone across all channels") is NOT
  implemented by L2 — the 1851 flipped case still asserts recap `[]` for the other-channel event. Assign it.
- `shouldSpawnImmediately` (lobby unanimity) is untouched: a lone live-game lobby joiner takes the DELAYED spawn path.
- No unit spec for the gate handlers' bypass (covered by the partition unit + integration only).

## For L5
- Smoke: a lone member in channel B playing the live game joins after the spawn delay (not immediately) for
  general-lobby; fixed-game binds join immediately when all counted members confirm the game.
- LFG-now "start playing now" during a live Quick Play returns the QP's event id, no second event/temp voice.
