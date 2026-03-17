# Raid Ledger

Monorepo: `api` (NestJS), `web` (React/Vite), `packages/contract` (shared types).

## Key References

- **Project context:** `project-context.md` — architecture, stack, conventions
- **Testing guide:** `TESTING.md` — patterns, anti-patterns, coverage thresholds, exemplary files

## Pull Requests

- **Always enable auto-merge (squash)** after creating or pushing to a PR: `gh pr merge <branch> --auto --squash`
- This is safe to run whether the PR was just created or already existed — it's a no-op if already enabled.

## Local Dev Environment

- **Start everything:** `./scripts/deploy_dev.sh` — ensures Docker is up, runs migrations, seeds data, starts API + web in watch mode
- **Flags:** `--rebuild` (rebuild contract), `--fresh` (reset DB), `--reset-password`, `--branch <name>`, `--ci` (non-interactive, for agents), `--down`, `--status`, `--logs`
- **Worktree-safe:** The deploy script auto-detects worktrees, copies `.env` + `api/.env` from the main repo, and always uses the correct Docker volumes. Just run `./scripts/deploy_dev.sh --ci --rebuild` from any worktree.
- **Ports:** API on `:3000`, Web on `:5173` (Vite may increment to `:5174` if `:5173` is in use — CORS allows both)
- **DEMO_MODE=true** in root `.env` enables auth bypass with prefilled credentials
- **Docker volume gotcha (handled automatically):** The deploy script uses `docker start` by name first, falling back to `docker compose` from the main repo's compose file. This prevents worktrees from creating separate volumes with wrong directory prefixes.

## Code Size Limits (STRICT — enforced by ESLint)

- **Max 300 lines per file** (`max-lines: warn`, skipBlankLines + skipComments) — will be upgraded to `error` once existing violations are resolved
- **Max 30 lines per function** (`max-lines-per-function: warn`, skipBlankLines + skipComments) — will be upgraded to `error` once existing violations are resolved
- **Design small from the start** — do not write large files and refactor after. Plan focused modules, extract helpers/sub-services/child components proactively.
- Test files (`*.spec.ts`, `*.test.tsx`) have a relaxed **750-line** file limit (not 300).
- Migration files are exempt from both limits.

## Infrastructure Changes (STRICT — Dockerfiles, entrypoints, nginx)

**Two deployment topologies exist — understand BOTH before changing either:**
- `api/Dockerfile` — API-only image for docker-compose dev/test (user: `nestjs`, Redis via TCP)
- `Dockerfile.allinone` — Production monolith for Synology NAS (user: `app`, supervisor, Redis via Unix socket at `/tmp/redis.sock` with `770` perms)

**Mandatory before pushing ANY infrastructure change:**
1. Read BOTH Dockerfiles to understand what your change affects
2. Build the allinone image locally: `docker build -f Dockerfile.allinone -t rl:test .`
3. Start it: `docker run --rm -d --name rl-test -p 8080:80 rl:test`
4. Verify: `curl http://127.0.0.1:8080/api/health` returns `{"status":"ok"}`
5. Cleanup: `docker stop rl-test`

**Rules:**
- Infrastructure changes get their OWN PR — never bundle with code changes
- Never merge infrastructure PRs without CI passing (container-startup job)
- One fix per outage attempt. If a hotfix fails, REVERT to last known good state — do not stack more fixes
- The allinone entrypoint runs as root (supervisor manages child process users) — do NOT add privilege dropping to `docker-entrypoint.sh`

## Testing

- **Backend:** `npm run test -w api` (Jest). Coverage: `npm run test:cov -w api`
- **Frontend:** `npm run test -w web` (Vitest). Coverage: `cd web && npx vitest run --coverage`
- **Smoke tests:** `npx playwright test` (Playwright, requires DEMO_MODE=true for auth flows)
- **Read `TESTING.md` before writing or modifying any test file.**
- Shared test infra: `api/src/common/testing/` (drizzle-mock, factories), `web/src/test/` (MSW handlers, render helpers, factories)

## Discord Testing (tools/)

Two tools exist for testing Discord bot functionality. **Use these when testing any Discord-related feature** (events, attendance, notifications, embeds, voice).

### Launch Discord with CDP

```bash
./scripts/launch-discord.sh          # Launch with CDP on port 9222
./scripts/launch-discord.sh --kill   # Kill + relaunch with CDP
```

### Companion Bot (`tools/test-bot/`)

A discord.js v14 bot for **API-level testing** — CI-compatible, stable, uses official Discord APIs.

- **Config:** `tools/test-bot/.env` (token + guild ID are static; channel IDs are per-test)
- **Programmatic usage:** `import { connect, readLastMessages, joinVoice, ... } from '../tools/test-bot/src/index.js'`
- **Available helpers:**
  - Messages: `readLastMessages(channelId, count)`, `waitForMessage(channelId, predicate, timeout)`, `readDMs(count)`
  - Voice: `joinVoice(channelId)`, `leaveVoice()`, `moveToChannel(channelId)`, `getVoiceMembers(channelId)`
  - Interactions: `clickButton()`, `selectDropdownOption()` (limited — bots can't click other bots' buttons via Discord API)
- **Key limitation:** Bots cannot interact with other bots' message components. Test button/interaction handlers directly in NestJS integration tests instead.

### MCP Discord Tools (`tools/mcp-discord/`)

Playwright-over-CDP tools for **UI-level verification** — local dev only, requires Discord running with CDP.

- **Registered in `.mcp.json`** as `mcp-discord` — tools are available as `mcp__mcp-discord__*`
- **7 tools:** `discord_screenshot`, `discord_read_messages`, `discord_navigate_channel`, `discord_verify_embed`, `discord_click_button`, `discord_check_voice_members`, `discord_check_notification`
- **When to use:** Visual verification of embeds, checking notification delivery in DMs, verifying voice channel membership shown in Discord UI, screenshots for debugging
- **Not for CI** — requires local Discord Electron with CDP enabled

### When to use which tool

| Scenario | Tool | Why |
|----------|------|-----|
| Verify bot sends correct embed content | Companion bot (`readLastMessages`) | API-level, reliable, CI-safe |
| Verify embed renders correctly in Discord | MCP (`discord_verify_embed`) | Needs visual/DOM inspection |
| Check who's in a voice channel (API) | Companion bot (`getVoiceMembers`) | Uses guild cache, fast |
| Check voice UI shows members correctly | MCP (`discord_check_voice_members`) | Reads Discord sidebar DOM |
| Test button click handlers | NestJS integration tests | Bots can't click other bots' buttons |
| Debug what Discord looks like right now | MCP (`discord_screenshot`) | Visual aid |
| Wait for bot to respond to a command | Companion bot (`waitForMessage`) | Event-based, reliable |
