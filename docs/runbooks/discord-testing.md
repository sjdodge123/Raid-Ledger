# Discord testing tools — reference

> Extracted from `CLAUDE.md` on 2026-09-18 to keep the always-loaded project
> instructions small. **The rules still live in CLAUDE.md** ("## Discord
> Testing"): run the smoke suite before pushing bot changes, never weaken an
> assertion, never `sleep()`. This file is the tool inventory you consult after
> you know the rule. Authoring standards live in `TESTING.md`. Not
> independent — do not add rules here.

## Launch Discord with CDP

```bash
./scripts/launch-discord.sh          # Launch with CDP on port 9222
./scripts/launch-discord.sh --kill   # Kill + relaunch with CDP
```

## Companion bot (`tools/test-bot/`) — API-level testing

A discord.js v14 bot. CI-compatible, stable, uses official Discord APIs.

- **Config:** `tools/test-bot/.env` (token + guild ID are static; channel IDs are per-test)
- **Programmatic usage:** `import { connect, readLastMessages, joinVoice, ... } from '../tools/test-bot/src/index.js'`
- **Helpers:**
  - Messages: `readLastMessages(channelId, count)`, `waitForMessage(channelId, predicate, timeout)`, `readDMs(count)`
  - Voice: `joinVoice(channelId)`, `leaveVoice()`, `moveToChannel(channelId)`, `getVoiceMembers(channelId)`
  - Interactions: `clickButton()`, `selectDropdownOption()` (limited — bots can't click other bots' buttons via Discord API)
  - Deterministic polling (replaces `sleep()`): `pollForEmbed(channelId, predicate, timeout)`, `waitForEmbedUpdate(channelId, predicate, timeout)`, `waitForDM(userId, predicate, timeout)`, `pollForCondition(check, timeout)` — see `tools/test-bot/src/helpers/polling.ts`
- **Voice threshold allowlist (ROK-1711):** the API skips bots in the voice game-filtered count, so the companion bot only counts toward `minPlayers` when its user id is in the API's `VOICE_THRESHOLD_BOT_ALLOWLIST` under `DEMO_MODE` (CI derives it from `TEST_BOT_TOKEN`, fleet envs from `RL_TEST_BOT_USER_ID` on the VM, local from root `.env`).
- **Key limitation:** bots cannot interact with other bots' message components. Test button/interaction handlers directly in NestJS integration tests instead.

## MCP Discord tools (`tools/mcp-discord/`) — UI-level verification

Playwright-over-CDP. Local dev only; requires Discord running with CDP. Registered in `.mcp.json` as `mcp-discord`, exposed as `mcp__mcp-discord__*`.

Seven tools: `discord_screenshot`, `discord_read_messages`, `discord_navigate_channel`, `discord_verify_embed`, `discord_click_button`, `discord_check_voice_members`, `discord_check_notification`.

Use for: visual verification of embeds, checking DM notification delivery, verifying voice channel membership as shown in the Discord UI, screenshots for debugging. **Not for CI** — requires local Discord Electron with CDP enabled.

## Which tool when

| Scenario | Tool | Why |
|----------|------|-----|
| Verify bot sends correct embed content | Companion bot (`readLastMessages`) | API-level, reliable, CI-safe |
| Verify embed renders correctly in Discord | MCP (`discord_verify_embed`) | Needs visual/DOM inspection |
| Check who's in a voice channel (API) | Companion bot (`getVoiceMembers`) | Uses guild cache, fast |
| Check voice UI shows members correctly | MCP (`discord_check_voice_members`) | Reads Discord sidebar DOM |
| Test button click handlers | NestJS integration tests | Bots can't click other bots' buttons |
| Debug what Discord looks like right now | MCP (`discord_screenshot`) | Visual aid |
| Wait for bot to respond to a command | Companion bot (`waitForMessage`) | Event-based, reliable |

## Test-only API endpoints (`/admin/test/*`, DEMO_MODE only)

Used by smoke fixtures for operations needing server-side coordination:

- `POST /admin/test/await-processing` — drain all BullMQ queues before asserting
- `POST /admin/test/flush-embed-queue` — drain embed sync queue
- `POST /admin/test/flush-notification-buffer` — flush buffered notifications
- `POST /admin/test/flush-voice-sessions` — flush in-memory voice sessions to DB
- `POST /admin/test/sign-in-link` — mint a magic link so an agent signs in without typing a password
- `POST /admin/test/intent-token` — mint a **redeemable join intent token** (ROK-1841)

### `POST /admin/test/intent-token`

The Discord bot's "Join & Sign Up" button is otherwise the only producer of a
join intent token, so Playwright could prove the `/join` error states but never
a successful sign-in. This fixture mints one through
`IntentTokenService.generate` — the bot's own signer, claim shape and 15-minute
TTL — so `POST /auth/redeem-intent` accepts it and the fixture cannot drift from
the wire format.

```jsonc
// request
{ "eventId": 42, "intent": "signup", "userId": 7 } // userId optional
// response (200)
{
  "token": "<jwt>",                       // live token — never log it
  "url": "https://host/join?intent=signup&eventId=42&token=…",
  "eventId": 42, "intent": "signup",
  "discordId": "…", "expiresInSeconds": 900
}
```

- `intent` takes only the intents the bot mints. `IntentTokenPayloadSchema`
  pins `action` to `'signup'` today, so anything else is a **400**.
- `userId` stamps that user's `discordId` into the token, which is what keeps
  the redeem path's Discord-id mismatch guard happy. Omit it (or name a user
  with no `discordId`) and the token carries the placeholder
  `demo-test-intent-token` — redeemable only by a user that has no `discordId`
  of their own.
- Unknown event or unknown user → **404**. DEMO_MODE off (env **or** DB flag),
  or a non-admin caller → **403**, like every sibling.
- Single-use, as in production: the second redeem of the same token is refused.
- Consumers: `scripts/smoke/public-pages.smoke.spec.ts` (the `/join` flow,
  redeemed as the smoke invitee fixture user — the event's creator is already
  on its roster), `api/src/admin/demo-test-intent-token.integration.spec.ts`
  (8 cases: the four gates, 400/404 rejections, a real redeem creating the
  signup with a decoded 15-minute TTL, single-use, placeholder mismatch) and
  `api/src/admin/demo-test-intent-token.helpers.spec.ts` (body parsing, and
  parity with the bot's "Join & Sign Up" URL).

Full list: `api/src/admin/demo-test-*.controller.ts` (start with `demo-test-core.controller.ts`).

## Test categories

Map to files in `tools/test-bot/src/smoke/tests/*.test.ts` — see file names for current coverage areas. Directory layout, CDP-gated tests, and test anatomy: `TESTING.md` → "Discord Smoke Tests (Companion Bot)".

## ROK-1833 — Valheim Link ingest (not Discord, noted here for testers)

The mod posts to `POST /api/plugins/valheim/link/messages/:kind` and `PUT /api/plugins/valheim/link/blobs/:sha256` with a `rlvl_…` bearer (DEMO_MODE seed: `/admin/test/valheim/…`). Per-server caps: `VALHEIM_LINK_RATE_MESSAGES_PER_MIN` (60), `VALHEIM_LINK_RATE_BLOBS_PER_MIN` (20), `VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER` (2 GiB) and `VALHEIM_LINK_MAX_BLOBS_PER_SERVER` (2000, 413 `quota_exceeded`); per IP, `VALHEIM_LINK_RATE_AUTH_PER_MIN` (30 failed token attempts, 429 `rate_limited`). **Known gap:** prod nginx (`nginx/monolith.conf.template`, `nginx/default.conf`) still caps request bodies at 10 MiB, so a blob over 10 MiB gets nginx's HTML 413 before the API sees it, until the separate infra PR raises it for `/api/plugins/valheim/link/`.
