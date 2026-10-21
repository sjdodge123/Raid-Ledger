# ROK-1888 L3 handover (drop before PR)

Commits: `f9f1cf1d1` (card labels/counts/hint), `d7a798752` (activeCount split + unit specs).

## What shipped
- `services/ad-hoc-anonymous-row.helpers.ts` (import-free):
  - `UNLINKED_SERVER_SUFFIX = ' · on server'` (re-exported from `channel-presence-room.roster.helpers.ts`)
  - `type LinkIdentity = { userId: number | null; discordUserId: string | null; steamId: string | null }`
  - **`isUnlinkedServerRow(row: LinkIdentity): boolean`** — `discordUserId === null && userId === null && steamId !== null`
  - `isDiscordOnlyRow(row: LinkIdentity): boolean` — `discordUserId !== null && userId === null`
- `services/ad-hoc-unlinked-row.sql.ts`: `UNLINKED_SERVER_ROW_SQL` — same predicate as drizzle SQL (L4: use for "event has ≥1 open unlinked row" / merge-on-link lookup).
- `ad-hoc-notification.helpers.ts`: `AdHocParticipant.unlinkedOnServer` / `.discordOnly`; `isCountedParticipant(p)`; `readParticipants` sets the flags; `signupCount` excludes unlinked + anonymous; mentions carry `uncounted: true` + suffix; `presenceFlags` sets `serverAnonymousUncounted` + `discordOnlyPresent`.
- `discord-embed.factory.ts`: mention `uncounted?`, `serverAnonymousUncounted?`, `discordOnlyPresent?`.
- `discord-embed-quickplay.helpers.ts`: LIVE count skips `uncounted` and (when flagged) anonymous; LIVE-only hint line `Not on Raid Ledger yet? [Join Raid Ledger ↗](<clientUrl>/login)` before `Open event ↗` (`JOIN_HINT_LEAD`/`JOIN_HINT_LABEL` exported; copy pending Lead confirmation).
- `AdHocParticipantService.getActiveCount` now excludes unlinked rows (web/gateway "N playing"); new `getOpenRowCount` keeps every open row and replaces it in `ad-hoc-server-presence.effects.ts::afterServerLeave` so an unlinked player still on the server keeps the session out of grace (ruling 1).

## Deliberate decisions
- Lobby presence card unchanged (OQ1): its evented groups go through `buildQuickPlayEmbed` too, so the anonymous-count reversal is opt-in via `serverAnonymousUncounted` (set only by `assembleEmbedData` from flagged participants; the lobby builds its own participants and stamps `serverAnonymousCount` via `withServerAnonymous`). The existing ROK-1801 "counts anonymous ... 3 playing" unit test stays green on purpose.
- Lobby threshold (`voice-lobby-server-merge.helpers`) not touched — ruling 1.

## NOT done (next lane)
- `services/ad-hoc-unlinked-server-count.integration.spec.ts` (AC5/AC6: real-DB `readParticipants` → `buildEmbedEventData`; `getActiveCount` vs `getOpenRowCount`) — not written (turn budget).
- AC7 unit cases in `voice-lobby-server-merge.helpers.spec.ts` — not written.
- Red-first not shown for the new unit cases (code landed first); verify by reverting `f9f1cf1d1`'s `activeCount`/hint hunks.
- L5 smoke: `+N on server` cards now report fewer "playing"; grep test-bot for `playing`/`signed up`.
