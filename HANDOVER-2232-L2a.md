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

## Lane 2b1 (2026-11-17)
All 15 listed integration specs now typecheck (tsc: 0 errors outside the rehydrate spec, which is another lane). eslint: 0 errors. Commit f1933c028. Not run (no DB); a raw DB insert asserting the legacy (event_id, steam_id) unique in ad-hoc-steam-participant.integration.spec.ts keeps `steamId`. No ROK-2232 2b notes.

## Lane 2b2 (contract + rehydrate spec) — done

- `8eabd7de4` feat(contract): `AdHocParticipantSchema` gains optional `playerId` + `idKind` (`PlayerIdKindEnum` = 'steam'|'minecraft-uuid'|'xuid', defined in contract — the api's `PlayerIdKind` in `presence-events.ts` is a structurally identical union, left in place). **Additive**: `steamId` unchanged, both new fields optional; no schema drift test exists for this file. New `packages/contract/src/__tests__/ad-hoc-events.schema.spec.ts` (3 cases, green locally). `AdHocParticipantService.getRoster` fills them via `storedPlayerRef(player_id, id_kind)` (omitted on a Discord-only row). The in-memory voice roster (`voice-attendance.helpers.ts::sessionToParticipant`) is Discord-only, so it sets neither.
- Live roster panel: stays Steam-only via `steamRoster()`; comment added in `server-presence-roster.service.ts` (Minecraft hub stories render non-Steam players later). No web change.
- Next commit: `pelican-presence.rehydrate.integration.spec.ts` — 5 tsc errors fixed (`...steamPlayer()` member, `p.playerId`), plus the AC case: an anonymous XUID participant and a SteamID participant with the SAME digits, both seated through `addServerParticipant`; asserts the stored rows (`steam_id` NULL for the XUID), that a fresh session rehydrates both as present and distinct (`[idKind, playerId, name]`), and that `getRoster` carries `playerId`/`idKind`. NOT run locally (no DB) — fleet must run it.
- Checks: `tsc --noEmit -p api/tsconfig.json` clean for the three api files touched; contract build + the new contract spec green; eslint clean on the api files (contract `lint` is a no-op echo).
