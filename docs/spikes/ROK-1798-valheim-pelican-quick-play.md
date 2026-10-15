# ROK-1798 spike: Quick Play from Pelican game-server logs (Valheim first)

**Status:** spike output. Docs only, no production code. **Base:** `origin/main` @ `c303d3ced`.
**Author lane:** spike lane, 2026-10-15. **Tier for the build:** `standard`. It needs a migration (participants identity), so the build gate escalates to `--full` for the migration slice.

## Provenance

| Source | What it gave |
|---|---|
| Lead brief (ROK-1798 key facts, the five questions) | Scope. I had no direct access to the Linear issue body. |
| Live Pelican panel, read-only (`list_servers`, `server_details`, `server_resources`, `list_files`, `read_file`) | The operator's Valheim server: egg startup line, crossplay flag, and a **real 2,241-line log from a 4-hour session on 2026-10-14** (`/BepInEx/LogOutput.log`). The server was **offline** during the spike, so I could not observe a live console. |
| `pelican-dev/wings` source (`router/websocket/websocket.go`, `listeners.go`, `config/config.go`) | Websocket auth, permissions, log replay count, token-expiry events. |
| `pelican-dev/panel` source (`WebsocketController.php`) | Token endpoint, 10-minute expiry, permission check, response shape. |
| Valheim docs and hosting guides (lloesche/valheim-server-docker, Nodecraft, low.ms) | Crossplay/PlayFab line format, which **I could not check against a real log**. |

**Anonymisation:** every sample below has names, SteamID64s, peer UIDs and the world name replaced with placeholders. The lines are otherwise verbatim.

---

## TL;DR verdict

**Feasible. Recommend building it.** Valheim's vanilla server logs a clean, low-noise presence trail. A player connects with a **SteamID64** and disconnects with the **same SteamID64**. That SteamID maps directly onto `users.steam_id` (`api/src/drizzle/schema/users.ts:17`).

**Recommended approach:**
1. Open a **Pelican client-API websocket** per opted-in server, from the API process. Flow: `GET /api/client/servers/{id}/websocket` returns a token, then `auth`, then stream `console output`.
2. Feed each line to a **pure per-game parser** (Valheim first). It drives a per-server **presence tracker** keyed by SteamID64.
3. The tracker calls a **new non-Discord Quick Play entry point** that reuses suppression, spawn, grace and finalize. This needs one migration so `ad_hoc_participants` can hold a Steam participant without a `discord_user_id`.

---

## Q1: Valheim log lines (real, anonymised)

**Setup:** the server runs the `ghcr.io/parkervcp/games:valheim` yolk with BepInEx plus mods, and `ENABLE_CROSSPLAY=0`.

**Where the lines appear:** Unity writes to **stdout** under `-batchmode -nographics`, so these lines are what Wings streams as `console output`. The egg's `CONSOLE_FILTER` sed strips Unity `(Filename: … Line: N)` lines and blank lines.

**Prefix differences:** the on-disk copy is `BepInEx/LogOutput.log`, which adds a `[Info   : Unity Log] ` prefix. The console stream has **no** such prefix. **Parsers must not anchor on `^`.**

### Connect (Steam, crossplay off)
```
10/14/2026 00:10:50: Got connection SteamID 7656119XXXXXXXXA
10/14/2026 00:10:50: Got handshake from client 7656119XXXXXXXXA
10/14/2026 00:10:54: Network version check, their:40, mine:40
10/14/2026 00:10:54: Server: New peer connected,sending global keys
10/14/2026 00:11:12: Got character ZDOID from <CHAR_A> : <UID_A>:1
```

### Wrong password (a connect that never becomes a player)
```
10/14/2026 01:47:47: Got connection SteamID 7656119XXXXXXXXB
10/14/2026 01:47:47: Got handshake from client 7656119XXXXXXXXB
10/14/2026 01:47:54: Peer 7656119XXXXXXXXB has wrong password
```
In other occurrences, `Closing socket 7656119XXXXXXXXB` follows in the same second.

### Death and respawn (NOT a leave)
```
10/14/2026 02:45:04: Got character ZDOID from <CHAR_B> : 0:0
10/14/2026 02:45:13: Got character ZDOID from <CHAR_B> : <UID_B>:4931
```
A `0:0` ZDOID means the character object was destroyed (death). A non-zero ZDOID about 8 seconds later is the respawn. The same character did this five times in the session.

### Disconnect
```
10/14/2026 03:50:28: RPC_Disconnect
10/14/2026 03:50:28: Destroying abandoned non persistent zdo <UID_B>:10365 owner <UID_B>
10/14/2026 03:50:28: Disposing socket
10/14/2026 03:50:28: Closing socket 7656119XXXXXXXXC
10/14/2026 03:50:28:   send queue size:0
10/14/2026 03:50:28: Got status changed msg k_ESteamNetworkingConnectionState_ClosedByPeer
```

### Periodic peer-count heartbeat (every 10 min, at `:x9:02`)
```
10/14/2026 02:39:02:  Connections 5 ZDOS:180848  sent:2549 recv:1723
10/14/2026 03:59:02:  Connections 0 ZDOS:211724  sent:0 recv:0
```
This count matched the number of `Sent to <SteamID>` profile-save lines at the same tick.

**Trap:** dungeon generation also prints a bare `Connections 4` line. Only the form with `ZDOS:` is the peer count.

### Server lifecycle
```
10/14/2026 00:09:02: Game server connected          <- ready for players
10/14/2026 04:00:04: Game - OnApplicationQuit        <- shutting down
10/14/2026 04:00:04: ZNet Shutdown
```

### World-load player history (bonus, UNVERIFIED as vanilla)
At world load the server printed one line per player ever seen, in this form:
```
Player history entry with index 3:  <PERSONA_D> (Steam_7656119XXXXXXXXD, <HASH>)
```
That is a SteamID-to-name directory. It may come from vanilla 1.0 or from a mod, since the server runs `NetworkPerformanceSystem`, which has a `PlayerHistoryRepeats` mechanism. **Do not depend on it.** It is a nice-to-have for naming unlinked players.

### Parser regexes (JS, unanchored, applied per line)

| Event | Regex | Captures | Stable id? |
|---|---|---|---|
| connect | `/Got handshake from client (\d{17})\s*$/` | SteamID64 | **yes** |
| reject | `/Peer (\d{17}) has wrong password/` | SteamID64 | yes |
| spawn / respawn | `/Got character ZDOID from (.+?) : (-?\d+):(\d+)\s*$/` | character name, peer UID, object id | UID is **per session**; the name is **mutable** |
| death | the same regex with `UID=0`, `n=0` | character name | no |
| disconnect | `/Closing socket (\d{17})\s*$/` | SteamID64 | **yes** |
| heartbeat | `/Connections (\d+) ZDOS:\d+/` | peer count | n/a |
| server ready | `/Game server connected/` | none | n/a |
| server stop | `/OnApplicationQuit\|ZNet Shutdown/` | none | n/a |
| timestamp | `/(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}): /` | container-local time | see Q5 |

`Got connection SteamID (\d{17})` is redundant with the handshake line, which comes in the same second. Use the handshake line.

### Identifiers
- **SteamID64** appears on both connect and disconnect, so it is the **only stable key present at both ends**.
- **ZDOID** (`<UID>:<n>`) is a per-session object id. The UID changes on every login. In the sample, the same player had a different UID in each session.
- **Character name** is user-chosen and can collide or change.

**Linking a character name to a SteamID:** the vanilla log never prints the two on one line.
- **At connect:** use ordering. The handshake comes first, then the first non-zero ZDOID about 10–20 seconds later, so you can pair them FIFO.
- **At disconnect:** `Destroying abandoned … owner <UID>` (the UID from the ZDOID) comes immediately before `Closing socket <SteamID>`.

**Recommendation:** key presence on SteamID64 only. Use the character name only as a display label (FIFO pairing). A rare mis-paired label during simultaneous joins is cosmetic.

### Noise
- From 00:08 to 01:47 (about 100 minutes) the log had **615 non-blank lines**, about 6 per minute. **51 of them (about 8%)** matched the presence regexes above.
- The rest is world generation (`Placed location …`, dungeon generation), saves, and **mod chatter** (`[Info :NetworkPerformanceSystem]`, `Seasonality`, `XPortal`, `Jotunn`).
- Mod lines include player names and SteamIDs in **non-vanilla formats**, for example `Peer (7656…) disconnected` from Seasonality. **The parser must match only the vanilla lines above.** Otherwise mod updates will break it or double-count.

### Crossplay / PlayFab (UNVERIFIED: the operator's server has crossplay OFF)
- With `-crossplay`, connections go through PlayFab. Hosting guides show a line of the form `PlayFab socket with remote ID playfab/<hex> received local Platform ID Steam_7656…`.
- Xbox/Game Pass players show `Xbox_<id>` and have **no SteamID**.
- I could not check whether `Got handshake from client` and `Closing socket` then carry the PlayFab id rather than the SteamID.
- **v1 default: Steam-only.** Crossplay needs a real crossplay log sample (one toggle and one session) before parsing it.

---

## Q2: Access, comparing the websocket with the Files API

### Websocket (recommended): proven from source, NOT exercised live
- **Token:** `GET /api/client/servers/{server}/websocket` returns `{ data: { token, socket } }`. `socket` is `wss://<node>/api/servers/<uuid>/ws`.
  - The panel gates this on `SubuserPermission::WebsocketConnect` (`websocket.connect`).
  - The JWT expires after **10 minutes** (`addMinutes(10)`) and carries the user's permission list. *Source: panel `WebsocketController.php`.*
- **Handshake:** open `socket`, then send `{"event":"auth","args":[token]}`. The reply is `auth success`. Then send `{"event":"send logs","args":[null]}`.
- **Replay on connect: YES, limited.** `send logs` returns the last `websocket_log_count` lines of the container log. Wings defaults this to **150** (`config.go`, `default:"150"`), and it only works **while the server is running**.
  - At about 6 lines per minute that covers roughly the last 25 minutes.
  - **No replay for an offline server.**
- **Permissions on the stream (Wings):** connecting needs `websocket.connect`. **`console output` is not gated by any further permission.** Only *sending* commands checks `control.console`.
  - So RL's key needs **only `websocket.connect`** on top of what the plugin already uses.
  - It should **not** have `control.console`, which is least privilege: RL must never be able to type into a game console.
- **Token refresh:** Wings checks every 30 seconds.
  - It sends `token expiring` when ≤60 seconds remain, and `token expired` at 0. **It does not close the socket.**
  - The client fetches a new token and re-sends `auth` on the **same** socket, as the Pelican web UI does.
  - A bad or expired token on an inbound message gets a `jwt error`.
- **Other events on the same socket:** `status` (`running`/`offline`/…) and `stats`. These are free power-state push, so presence can end the instant the server stops without waiting for `PelicanStatusService` (`api/src/plugins/pelican/pelican-status.service.ts:39`) to poll.
- **Origin check:** Wings accepts the upgrade only if `Origin` equals the panel URL, or matches its `allowed_origins`.
  - Browsers send that automatically.
  - **A Node `ws` client must set `Origin: <panel base URL>` explicitly.** This is the most likely first-try failure.
- **Gap, NOT proven live:** the spike could not open a socket.
  - The server was offline, and the skeleton-key tools the lane may use have no websocket call.
  - It is also UNVERIFIED that RL's own `pacc_` key user can see the Valheim server. In skeleton-key's view the Valheim server is `client=YES` and every other server is `client=NO`, because client keys only see servers their user owns or is a subuser on.
  - **First build step:** a 20-line probe script against the real panel, run by the operator or a fleet lane with RL's key.

### Files API polling (fallback only)
- `GET /api/client/servers/{id}/files/contents?file=…` returns the **whole file** every time, with no range or offset. It needs `file.read` / `file.read-content`.
- **A vanilla server writes no log file.** stdout goes only to Docker. This server has `BepInEx/LogOutput.log` only because BepInEx is installed.
- `LogOutput.log` is **truncated on every restart**, reached 122 KB after 4 hours, and the panel refuses files over 4 MiB.
- Polling every 30–60 seconds means latency, a whole-file download and diff each poll, and restart edge cases.
- **Use it only** as a one-shot backfill on RL startup when the server has been running longer than the 150-line replay covers. Even then the 10-minute `Connections N ZDOS` heartbeat makes it optional.

| | Websocket | Files API poll |
|---|---|---|
| Latency | push (sub-second) | poll interval |
| Works on vanilla Valheim | yes (stdout) | **no** (no log file unless the egg adds `-logFile`) |
| History on (re)connect | last 150 lines, running only | the whole file since the last restart (BepInEx only) |
| Permission | `websocket.connect` | `file.read` (+ content) |
| Cost | 1 long-lived socket per server | a full-file GET per poll |
| Free extras | `status` push | none |

---

## Q3: Identity mapping (recommendation)

1. Look up the **SteamID64** with `users.steam_id`, which is unique and nullable, linked via Steam OpenID (ROK-417, `api/src/drizzle/schema/users.ts:17`).
2. **If a user is found:** the participant is that RL user. If they also have `users.discord_id` (`users.ts:16`), carry it, so the same person in voice and on the server collapses to one roster row.
3. **If no user is found:** record an **anonymous Steam participant**. Label it with the character name (FIFO-paired) and key it on the SteamID. This mirrors how unlinked Discord members are tracked today (`ad-hoc-participants.ts:14-18` header).
4. **Never** key on character name or ZDOID.
5. **Crossplay (later):** a `Xbox_…` platform id has no RL linking today, so it is anonymous-only.

---

## Q4: Event-model plug-in

### What exists (verified anchors on `c303d3ced`)
- `AdHocEventService.handleVoiceJoin` (`api/src/discord-bot/services/ad-hoc-event.service.ts:108`)
  - kill switch `isEnabled` (`:92`)
  - then `tryJoinExisting` (`:300`)
  - then `resolveSpawnClearance` (`ad-hoc-spawn-clearance.ts:79`)
  - then `spawnNewEvent` (`ad-hoc-event.handlers.ts:98`).
- `handleVoiceLeave` (`:178`) leads to `processLeave` (`:316`), then `startGracePeriod` (`ad-hoc-event.handlers.ts:221`). The grace length is `binding.config.gracePeriod ?? 5` minutes. With no binding it reads `null`, so the default of 5 applies unchanged. Then `finalizeEvent` (`:207`).
- **Suppression is binding-scoped.**
  - `checkSuppression(db, bindingId, gameId, …)` (`ad-hoc-spawn-clearance.ts:62`) calls `suppressScheduled` (`ad-hoc-suppression.helpers.ts:295`), which calls `findActiveScheduledEvent(db, bindingId, …)` (`ad-hoc-event.helpers.ts:48`).
  - The `SpawnClearanceReceipt` is bound to `(bindingId, gameId)`, and the class is private.
- `createAdHocEventRow(db, bindingId, …)` (`ad-hoc-event.helpers.ts:103`) writes `events.channel_binding_id`. That column is **already nullable** (`events.ts:91`, `onDelete: 'set null'`), so a server-born event can have no binding.
- `buildEventKey(bindingId, gameId)` (`ad-hoc-event-key.helpers.ts:23`) and the in-memory `activeEvents` map (`ad-hoc-event.service.ts:54`).
- The reaper (`ad-hoc-reaper.service.ts:41`, `findOrphanedAdHocEvents` `ad-hoc-event.helpers.ts:277`) is source-agnostic: it uses `is_ad_hoc`, status and the `extended_until`/`duration` cutoff. It works unchanged.
- Participants: `discord_user_id` is **NOT NULL** (`ad-hoc-participants.ts:31`), and so is `discord_username` (`:32`). The unique index is on `(event_id, discord_user_id)` (`:43-45`). `VoiceMemberInfo` (`ad-hoc-participant.service.ts:13`) is Discord-shaped.

### Proposed design
1. **Spawn source key.**
   - Generalise the receipt's `bindingId` into a `spawnSourceKey: string`. The voice path passes its `bindingId` unchanged; the server path passes `pelican:<pelican_servers.id>`.
   - The event key becomes `buildEventKey(spawnSourceKey, gameId)`.
   - The receipt stays private and single-use, so the ROK-1456 structural guarantee is preserved.
2. **Game-scoped suppression.** For a server source there is no binding.
   - Add a `findActiveScheduledEvent` variant that matches only on `gameId`: any live scheduled event for that game.
   - It reuses `planSuppressionExtension`/`applySuppressionPlan`, so server presence during a scheduled Valheim night **extends** that event exactly like voice does.
   - **UNVERIFIED:** I did not read `buildBindingClause` fully. The build lane must confirm a game-only clause is consistent with the `matchedBy`/`isCrossGameAnchor` logic (`ad-hoc-suppression.helpers.ts:319`).
3. **New entry point:** `AdHocEventService.handleServerPresenceJoin(source, participant)` and `handleServerPresenceLeave(source, participantKey)`.
   - Same kill switch, `tryJoinExisting`, suppression, `spawnNewEvent`, and leave, grace and finalize.
   - `handleVoiceJoin`'s signature does not change.
   - The service file is already about 360 lines, so put the new methods in a sibling `ad-hoc-server-presence.service.ts` that calls exported handlers. Do not grow the service.
4. **Attach to game, record the server.**
   - The Quick Play is **for the game**: use `pelican_servers.game_id` (`pelican-servers.ts:32`). If `game_id` is null the server is not eligible, which avoids "Gaming — Quick Play" noise.
   - The server is recorded as the source (`spawnSourceKey`).
   - **Overlap rule (operator Q4):** if a voice-born Quick Play for the same game is already live, server joins attach to it rather than spawning a second event.
5. **Participants migration (one migration):**
   - Make `discord_user_id` nullable.
   - Add `steam_id varchar(32) NULL` and `source varchar(16) NOT NULL DEFAULT 'discord'`.
   - Add `CHECK (discord_user_id IS NOT NULL OR steam_id IS NOT NULL)`.
   - Replace the unique index with two **partial** uniques: `(event_id, discord_user_id) WHERE discord_user_id IS NOT NULL` and `(event_id, steam_id) WHERE steam_id IS NOT NULL`.
   - Keep `discord_username` as the display-name column (character name for Steam rows). Renaming it is churn; flag it as tech debt.
   - **Rejected:** a synthetic `discord_user_id = 'steam:<id>'`. It would leak into code that treats the value as a Discord snowflake: DMs, avatar URLs, `voiceAttendanceService.handleLeave`.
6. **Roster contract (NOT purely additive, Codex P2):** `AdHocParticipantSchema.discordUserId` is `z.string()` (`packages/contract/src/ad-hoc-events.schema.ts:16`). A Steam-only row has no Discord id, so the field must become `z.string().nullable()`, plus optional `source` / `steamId`. Widening a response field breaks every consumer that assumes a string (web roster rendering, avatar URLs, DM helpers), so this slice is a **breaking** contract change under CLAUDE.md: `--full` gate, every `discordUserId` reader on the ad-hoc path updated in the same PR, and a test with a Steam-only participant.

---

## Q5: Runtime

- **Where it runs:** a `PelicanConsoleSupervisor` in the Pelican plugin (`api/src/plugins/pelican/`) holds **one socket per opted-in server whose state is `running`**.
  - It starts and stops on `status` push events and on `PelicanStatusService` poll transitions.
  - This assumes the API is a single process, as in the allinone NAS deployment. **Multiple API replicas would double-connect.** If that ever matters, guard with a Redis lock (UNVERIFIED need).
- **Reconnect:** exponential backoff of 1s, 2s, 4s… up to a 60s cap, with jitter.
  - Re-fetch a token on every reconnect, and on `token expiring`.
  - After reconnecting, `send logs` replays 150 lines. Dedupe them against the last processed `(timestamp, line)` and replay only newer lines through the tracker.
- **Timestamps:** lines carry **container-local** `MM/dd/yyyy HH:mm:ss`. **Live lines use receive time.** Parsed timestamps are only for ordering and deduping replayed lines, so the container time zone does not matter (cf. ROK-1795).
- **Reconcile:** on every `Connections N ZDOS` heartbeat (10 min), if tracked presence ≠ N, trust N.
  - **N=0:** leave all.
  - **N < tracked:** leave the longest-silent players.
  - **N > tracked:** keep, and log. That only happens after a missed join, which a later `Closing socket` cannot fix anyway.
- **Server stops** (`status: offline`, `OnApplicationQuit`, or the poll says offline): treat everyone present as left. That starts the grace period, then finalize.
- **Panel or Wings unreachable:**
  - Freeze presence, with no spawns and no leaves.
  - If it stays unreachable past **15 min** (default, operator Q7), leave all, then grace, then finalize. That way an orphaned Quick Play ends cleanly instead of waiting for the reaper.
- **RL restart:** the in-memory `activeEvents` map is lost.
  - The voice path rehydrates in `onModuleInit` (`ad-hoc-event.service.ts:75`).
  - The server path rehydrates from the DB, not the log (Codex P2: the heartbeat carries only a count, so it cannot recover WHO is present once their joins are older than the 150-line replay). On boot, load the open Pelican-sourced ad-hoc event per server and its participants with `left_at IS NULL` (their `steam_id` is persisted by item 5) into the tracker, then apply the replay on top (joins/leaves newer than the last processed line), then let the next `Connections N ZDOS` heartbeat reconcile the count. If the server went offline while RL was down, the first status poll leaves everyone and the grace period finalizes the event.
- **Secrets:** yolk entrypoints conventionally echo the parsed startup line to the console, and this egg's startup line contains `-password "{{PASSWORD}}"` (UNVERIFIED for this image).
  - **The console stream must be treated as secret-bearing:** never log or persist raw lines.
  - The parser emits only typed presence events.

---

## Sliced build plan (each slice is one lane, about 25 turns)

| # | Slice | Files (new unless noted) | Test tier | Gate |
|---|---|---|---|---|
| 0 | **Access probe.** Fleet lane or operator: a throwaway script with RL's real `pacc_` key gets a token, sets `Origin`, does `auth` and `send logs`, and prints the line count only. | none (script in the scratchpad) | manual | none. **Blocks slice 2's assumptions.** |
| 1 | **Parser and tracker (pure).** `valheim-presence.parser.ts` (regexes above, typed events), `server-presence.tracker.ts` (FIFO handshake to name pairing, SteamID present-set, death ≠ leave, wrong-password retract, heartbeat reconcile, stop → leave-all). Anonymised fixture from this doc. | `api/src/plugins/pelican/presence/*` | unit (mutate every assertion) | `--static` |
| 2 | **Websocket client.** `PelicanClient.getWebsocketCredentials(id)` (`pelican-client.ts`, edit), `pelican-console-socket.ts` (auth, `send logs`, token refresh, backoff, `status` passthrough, `Origin` header). Fake-ws unit tests. | plugin dir | unit | `--static` |
| 3 | **Schema.** Participants migration (Q4.5), plus `pelican_servers.presence_tracking` boolean default false. Repository and participant-service upsert by source. Additive roster DTO. **Migration generated last.** | `drizzle/schema/ad-hoc-participants.ts`, `pelican-servers.ts`, contract | integration (real DB) | **`--full`** (migration) |
| 4 | **Quick Play bridge.** `spawnSourceKey` generalisation, game-scoped suppression variant, `ad-hoc-server-presence.service.ts` entry points, identity resolver (`users.steam_id` to user and discord id). This touches ROK-959/1456 guard code, so keep every existing suppression assertion untouched. | `discord-bot/services/*` | integration | `--static` + new integration spec on the fleet |
| 5 | **Supervisor and wiring.** Lifecycle per opted-in running server, panel-down timeout, rehydrate, kill switch, Nest module wiring. | plugin dir | integration (fake socket) | `--static` |
| 6 | **Admin toggle UI.** A per-server "Detect Quick Play from server logs" switch on the Pelican servers admin page. It **reuses the existing toggle primitive** (`docs/design-system.md` §3), so there is no new pattern. Includes a fleet test plan. | `web/…` pelican admin | Playwright and test plan | `--static` + changed specs |

Slices 1 and 2 are independent and can run in parallel. Slice 4 depends on slice 3, and slice 5 depends on slices 1, 2 and 4.

---

## Open operator questions (numbered, with recommended defaults)

1. **Opt-in scope:** do we enable this per server, or for every Pelican server whose game has a parser? **Default:** per-server toggle, off by default.
2. **Spawn threshold:** does a solo player tending their farm open a Quick Play? **Default:** spawn when **≥2 players** have been present together for **≥3 min**. The voice path's own threshold was not checked in this spike.
3. **Unlinked Steam players:** show them as anonymous participants (character name), or drop them? **Default:** show them as anonymous, matching unlinked Discord members.
4. **Voice plus server overlap for the same game:** **Default:** attach to the existing live Quick Play. Never run two concurrent Quick Plays for one game.
5. **Discord announcement for server-born sessions:** **Default:** post to the game's existing Quick Play-bound channel if there is one, otherwise web-only (no new channels).
6. **Scheduled-event suppression:** should server presence during a scheduled Valheim event suppress spawning and extend that event, as voice does? **Default:** yes.
7. **Panel-unreachable timeout** before ending a live session: **Default:** 15 min.
8. **Crossplay / Xbox players:** **Default:** out of scope for v1, Steam-only. Revisit after one crossplay log sample.
9. **Pelican permissions:** create a dedicated RL subuser with `websocket.connect` plus the existing read permissions, and **no** `control.console`. **Default:** yes. RL never sends console commands.

---

## What I verified, flagged, and did not reach
- **Verified:**
  - The log line formats, from a real 4-hour session log on the operator's server. The noise figures are measured from the first 1,003 lines.
  - All `file:line` anchors cited above, by grep on `c303d3ced`.
  - The Wings and panel websocket mechanics, from source.
- **Flagged UNVERIFIED:**
  - That a live socket opens with RL's key (slice 0).
  - The crossplay/PlayFab line format.
  - Whether `Player history entry` is vanilla.
  - Whether the yolk echoes the password.
  - The internals of `buildBindingClause` for a game-only variant.
  - The multi-replica API assumption.
- **Not reached:**
  - Any second game. The parser interface is per-game, but only Valheim was sampled.
  - Reading the voice path's spawn threshold and delayed-spawn timer.
