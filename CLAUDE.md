# Raid Ledger

Monorepo: `api` (NestJS), `web` (React/Vite), `packages/contract` (shared types).

## Key References

- **Project context:** `project-context.md` — architecture, stack, conventions
- **Testing guide:** `TESTING.md` — patterns, anti-patterns, coverage thresholds, exemplary files

## MCP Tools (registered in `.mcp.json`)

Three custom MCP servers provide tools for environment management, story tracking, and Discord testing. **Use these instead of manual shell commands.**

### `mcp-env` — Environment & Story Status (`tools/mcp-env/`)
| Tool | Use When |
|------|----------|
| `mcp__mcp-env__env_check` | Check .env files: existence, missing vars, worktree status. Use BEFORE `deploy_dev.sh` or when builds fail due to missing env vars. |
| `mcp__mcp-env__env_copy` | Copy .env files from main repo to worktree. Use when setting up worktrees. |
| `mcp__mcp-env__env_service_status` | Check Docker containers, ports, API health. Use to verify local dev environment is running. |
| `mcp__mcp-env__story_status` | Check delivery status of stories (git branches + PRs). Use when resuming in-flight work to reconcile state against origin. |

### `mcp-discord` — Discord UI Testing (`tools/mcp-discord/`)
| Tool | Use When |
|------|----------|
| `mcp__mcp-discord__discord_screenshot` | Take a screenshot of Discord. Use for visual debugging. |
| `mcp__mcp-discord__discord_read_messages` | Read messages from a Discord channel. |
| `mcp__mcp-discord__discord_verify_embed` | Verify embed content in a channel. |
| `mcp__mcp-discord__discord_navigate_channel` | Navigate to a specific channel. |
| `mcp__mcp-discord__discord_click_button` | Click a button on a Discord message. |
| `mcp__mcp-discord__discord_check_voice_members` | Check voice channel members. |
| `mcp__mcp-discord__discord_check_notification` | Check DM notifications. |

**Note:** `mcp-discord` requires Discord running with CDP (`./scripts/launch-discord.sh`). Local dev only.

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

### Migration Generation Rules

- **Always run `./scripts/fix-migration-order.sh --check`** after generating a migration to verify journal timestamps are monotonically increasing. Concurrent branches can produce out-of-order timestamps that Drizzle silently skips.
- **Validate against a real Postgres instance** before pushing: `./scripts/validate-migrations.sh` spins up a temporary container, runs all migrations, and tears down. This is also run automatically by `validate-ci.sh` when migration files appear in the diff.
- **Never hand-edit migration SQL** unless fixing a known Drizzle codegen bug. If you must, document the edit in the commit message.
- **One migration per schema change.** Do not combine unrelated schema changes into a single migration file.

### Migration State Recovery

Backups exclude the `drizzle` schema (migration metadata is code, not data) to prevent cross-branch hash drift. When restoring a backup or unsticking a drifted dev DB:

- **`DATABASE_URL=... node scripts/reconcile-migrations.mjs`** — probes each journal entry, skips any whose effects already exist (treats `column already exists`, `relation already exists`, etc. as idempotent), runs anything truly missing, and records the hash row. Safe to re-run. Add `--dry-run` to preview.
- `deploy_dev.sh` calls reconcile automatically after an auto-restore from `api/backups/daily/`.
- **Symptom that means you need reconcile:** `drizzle-kit migrate` fails with `column/relation X already exists` on a migration whose hash isn't in `drizzle.__drizzle_migrations`.

## Testing

- **Backend:** `npm run test -w api` (Jest). Coverage: `npm run test:cov -w api`
- **Frontend:** `npm run test -w web` (Vitest). Coverage: `cd web && npx vitest run --coverage`
- **Smoke tests:** `npx playwright test` (Playwright, requires DEMO_MODE=true for auth flows)
- **Read `TESTING.md` before writing or modifying any test file.**
- Shared test infra: `api/src/common/testing/` (drizzle-mock, factories), `web/src/test/` (MSW handlers, render helpers, factories)

### Local CI

Run `./scripts/validate-ci.sh --full` before pushing any branch. This replaces manual per-step checks.

| GitHub CI Job | Local Equivalent | Script |
|---------------|------------------|--------|
| Build | `npm run build` (all workspaces) | `validate-ci.sh` |
| TypeScript | `npx tsc --noEmit` (api + web) | `validate-ci.sh` |
| Lint | `npm run lint` (api + web) | `validate-ci.sh` |
| Unit tests | `npm run test:cov -w api`, `vitest run --coverage` (web) | `validate-ci.sh` |
| Integration tests | `npm run test:integration -w api` | `validate-ci.sh` |
| Migration validation | Postgres container + `drizzle-kit migrate` | `validate-migrations.sh` (conditional) |
| Container startup | Build + start allinone image, health checks | `validate-ci.sh` (conditional) |
| Playwright | `npx playwright test` (desktop + mobile) | Manual (after deploy) |

Migration and container checks run conditionally based on `git diff` against `origin/main`. Playwright remains a separate step because it requires a running dev environment.

### Smoke Test Verification (STRICT — learned from ROK-935 incident)

**CI runs BOTH desktop AND mobile Playwright projects.** Local verification MUST match CI:

```bash
# WRONG — only tests desktop, mobile failures will surprise you in CI
npx playwright test --project=desktop

# RIGHT — tests both projects, matches CI exactly
npx playwright test
```

**Before pushing ANY branch with UI changes:**
1. Run `npx playwright test` (both projects) locally — not `--project=desktop`
2. If any test fails, fix it BEFORE pushing — do NOT use CI as a debugger
3. New components on shared pages (layout, nav, Games page) break selectors in OTHER test files — run the FULL suite, not just your feature's tests

**When smoke tests fail in CI:**
1. Check the ACTUAL error message — is it "element not found", "strict mode", or "timeout"?
2. "Element not found" = the selector is wrong or the UI differs in CI (missing data, unconfigured services)
3. "Strict mode" = selector matches 2+ elements (new DOM from your changes collided with existing selectors)
4. "Timeout" with correct selector = CI runner is slow, increase timeout or add retry
5. **NEVER re-run CI hoping it passes** — investigate the failure first

### Test Failure Rules (STRICT — applies to ALL agents)

- **NEVER dismiss test failures as "pre-existing" or "unrelated to this change."** Every test failure must be investigated and either fixed or tracked in a Linear story with root cause. This rule was violated during ROK-935 and cost 6 hours — it exists for a reason.
- **NEVER use `sleep()` in smoke tests.** Use deterministic wait helpers (`waitForEmbedUpdate`, `pollForCondition`, etc.).
- **NEVER skip or weaken a test assertion to make CI pass.** Fix the code or fix the test infrastructure.
- **Every feature/fix MUST include an end-to-end test:**
  - UI changes → Playwright smoke test (desktop + mobile)
  - Discord bot/notification changes → Discord companion bot smoke test
  - API-only changes → Integration test (Jest, real DB)
  - Pure logic → Unit test

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
  - **Deterministic polling** (replaces `sleep()`): `pollForEmbed(channelId, predicate, timeout)`, `waitForEmbedUpdate(channelId, predicate, timeout)`, `waitForDM(userId, predicate, timeout)`, `pollForCondition(check, timeout)` — see `tools/test-bot/src/helpers/polling.ts`
- **Key limitation:** Bots cannot interact with other bots' message components. Test button/interaction handlers directly in NestJS integration tests instead.

### MCP Discord Tools (`tools/mcp-discord/`)

Playwright-over-CDP tools for **UI-level verification** — local dev only, requires Discord running with CDP.

- **Registered in `.mcp.json`** as `mcp-discord` — tools are available as `mcp__mcp-discord__*`
- **7 tools:** `discord_screenshot`, `discord_read_messages`, `discord_navigate_channel`, `discord_verify_embed`, `discord_click_button`, `discord_check_voice_members`, `discord_check_notification`
- **When to use:** Visual verification of embeds, checking notification delivery in DMs, verifying voice channel membership shown in Discord UI, screenshots for debugging
- **Not for CI** — requires local Discord Electron with CDP enabled

### Discord Smoke Tests (MANDATORY)

Smoke tests in `tools/test-bot/src/smoke/tests/` validate real Discord behavior end-to-end: `cd tools/test-bot && npm run smoke`

**When modifying Discord bot code, you MUST:**
1. Run the smoke tests locally before pushing
2. If a test fails due to intentional behavior change, update the test to match the new behavior — do NOT delete or weaken the assertion
3. If adding new Discord functionality, add a corresponding smoke test
4. Never modify a smoke test just to make CI pass — investigate why it broke first
5. Run the no-sleep lint before pushing: `npm run lint:no-sleep` (from `tools/test-bot/`)

**Deterministic test framework:** All smoke tests use deterministic wait helpers instead of `sleep()`. See TESTING.md "Smoke Test Authoring Standards" for the full helper reference.

**Test-only API endpoints** (`/admin/test/*`, DEMO_MODE only): Used by smoke test fixtures for operations that require server-side coordination. Key endpoints:
- `POST /admin/test/await-processing` — drain all BullMQ queues before asserting
- `POST /admin/test/flush-embed-queue` — drain embed sync queue
- `POST /admin/test/flush-notification-buffer` — flush buffered notifications
- `POST /admin/test/flush-voice-sessions` — flush in-memory voice sessions to DB
- See `api/src/admin/demo-test.controller.ts` for the full list

**Test categories** map to files in `tools/test-bot/src/smoke/tests/*.test.ts` — see file names for current coverage areas.

**Files that trigger smoke test review:**
- `api/src/discord-bot/**` — bot listeners, embed factory, channel bindings, voice state
- `api/src/notifications/**` — notification dispatch, DM embeds, reminder services
- `api/src/events/signups*` — signup creation, auto-allocation, roster assignment
- `api/src/events/event-lifecycle*` — cancel, reschedule, delete flows
- `api/src/admin/demo-test*` — test-only API endpoints used by smoke tests
- `tools/test-bot/src/smoke/**` — the tests themselves
- `tools/test-bot/src/helpers/polling.ts` — deterministic wait helpers

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
