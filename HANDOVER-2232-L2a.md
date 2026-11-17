# ROK-2232 lane 2a handover — DB + sink/reader layer

Status: SOURCE DONE (lint clean), UNIT SPECS RED (fixtures still use the old `steamId` shapes). tsc NOT run (brief: no full tsc on the laptop).

## Commits (on `feat/rok-2232-platform-player-id`)
- `c9743720f` feat(db): migration `api/src/drizzle/migrations/0305_ad_hoc_participants_player_id.sql` (+ `meta/0305_snapshot.json`, journal). Adds `player_id text`, `id_kind text`, partial unique `ad_hoc_participants_event_player_unique (event_id, id_kind, player_id) WHERE player_id IS NOT NULL`, identity check `discord_user_id OR steam_id OR player_id IS NOT NULL`. One hand edit: inline backfill `UPDATE … SET player_id = steam_id, id_kind = 'steam' WHERE steam_id IS NOT NULL` before the index. Old `(event_id, steam_id)` unique KEPT (steam rows write both; link-merge paths still guarded). `fix-migration-order.sh --check` OK.
- `7b5a3cbf0` WIP pelican: `ServerPresencePlayer extends PlayerRef` (no `steamId`), `playerLeft(source, player: PlayerRef)`, `toSinkPlayer` never null, `sinkPlayerRef` reads stored ref, `toPresentPlayers` compares `displayName === playerId`; `ServerRosterPlayer extends PlayerRef` (no `steamId`); new `steamRoster()` / `SteamRosterPlayer` used by hub membership + live roster panel (Steam-only consumers). Death sink unchanged (already Steam-filtered via `steamIdOf`).
- `cfd71a120` WIP quick-play sink: pending keyed by `presenceKey`, `remove(id, ref)`; service/effects/enrol/spawn key by ref; `findServerEnrolledEvent(db, gameId, ref, serverId)`; `listOnServerSteamIds` → `listOnServerPlayers` (PlayerRef[]); `listOpenGameServerSteamIds` → `listOpenGameServerPlayerKeys` (presenceKey strings); new `resolvePlayerIdentity` (Steam → users.steam_id, others → null = anonymous); `ServerPresenceMemberInfo extends PlayerRef`; `findParticipantBySteamId` → `findParticipantByPlayer`; insert writes `steam_id` only for Steam, upsert conflict target is the new player unique; `markSteamLeave/markServerLeave(…, ref, …)` (PARTICIPANT_LEFT `steamId` only for Steam); `mergeSteamIntoUserRow` + link-merge also write `player_id`/`id_kind`; `characterNameOf({playerId, displayName})`; new `storedPlayerRef()` in presence-events.ts.

## RED — unit specs to fix (fixture shape only; source is intended)
`cd api && npx jest <file> --maxWorkers=1`:
- `pelican/presence/pelican-presence.helpers.spec.ts` — 3 (old "XUID is skipped" tests now WRONG by design: rewrite to assert the XUID IS handed to the sink/roster under `idKind:'xuid'`, never with a steamId; unnamed label test → `playerId`).
- `pelican/presence/pelican-presence.session.spec.ts` (3), `pelican-presence.supervisor.spec.ts` (1) — `playerLeft` now receives a ref; fixtures `steamId:` → `playerId`+`idKind`.
- `pelican/hub/server-hub-membership.service.spec.ts` (4) — fake reader returns `{steamId}`; give it `playerId`+`idKind:'steam'`.
- `discord-bot/services/ad-hoc-server-presence.tracker-enrol.spec.ts` (10), `.join-pending.spec.ts` (6), `.rehydrate.spec.ts` (4), `ad-hoc-server-spawn.owner.spec.ts` (1) — mocks named `listOpenGameServerSteamIds`/`listOnServerSteamIds` (renamed), rows select `playerId`/`idKind`, member literals `steamId:` → `playerId`+`idKind`.
- Not yet run: other `ad-hoc-*` unit specs touching `markServerLeave`, `characterNameOf`, voice-tally, roster helpers (`server-presence-roster` passed).

## NOT DONE (brief item 4)
- New unit tests: `PendingServerPlayers` keeps an XUID and a same-digit SteamID distinct (hold both → `all()` length 2; `remove(steamPlayer(x))` leaves the XUID); `upsertSteamParticipant`/`insert` of an XUID member writes `steamId: null`, `playerId`, `idKind:'xuid'` and never merges (userId null). Revert-prove one (make `presenceKey` → `ref.playerId`).

## For lane 2b
- Integration specs (typecheck will fail until updated): `ad-hoc-steam-participant{,.r3,.display,.leave-race}.integration.spec.ts`, `ad-hoc-reaper.occupied.integration.spec.ts` call `markSteamLeave`/`findParticipantBySteamId`/member literals with `steamId` — switch to `steamPlayer(id)` refs.
- `pelican-presence.rehydrate.integration.spec.ts`: add an XUID participant case (stored row has `player_id`, `id_kind='xuid'`, `steam_id` NULL; rehydrates under its ref, shown by name).
- Contract: roster participant DTO (`packages/contract/src/ad-hoc-events.schema.ts:19`) add optional `playerId`/`idKind`; `AdHocParticipantService.getRoster` (`ad-hoc-participant.service.ts` ~l.245) maps them.
- Live roster panel (`server-presence-roster.*`, channel-presence-room) is Steam-only via `steamRoster()`: an XUID player is not shown there yet (keys `steam:<id>`). Decide if P1's "shown by name" needs it.
- Run `tsc --noEmit -p api/tsconfig.json` (fleet `--static`) — unverified.

## Lane 2a-fix (2026-11-17)

Status: UNIT GREEN, non-integration tsc CLEAN, eslint clean on every touched file. Integration specs still fail tsc (lane 2b).

- **Migration number:** no collision against origin/main. `renumber-branch-migrations.sh` → "nothing to renumber: 1 branch migration(s) already follow f91cad888" (origin/main tops out at `0304_hub_forum_event_threads`). `0305_hub_forum_discord_sync.sql` exists only on the LOCAL branch `feat/rok-2208-discord-forum-sync` (not pushed/merged). Whichever of the two lands second must run the script then. Branch file stays `0305_ad_hoc_participants_player_id.sql`.
- Commits: `b35c75ef7` presence specs (2 helpers tests REWRITTEN: XUID now reaches sink/roster under `idKind:'xuid'`), `d…` hub membership (+ XUID never looked up as SteamID), tracker-enrol/join-pending, `22cfdd975` rehydrate/spawn-owner/display (+ anonymous XUID row rehydrates), `2b0cd6df3` new keying tests (pending distinct holds; XUID stored with steam_id NULL; Steam-only `users.steam_id` resolve) — revert-proved, `f1de0a092` source tsc fixes (`SteamDisplayInput.steamId`→`playerId`, demo join `steamPlayer()`, session.ts back under 300 lines).
- Unit: `jest src/discord-bot src/plugins src/admin src/events` (no integration) → 12425/12425 tests; one suite (`events-list.command.navigation.spec.ts`, untouched) "failed to run" under parallel load and passes alone.

### Lane 2b list (exact — `npx tsc --noEmit -p api/tsconfig.json` from root; errors per file)
32 `discord-bot/services/ad-hoc-server-presence.integration.spec.ts`; 23 `ad-hoc-server-presence.spawn.integration.spec.ts`; 19 `ad-hoc-steam-participant.integration.spec.ts`; 19 `ad-hoc-steam-participant.display.integration.spec.ts`; 6 `server-presence-roster.integration.spec.ts`; 6 `ad-hoc-server-presence.routing.integration.spec.ts`; 5 `plugins/pelican/presence/pelican-presence.rehydrate.integration.spec.ts`; 5 `ad-hoc-steam-participant.r3.integration.spec.ts`; 4 `ad-hoc-unlinked-server-count.integration.spec.ts`; 4 `listeners/voice-state.rok-1851.lobby-reuses-server-quick-play.integration.spec.ts`; 4 `listeners/voice-state.rok-1801.server-threshold.integration.spec.ts`; 3 `ad-hoc-reaper.occupied.integration.spec.ts`; 2 `ad-hoc-steam-participant.leave-race.integration.spec.ts`; 1 `plugins/pelican/hub/pelican-hub-online.integration.spec.ts`; 1 `event-auto-extend.server-presence.integration.spec.ts`; 1 `ad-hoc-steam-link.integration.spec.ts`. Pattern: `steamId:` member/player literals → `...steamPlayer(id)`; `markSteamLeave/markServerLeave/findParticipantBySteamId` take a ref; renamed list queries.
Plus the earlier 2b items: XUID case in the rehydrate integration spec (real DB, `player_id`/`id_kind`, `steam_id` NULL), contract roster DTO optional `playerId`/`idKind`, live roster panel decision (Steam-only via `steamRoster()`).
