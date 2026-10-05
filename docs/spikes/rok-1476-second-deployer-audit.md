> **Source:** `planning-artifacts/second-deployer-audit-2026-09-17.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-09-17
> **Linear:** ROK-1476

# ROK-1476 — Second-Deployer Readiness Audit

**Frame for every finding: could a stranger install and run this without asking the operator anything?**

Read against `origin/main` via the read-only checkout a read-only local checkout. Research-only spike — no code, git, fleet, or Linear changes made.

---

## 1. First-run path

**`docker run` → logged-in admin: mostly solved, one real gap (the disk mount).**

- **[low] Password generation and delivery works as designed.** `api/scripts/bootstrap-admin.ts` generates a random 16-byte base64 password on first boot (or uses `ADMIN_PASSWORD` if set), creates `admin@local`, and prints a clearly formatted banner to stdout with next steps ("Open the app on the port you published... `/login` → 'Sign in with username instead' → admin@local"). Evidence: `api/scripts/bootstrap-admin.ts:280-332` (`printAdminBanner`/`printBannerNextSteps`). This is genuinely good UX for a stranger who is willing to read `docker logs`.
  - **Annoys, doesn't block:** a stranger who doesn't know to check container logs will be stuck at the login page with no visible way in. Nothing in the web UI hints "check the container logs for a password." `DEMO_MODE` is explicitly NOT a bypass and the login placeholder is empty (per this repo's own memory note), so there's no in-app affordance at all.

- **[blocker] `render.yaml`'s persistent disk is mounted at the wrong path — Postgres data is NOT actually persisted on Render.** `render.yaml:8-10` mounts the disk at `/var/lib/postgresql/data`, but `Dockerfile.allinone` sets `ENV PGDATA=/data/postgresql` (line ~145) and the entrypoint initializes/writes Postgres under `/data/postgresql` (`entrypoint.sh` in the Dockerfile heredoc: `mkdir -p /data/postgresql ...`, `init-db.sh`: `initdb -D "${PGDATA}"`). The `VOLUME /data` declaration is what actually matters, and Render's disk is mounted somewhere the app never reads or writes. Any redeploy on Render (a routine event, not just an upgrade) will silently reset the database — including the freshly-created admin account — with no warning to the deployer. This is a **relay-2 audit finding that directly undercuts ROK-1590's "one-click cloud deploy"** goal: Render is the most likely one-click target and its config is currently a data-loss trap.
  - Evidence: `render.yaml:1-10`, `Dockerfile.allinone` (`ENV PGDATA=/data/postgresql`, `VOLUME /data`, `mkdir -p /data/postgresql ... chown -R postgres:postgres /data/postgresql` in both `init-db.sh` and `entrypoint.sh`).

- **[med] Discord bot invite flow is further along than assumed — the "known" ROK-1471 gap in the brief appears already shipped.** `api/src/discord-bot/discord-bot-invite.controller.ts` (`GET /admin/settings/discord-bot/invite-url`) builds the OAuth2 install URL from `REQUIRED_PERMISSIONS` (`api/src/discord-bot/discord-bot-client.helpers.ts:20-58`) and the bot's own client id (`DiscordBotClientService.getClientId()`, resolved from the connected `discord.js` client). `web/src/components/admin/DiscordBotForm.tsx` renders step-by-step instructions (Developer Portal → New Application → Bot tab → Reset Token → paste token; enable 3 privileged intents; then `DiscordBotInvitePanel` shows the invite URL + copy button) — `web/src/components/admin/DiscordBotForm.tsx:8-26`, `web/src/components/admin/discord-bot-invite-panel.tsx`.
  - **Residual annoyance, not a blocker:** the invite URL only appears *after* the bot token is saved and the bot successfully connects (client id comes from the live `discord.js` client, not from a client-id field the operator types in) — `PENDING_CLIENT_ID_NOTE` in `discord-bot-invite-panel.tsx:19`. A stranger has to (a) create a Discord app, (b) create a bot, (c) copy the token, (d) enable 3 privileged intents, (e) save the token and wait for the bot to connect, before they even see the invite URL. That's still a 5-step manual detour through the Discord Developer Portal with no way to skip it, but it is self-contained — nothing here requires the operator.

- **[low] Onboarding wizard exists and covers the right ground.** `api/src/admin/onboarding.controller.ts` — status/step/complete/reset endpoints, steps for secure-account / community-identity / connect-plugins, gated by `AdminGuard`. `web/src/components/onboarding/discord-join-step.tsx` and `CommunityIdentityStep` (timezone, community name, logo) are wired up. Nothing here assumes the operator's identity.

**Verdict for this section:** a stranger CAN reach a logged-in admin and a working bot without asking anyone, on Docker/Synology/Portainer (named-volume) deployments. The Render path is currently broken by the disk-mount mismatch above.

---

## 2. Single-tenant assumptions

**[low] No hardcoded guild/channel ids or operator identity found in application code.** Grepped `api/src`, `web/src`, `packages/contract` for `gamernight.net`, Discord snowflake literals assigned to `guildId`/`channelId`, and the operator's Discord id (`[redacted]`, called out in `CLAUDE.md`'s "Make the operator admin on the env" runbook) — every hit is in `*.spec.ts`/`*.test.ts` test fixtures, not shipped code. The operator's Discord id lives only in the *rl-infra fleet's* `.env` (`RL_OPERATOR_DISCORD_ID` per `CLAUDE.md`), which is agent-tooling config, not part of the deployed app.

**[low] `admin@local` is a deliberate, generic placeholder, not an operator-specific singleton.** `bootstrap-admin.ts` `DEFAULT_EMAIL = 'admin@local'` — same value for every deployment; no personalization needed.

**[med] `FLEET_ADMIN_DISCORD_ID` promotion path is fleet-only by design but worth flagging as a pattern to not copy.** `promoteFleetOperator()` in `bootstrap-admin.ts:33-92` upserts a specific Discord id to admin — double-gated on `DEMO_MODE==='true'` AND the env var being set, neither of which appears in `Dockerfile.allinone`/`docker-compose.yml`/`.env.docker.example`. This is genuinely inert for a real deployer; flagged only because it's the one piece of code in the repo shaped like "promote a specific person," and a future edit that loosens either gate would reintroduce single-tenant behavior silently.

**[low] Demo/seed data (`seed-igdb-games.js`, `seed-games.js`) is a public game catalogue, not community-specific**, and is explicitly designed to run without API keys (`docker-entrypoint.sh`: "Always seed games (needed for event creation, even without IGDB keys)"). No community-specific seed data ships.

**Verdict:** the codebase itself is clean of single-tenant hardcoding. The operator's identity lives entirely in fleet-tooling config (`rl-infra/.env`), which a second deployer never touches.

---

## 3. Third-party API keys and terms

| Provider | Required? | Graceful degradation | Can a third party get one? |
|---|---|---|---|
| Discord OAuth (`DISCORD_CLIENT_ID/SECRET`) | Optional | Falls back to local admin auth (`admin@local`); `.env.docker.example` says so explicitly | Yes, free, self-serve via Discord Developer Portal |
| Discord Bot | Optional (but needed for the bot-dependent features: events, LFG, notifications) | App runs without it; bot-specific admin panels show "not configured" | Yes, free, self-serve — see §1 |
| IGDB/Twitch (`IGDB_CLIENT_ID/SECRET`) | Optional | `.env.example`: "Pre-seeded with 48+ games — keys only needed for additional game search"; `isIgdbConfigured()` gates search-augmentation calls | Yes, free, self-serve via Twitch Developer Console |
| Steam (`STEAM_API_KEY`) | Optional | Gated by `isSteamConfigured()` (`api/src/settings/settings.service.ts:377`) | Yes, free, self-serve |
| ITAD (`ITAD_API_KEY`) | Optional | Gated by `isItadConfigured()` (`:393`) | Yes, free, self-serve |
| Blizzard Classic API | Optional | Gated by `isBlizzardConfigured()` (`:253`); known partial coverage (bank/professions 404) per this repo's own notes | Yes, self-serve Blizzard dev portal |
| **Co-Optimus** | Optional (co-op facts enrichment only) | Gated by `isCooptimusConfigured()`; sync/test both fail safely (`CooptimusService.testConnection()`, reports 403 explicitly) | **No — see below** |

**[low] All keyed integrations degrade gracefully and are admin-settings-driven, not env-var-required-at-boot.** None of these being unset breaks first boot or blocks login — confirmed via `SettingsService.is*Configured()` gates and the onboarding status DTO treating them as optional "connect plugins" steps (`onboarding.controller.ts` `buildStatusDto`: `connectPlugins: blizzardConfigured || igdbConfigured || discordConfigured`).

**Co-Optimus — the one true blocker in this category:**

- **[blocker] A second deployer must NOT enable Co-Optimus as configured today.** The mechanism is a **UA-keyed Cloudflare exemption granted to ONE named instance** (`api/src/cooptimus/cooptimus.constants.ts` header comment: "Access is Cloudflare-gated for unattended clients — the transport only activates once the operator configures an allowlisted user-agent"). Per this project's own memory (`project_rok_275_cooptimus_decision_pending.md`) and the design spike `docs/spikes/relay-data-contract.md` §7.1, the grant is explicitly scoped: "one instance, non-commercial, invite-only, 'nothing is redistributed'... Multi-instance distribution is OUTSIDE this grant and requires renegotiating with the Co-Optimus contact BEFORE any implementation."
  - **Nothing in the admin UI (`api/src/admin/cooptimus-settings.controller.ts`, presumably a matching settings page) tells a second deployer this.** The settings form just asks for a user-agent string and offers a "Test" button that fires a real request. A second deployer who pastes the operator's UA (if they ever saw it, which they shouldn't since it's never in the repo/contract — confirmed absent from `cooptimus.constants.ts`) would be in breach of the grant; a second deployer who invents their own UA string will simply get 403'd by Cloudflare with no explanation that this is a permission problem, not a bug.
  - **What a stranger experiences:** either the field sits unusable forever (no key to put there, no signup page — this isn't a self-serve API), or they try a UA and get an opaque 403 with no guidance to "this needs individual permission from Co-Optimus, email the site."

**Relay-as-alternative for Co-Optimus (per the ask):** already spiked in depth — see **Relay-readiness notes** below and the **Co-Optimus answer** at the end.

---

## 4. Configuration & secrets

- **[low] `JWT_SECRET` is handled safely and self-heals.** `docker-compose.yml` has a dev fallback (`dev-secret-change-in-prod`), but both `Dockerfile.allinone`'s `start-api.sh` and `docker-entrypoint.sh` explicitly reject known-default values at boot (`is_known_default` check, `start-api.sh` heredoc) and generate+persist a real secret to `/data/.jwt_secret` when unset. This is the correct pattern and it's already defended by tests per the repo's commit history (ROK-1035/ROK-1292/ROK-1576 threads in comments).

- **[med] `CORS_ORIGIN=auto` is the allinone default and is intentionally permissive.** `validateCorsConfig()` (`api/src/main.helpers.ts:137-159`) throws in production if `CORS_ORIGIN` is unset or `*`, but only **warns** for `auto`: "This is intended for single-origin reverse-proxy deployments only." Because the allinone image fronts everything with nginx on one origin, `auto` is actually safe there — but a deployer who exposes the API directly (bypassing nginx, e.g. custom compose setups) on a different origin than the SPA would get silent same-origin-only behavior with just a log warning, not a failure. Low risk for the documented deployment path, worth a one-line README callout for anyone deviating from it.

- **[low] `CLIENT_URL` auto-derivation is clever but silent.** `installAutoClientUrlDetection()` (`api/src/main.ts:25-46`) derives `CLIENT_URL` from the incoming request's `Host` header (skipping `localhost`/`127.0.0.1`) when the env var is unset — this means Discord embed links, event-plan commands etc. "just work" behind any reverse proxy without configuration. No blocker, but it's a non-obvious mechanism a diagnosing stranger wouldn't find without reading source; the boot log doesn't announce it (unlike CORS_ORIGIN which does log its resolution in `start-api.sh`).

- **[low] `.env.example` / `.env.docker.example` are accurate and clearly mark required vs optional.** `DATABASE_URL`/`JWT_SECRET` required; Discord OAuth, IGDB, Steam, ITAD all clearly marked optional with a one-line "why" and a link to where to get credentials.

- **[med] `render.yaml` disk-mount mismatch (already flagged in §1) is really a §4/§5 configuration bug** — it silently produces a fresh, empty Postgres on every Render redeploy since nothing errors; the app just boots as if it's a first run (new random admin password, empty games/events tables, `bootstrap-admin` prints a fresh banner nobody's watching on a background redeploy). This is the single most dangerous "fails silently" item found in this audit.

---

## 5. Upgrade & data safety

- **[low] Boot-time migrations are Sentry-instrumented and loud on failure.** `docker-entrypoint.sh` runs `run-migrations-with-sentry.js`, which per `CLAUDE.md`'s own STRICT rules captures + flushes to Sentry and exits non-zero on failure — good for the operator's own instance (they have Sentry configured), **but a second deployer has no Sentry project of their own by default**, so a migration failure that would have alerted the operator just becomes a crash-looping container for a stranger with only stdout to read. Not a code defect — the pattern is right — but it's worth noting Sentry-dependent alerting is invisible to anyone who hasn't wired their own DSN.

- **[low] Pre-migration snapshot exists.** `docker-entrypoint.sh` takes a `pg_dump` snapshot to `/data/backups/migrations/pre_migration_*.dump` before every migration run — good safety net that works identically for any deployer, no configuration needed.

- **[low] Version/update signal for non-Watchtower deployers is already built — the brief's "ROK-1475" ask appears shipped.** `api/src/version/version-check.service.ts` runs on startup + every 24h, compares `COMMIT_SHA` (baked into images built by `ci.yml`) against `origin/main`'s head via the GitHub commits API when running a commit-pinned image, or compares `APP_VERSION`/`package.json` semver against the latest GitHub release otherwise (`version-check.service.ts:37-70`). Result is stored in `app_settings` (`latest_version`, `update_available`, `latest_release_url`) — presumably surfaced somewhere in the admin UI (not independently verified in this pass, but the DTO/controller in `api/src/version/version.controller.ts` exposes `commitSha`). This gives any deployer — Watchtower or not — a signal without needing the operator.

- **[low] Backup/restore drill tooling (`scripts/backup-restore-drill.sh`) is operator/dev tooling, not shipped in the runtime image** — a second deployer gets automatic daily `pg_dump` backups (`/data/backups/daily`, per `Dockerfile.allinone`'s directory layout and logrotate config) and the in-app `Admin → Backups` panel (`web/src/pages/admin/backups-panel.tsx`) to browse/download/restore them, but no equivalent of the drill script to *prove* their backups restore. This is a reasonable trust boundary for a v1 deployer (the admin UI panel is the self-service surface), just noting the drill itself is dev-only.

---

## 6. Self-service diagnostics

- **[low] `Admin → Logs` panel exists** (`web/src/pages/admin/logs-panel.tsx`, 165 lines) — gives a deployer log visibility without shelling into the container.
- **[low] `Admin → Backups` panel exists** (`backups-panel.tsx`, `backup-panel-modals.tsx`, `backup-panel-utils.ts`) for browsing/restoring dumps in-app.
- **[low] Startup diagnostics are unusually good for a self-hosted app.** `entrypoint.sh`'s privilege-drop diagnostic block prints exactly who owns what before anything starts, and the `/data` writability probe (`ROK-1576`) fails fast with an actionable message pointing at "README → Quick Deploy → Portainer / Synology" instead of crash-looping silently — this was clearly built from real deployer pain (NAS bind-mount ACL issues) and is a genuine strength, not a gap.
- **[low] Health endpoints are layered correctly**: `/health/live`, `/health/ready`, and a deprecated-but-present `/health` alias (`api/src/app.controller.ts:21-42`) — so `render.yaml`'s `/api/health` and `Dockerfile.allinone`'s `HEALTHCHECK` (`/api/health/live`) both resolve.

No significant gaps found in this area — self-service diagnostics are a comparative strength of this codebase versus the other areas audited.

---

## 7. Security posture

- **[low] No default/static credentials ship.** Admin password is always random unless explicitly overridden; `JWT_SECRET` rejects known dev defaults at boot (see §4).
- **[low] Single exposed port by design.** `Dockerfile.allinone` only `EXPOSE`s 80 (nginx); Postgres/Redis are not exposed outside the container (Redis is Unix-socket-only in the allinone image, TCP-only in the `api/Dockerfile` compose-dev image which is not the production topology). No accidental DB port exposure in the production Dockerfile.
- **[low] `DEMO_MODE` defaults are safe.** Not present in `Dockerfile.allinone`, `docker-compose.yml`, or `.env.docker.example` — a second deployer gets it unset (falsy) unless they opt in, and this repo's own memory confirms `DEMO_MODE` is not an auth bypass even when set.
- **[med] nginx runs privilege-dropped, API runs as non-root (`app`, uid 1001), Postgres/Redis run as their own service users** — correctly separated, with a documented history of real incidents (ROK-1036, ROK-1576) driving the current permission model. The one entrypoint-level root requirement (supervisor itself, `user=root` in `raid-ledger.ini`) is disclosed and justified in `CLAUDE.md`: "The allinone entrypoint runs as root (supervisor manages child process users) — do NOT add privilege dropping to `docker-entrypoint.sh`." Not a finding against the app, just noting it for a security-minded second deployer reading the Dockerfile.
- **[low] The `network: assumes reverse-proxy-or-direct-exposure` model is undocumented for HTTPS.** Nothing in the allinone image terminates TLS — a deployer exposing port 80 directly to the internet gets an unencrypted admin login (including the one-time random password flow) unless they front it with their own reverse proxy/TLS terminator. This is normal for a self-hosted app of this shape but isn't called out anywhere a first-time deployer would see it before typing their freshly-generated admin password into a form.

---

## Relay-readiness notes

A relay design has **already been spiked in depth**: `docs/spikes/relay-data-contract.md` (ROK-1485, 2026-09-05, "Complete — recommendation + sequencing at the end"). It directly answers most of what this audit was asked to evaluate:

- **Instance identity:** already exists and is live. `api/src/relay/relay.service.ts` (real code, not just spiked) registers each instance with a random `instanceId` (`randomUUID()`), stores a bearer `token` in `app_settings`, and sends hourly heartbeats + best-effort feedback submission to a configurable relay URL (default `https://hub.raid-ledger.com`, `RELAY_ENABLED` default off). This is currently **telemetry/feedback only** — no game-data sync — and per the spike, `APP_VERSION` is still hardcoded `'0.0.1'` in `relay.service.ts:19` rather than reading the real build version (flagged in the spike as a slice-1 fix).
- **Data boundaries:** the spike defines a STRICT three-way classification rule for every new table/column/DTO — `relay-canonical` / `relay-projected` / `instance-private` — with `instance-private` as the mandatory default for anything carrying a Discord id, display name, message content, a per-person measurement, credentials, or local admin config (spike §8). It retro-classifies this cycle's recent shapes (LFG intents, speed-test data, thread messages) against that rule.
- **Version skew:** spike §11 Q12 proposes the relay serve the current + previous `schemaVersion`, with an instance more than one major behind getting `426 Upgrade Required`.
- **Trust:** spike §5/§11 Q8 — registration + auth sketch, contribution trust model (any registered instance may contribute; relay dedups; admin can quarantine).
- **Co-Optimus via relay is explicitly the recommended long-term path** — see the Co-Optimus answer below.

**Bottom line: the design work for "a relay server fetching enrichment once and redistributing" is already done at the spec level (ROK-1485).** Nothing has been built beyond the existing telemetry/feedback relay client. Slice 1 (canonical game-identity + enrichment pull, read-only, no Co-Optimus) is scoped as the first buildable increment and is explicitly called out in the spike as directly serving "a second deployer (ROK-1476's audience) gets a populated catalogue with zero API keys" — i.e., this very story.

---

## Prioritised follow-up stories (report-only — not filed)

1. **[blocker] Fix `render.yaml` disk mount path.** `mountPath: /var/lib/postgresql/data` → should be `/data` (matching `Dockerfile.allinone`'s `VOLUME /data` and `PGDATA=/data/postgresql`). Without this, every Render redeploy silently wipes the database. Trivial one-line fix; directly blocks ROK-1590 (one-click cloud deploys) if Render is a target.
2. **[high] Co-Optimus: add an explicit in-UI warning on the admin settings page** that the user-agent exemption is single-instance and that a second deployer must contact Co-Optimus for their own permission before configuring it — today the UI just asks for a UA string with no context, and a 403 gives no hint this is a permission wall rather than a bug. Small copy + conditional-banner change.
3. **[med] Relay slice 1 (ROK-1485-1 per the spike's own sequencing)** — canonical game-identity + enrichment pull, read-only. This is the single highest-leverage story for second-deployer readiness: it removes the need for IGDB/Steam/ITAD keys entirely for a populated game catalogue. Spike already scopes contract, migration, sync service, and the admin Relay page's opt-in.
4. **[low] First-boot in-app hint for the admin password.** A banner or `/login` page note along the lines of "First time? Check the container logs for your admin password" would close the "stranger doesn't know to read stdout" gap in §1 without touching security posture (still never displayed in the UI itself).
5. **[low] Document the reverse-proxy/TLS expectation.** A short README section stating the allinone image serves plain HTTP and the deployer is expected to front it with their own TLS terminator (or note if/when a built-in Let's Encrypt option exists) would close the undocumented-HTTPS gap in §7.
6. **[low] Surface `CLIENT_URL` auto-derivation in boot logs**, matching the existing CORS_ORIGIN resolution log line, so a diagnosing stranger doesn't have to read `main.ts` to understand where their Discord embed links are coming from.

---

## Co-Optimus answer

**A second deployment must not enable the current Co-Optimus integration as-is.** The UA exemption is a Cloudflare-gated grant to one named, non-commercial, invite-only instance ("nothing is redistributed") per the recorded email exchange with Co-Optimus; a second deployer configuring their own (or worse, the operator's) user-agent string is either asking Cloudflare to 403 them with no explanation, or is in breach of the existing grant's scope. This repo's own design spike (`docs/spikes/relay-data-contract.md` §7) reaches the same conclusion independently and recommends the only sanctioned path forward: **route Co-Optimus data through the relay server, scraped once by the currently-licensed instance, with `cooptimus_*` fields kept `instance-private` (i.e., not redistributed to other deployments) until the operator explicitly renegotiates redistribution terms with Co-Optimus** (spike §7.2 lists exactly what to ask for: permission to redistribute, which deployment holds "the one instance," expected consumer count/type, per-consumer attribution, footprint disclosure, and a revocation/TTL story). Per-instance per-provider terms on caching/redistribution generally: this is knowable in outline from the code/spike for Co-Optimus specifically (a real, on-record negotiation), but for IGDB/Twitch/Steam/ITAD/Blizzard the actual terms-of-service language on redistribution was not independently re-verified in this pass — **verify with each provider's current terms** before extending the relay to cache and redistribute their data too, even though those four are individually self-serve and don't carry Co-Optimus's single-instance restriction today.

---

## Verdict

**Could someone install this today without asking the operator anything? Mostly yes, with one real blocker.** On the documented Docker/Portainer/Synology path (named volume, `docker run -v raid-ledger-data:/data ...`), a stranger gets a genuinely well-engineered first-run experience: random admin credentials printed with clear next steps, self-healing JWT secrets, fail-fast filesystem-permission diagnostics built from real deployer incidents, working health checks, an onboarding wizard, a self-generated Discord bot invite URL once they've created their own bot (a manual but self-contained Developer Portal detour), and every third-party integration except Co-Optimus is optional and gracefully degraded. The one thing that would actively burn a stranger is invisible until it's too late: **`render.yaml`'s disk-mount mismatch means anyone one-click-deploying to Render loses their database on the first redeploy**, which is exactly the deployment path ROK-1590 is aiming to make trivial — so that mismatch should be the first thing fixed before ROK-1590 ships, followed by the Co-Optimus UI warning (small, prevents a confusing 403) and, longer-term, standing up relay slice 1 so a second deployer never needs IGDB/Steam/ITAD keys at all. **Shortest path to "yes, unconditionally": fix the `render.yaml` mount path (1 line) + add the Co-Optimus permission-boundary warning (small copy change).**
