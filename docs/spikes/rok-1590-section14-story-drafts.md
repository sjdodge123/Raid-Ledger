> **Source:** `planning-artifacts/ROK-1590-section14-story-drafts.md` (gitignored local research, committed here so it is not lost; sensitive data redacted)
> **Date:** 2026-10-02
> **Linear:** ROK-1590 (these drafts are now filed as ROK-1697 to ROK-1709; Linear is authoritative)

# ROK-1590 §14 follow-up story drafts (#4–#16)

**What this is.** Ready-to-paste Linear drafts for the ROK-1590 spike's §14 follow-up stories #4–#16. **Nothing here is filed.** The operator files stories by hand (CLAUDE.md, `TECH-DEBT-BACKLOG.md` convention). Each draft has a title, labels, priority, size, Why, acceptance criteria, Tests, Dependencies and Operator-only steps.

**Provenance.**
- Written 2026-10-02 by a read-only story-draft lane (Opus) for the Lead.
- **Spike report:** `docs/spikes/rok-1590-one-click-deploy.md` (local, gitignored). Sections used: §1–§10, §12 (rulings), §13 (proof-deploy plan), §14 (story list), §16 (fact-check) and §17.9–§17.11 (relay failure modes, onboarding, merged order). "§" numbers below refer to that report.
- **Other inputs:**
  - `docs/spikes/rok-1590-investigation-2026-10-02.md`.
  - The ROK-1590 Linear description and all 4 comments: pass-1 summary; rulings C1–C12 ("yes to all"); the relay data model RM-1..RM-6; the cycle-23 re-verification.
  - The Epic ROK-1666 description: the relay work is now chunked as RH-* stories ROK-1667..1680.
- **Code anchors** were re-checked on `origin/main` f82d72ae4 (2026-10-02). Line numbers that drifted since the spike (15f3c7d8f) are corrected here.
- **Finalized** 2026-10-02 by a read-only finalizer lane: the Lead's corrections X1–X13 are applied, and their anchors were re-checked on f82d72ae4.

**Conventions.**
- **Linear fields:** team "Roknua's projects", project "Raid Ledger".
- **Labels:**
  - One **Area** label (exclusive; `memory/area-labels.md`) plus a type label (Feature / Bug / Improvement, as the spike and epic already use).
  - There is no Docs area, so docs-only work goes under CI/CD (deployment surface).
- **Title prefixes:** conventional-commit style with a scope, as the spike proposed (`feat(deploy):` …). §14 #16's `docs:` becomes `chore(docs):` because `docs:` isn't an allowed prefix.
- **Size:** the spike's S/M/L maps to small / medium / large; "trivial" uses CLAUDE.md's trivial-fix definition.
- **Priority:** a suggestion only. The sprint rule is fix → tech-debt → small → feature.
- **OPEN QUESTION** marks anything the spike or rulings leave undecided. Each one carries a recommendation, never a ruling.
- **Related links when filing:** #4, #7, #8, #10 and #16 link ROK-1476 as related. #4 links ROK-973. #7 links ROK-1420. #15 links ROK-1475. Appendix A links ROK-1408 (same nginx template).

**Read first: four cross-cutting facts.**
1. **Order.** §17.11's merged, dependency-ordered list supersedes §14's "Suggested order":
   - step 1: #9 and #3 (Appendix A). #1 and #2 have shipped, and R2 is relay work;
   - step 2: #4, #5, #6, #7;
   - step 5 (after the claim/wizard sheets and the revised Keys sheet): #8, #10;
   - step 6 (after the §13 proof deploys): #12, #13, #14;
   - step 7: #15, then #16 with R18.
2. **#12–#14 are blocked on the operator.** They depend on the §13 throwaway proof deploys (R-1..R-3, RW-1..RW-3, F-1..F-4), which need the operator's own Render, Railway and Fly accounts, a test guild and a fresh Discord app. Agents never create accounts or paste credentials.
3. **The relay R stories are being re-chunked under Epic ROK-1666.** Only M1 is filed (RH-1a..RH-7a, ROK-1667..ROK-1680, 14 PRs); M2–M6 have no stories yet, and the one-click integration is **M6**. RH-6 (ROK-1676, operator ruling 2026-09-24) hardcodes the hub as the operator's hub host and self-registers at boot with no code. It skips only when `relay_enabled=false`, `NODE_ENV=test` or `DEMO_MODE=true`. That covers part of R10, but not R10's after-the-claim ordering (see #8's OQ-8e). R10 (claim-gated part), R14, R15 and R18 have **no ROK id yet**.
4. **Already handled (not drafted):**
   - #1 shipped as ROK-1663 (#1339); #2 shipped as ROK-1665 (`api/src/main.helpers.ts:221-252`: `DEFAULT_TRUST_PROXY` `:221`, `resolveTrustProxy` `:230`, applied `:252`).
   - #11 is superseded by R15 + R14; #17 (split topology) stays deferred (D-2).
   - **#3 is still live on main** and is outside #4–#16. A draft is in Appendix A because the Lead's cycle-23 comment lists it with this batch.

---

## Table of contents

| § | # | Draft title | Area | Size | Priority | Hard dependencies | Operator-only? |
|---|---|---|---|---|---|---|---|
| [1](#4--platform-public-url-resolver) | 4 | feat(deploy): platform public-URL resolver for CORS, CLIENT_URL and the Discord callback | Infrastructure | medium (2 PRs) | Medium | none | confirm prod NAS env before PR B ships |
| [2](#5--moving-stable-image-tag) | 5 | chore(ci): publish a moving :stable image tag from releases | CI/CD | small | Medium | none (D-5 ruled) | next release cut |
| [3](#6--prod-only-node_modules) | 6 | chore(docker): ship prod-only node_modules in Dockerfile.allinone | CI/CD | medium | Medium | none (own infra PR) | no |
| [4](#7--cloud-runtime-flavour) | 7 | feat(deploy): cloud runtime flavour (RL_FLAVOUR=cloud) | Infrastructure | medium (2 PRs) | Medium | none (D-4 ruled) | no |
| [5](#8--claim-this-raid-ledger) | 8 | feat(onboarding): claim this Raid Ledger — setup code on first visit | Auth | large (≥2 lanes) | Medium | #7; approved claim sheet | no |
| [6](#9--invite-url-fallback) | 9 | fix(discord): invite URL falls back to the saved OAuth client id; correct two stale setup strings | Discord Bot | small | **High** | none | no |
| [7](#10--discord-setup-wizard) | 10 | feat(onboarding): guided Discord setup wizard | Admin | large (≥3 lanes) | Medium | #9; approved wizard sheet | OPERATOR plan steps (real Discord app) |
| [8](#11--superseded) | 11 | ~~optional integrations screen~~ (superseded by R15 + R14) | — | — | — | — | Keys sheet approval |
| [9](#12--render-blueprint--button) | 12 | feat(deploy): image-backed render.yaml Blueprint + Deploy to Render button | CI/CD | small | Medium | #4, #5, #7, #8, §13 R-2 | **yes** (Render account, R-2/R-3) |
| [10](#13--railway-template--button) | 13 | feat(deploy): Railway template + README button | CI/CD | small | Medium | #4, #5, #7, #8, §13 RW | **yes** (template lives in operator's Railway account) |
| [11](#14--flyio-launch-config) | 14 | feat(deploy): Fly.io launch config + launcher instructions | CI/CD | small | Medium | #4, #5, #7, #8, §13 F | **yes** (Fly account, F-1..F-4) |
| [12](#15--per-provider-update-card) | 15 | feat(admin): per-provider update card | Admin | small | Low | #4 | no |
| [13](#16--host-your-own-docs) | 16 | chore(docs): Host your own Raid Ledger — buttons, honest costs, sleep, backups, TLS | CI/CD | small | Low | #12–#14; R10 for the relay section | publish timing (R-9) |
| [A](#appendix-a--3-nginx-plineup-x-forwarded-proto) | 3 | fix(nginx): /p/lineup forwards X-Forwarded-Proto $scheme instead of $proxy_proto | Infrastructure | trivial lines, infra PR | Medium | none | no |
| [B](#open-questions-roll-up) | — | Open questions roll-up | | | | | |

---

## #4 — platform public-URL resolver

**Title:** `feat(deploy): platform public-URL resolver for CORS, CLIENT_URL and the Discord callback`
**Labels:** Area **Infrastructure** · Feature · **Priority:** Medium · **Size:** medium. Standard tier, shipped as two PRs because the shell part is infra.

**Why.**
- §4: three separate places derive the public URL, and only Render is detected: the shell block `Dockerfile.allinone:395-413` reads `RENDER_EXTERNAL_URL` only. Nothing in `api/src` reads the Railway, Fly, DO or Heroku variables. The default Discord callback is `http://localhost/api/auth/discord/callback` (`api/src/auth/discord.strategy.ts:14`).
- Every Deploy button (#12–#14), the claim log line (#8) and the update card (#15) need one deployer-controlled public URL. With a resolved URL, `CORS_ORIGIN=auto` stops being the PaaS default (ROK-973; §4, §14 #4).

**Scope (from §4).**
- Add `resolvePlatformPublicUrl(env): { url, source } | null` in `api/src/settings/client-url.helpers.ts`, next to the ROK-1627 trusted-anchor rule (`resolveSeedClientUrl`, `:63`). It reads deployer-controlled env only, never request headers.
- **PR A (code):** the resolver, the seeder anchor, the callback default, the boot log, and a compiled `dist/scripts/resolve-public-url.js` entry point for the shell.
- **PR B (infra, own PR):** `start-api.sh` in `Dockerfile.allinone:395-413` calls that script instead of reading `RENDER_EXTERNAL_URL` itself. Validate with the allinone build and health check.

**Acceptance criteria.**
- [ ] Precedence is exactly `PUBLIC_URL` → `RENDER_EXTERNAL_URL` → `RAILWAY_PUBLIC_DOMAIN` (`https://` + host) → `FLY_APP_NAME` (`https://<name>.fly.dev`) → DO `APP_URL` → Heroku `HEROKU_APP_DEFAULT_DOMAIN_NAME` (`https://` + host). It returns `null` when none is set. `source` names the variable used.
- [ ] Normalisation trims a trailing `/`. A value that isn't http(s) is not used: a warning is logged and resolution falls through to the next source.
- [ ] The function takes only an env object; nothing request-derived is passed to it.
- [ ] `ClientUrlSeederService` uses the resolver as its **lowest-trust** anchor. A saved `app_settings.client_url`, the origin of `discord_callback_url` and `DISCORD_CALLBACK_URL` each still win, in today's order.
- [ ] With no saved callback setting and no `DISCORD_CALLBACK_URL`, the default callback is `<url>/api/auth/discord/callback`. The localhost fallback applies only when the resolver returns `null`.
- [ ] Boot logs exactly one line: `public URL: <url> (from <SOURCE>)`, or `public URL: unresolved`.
- [ ] Allinone (PR B): with any platform variable set and `CORS_ORIGIN` unset or `auto`, `CORS_ORIGIN` becomes the resolved URL, not only for Render. An explicit `CORS_ORIGIN` still wins, and `CLIENT_URL` follows `CORS_ORIGIN` as today.
- [ ] A NAS with no platform variable and no `CORS_ORIGIN` behaves exactly as today (`auto`). No NAS regression.
- [ ] **Fleet envs keep working** (see OQ-4a). A fleet env spun after the change still signs in and loads on its `slot-N.gamernight.net` URL.

**Tests.**
- Unit (pure logic): a table-driven spec for `resolvePlatformPublicUrl` covering each source, normalisation and the precedence ties; extend the existing client-url helper spec for the seeder's anchor order.
- PR B (infra): the CLAUDE.md allinone check (build, run, `/api/health`), plus:
  - `docker run -e RAILWAY_PUBLIC_DOMAIN=example.up.railway.app …` shows the boot line, and a CORS preflight from that origin is allowed;
  - with no variable, `auto` is preserved.
- Gate: `--full` on PR B (Dockerfile).

**Dependencies.** None for PR A. PR B needs PR A's compiled script. Blocks #12, #13, #14 and #15. Update or close ROK-973 when this merges ("PaaS resolved by #4; NAS keeps `auto`"). Rebase on ROK-1366 if it merges first; both touch the `CLIENT_URL` anchor rules.

**Operator-only steps.**
- None to build. The real per-provider values are recorded by §13 check (g) during the operator's proof deploys.
- Before PR B ships in a release: confirm whether the prod NAS stack sets `PUBLIC_URL`, `APP_URL`, `RENDER_EXTERNAL_URL`, `RAILWAY_PUBLIC_DOMAIN`, `FLY_APP_NAME` or `HEROKU_APP_DEFAULT_DOMAIN_NAME`. Any of them would replace prod `CORS_ORIGIN=auto`.

**OPEN QUESTIONS.**
- **OQ-4a: the fleet sets `PUBLIC_URL` (precedence 1) to the per-slug host.** `rl-infra/orchestrator/bin/env-spin:752-777` passes `PUBLIC_URL`, `APP_URL` and `BASE_URL` as per-slug. It also passes an explicit `DISCORD_CALLBACK_URL` and `CLIENT_URL` for `https://${SLOT_HOST}` (`:776-777`), which outrank the resolver, so PR A changes nothing for fleet OAuth. Only PR B is exposed: env-spin passes no `CORS_ORIGIN`, so the new shell would set CORS to the per-slug host.
  - *Recommendation:* add `-e CORS_ORIGIN=https://${SLOT_HOST}` to env-spin's `PUBLIC_URL_FLAG` (`rl-infra/**` ride-along) with or before PR B, plus a PR B AC that a fleet env signs in on `slot-N`. Decide before PR B merges.
- **OQ-4b: ROK-973's fate.** *Recommendation:* close it for PaaS once #4 lands, and keep a NAS note ("`auto` acceptable behind the in-container nginx").

---

## #5 — moving :stable image tag

**Title:** `chore(ci): publish a moving :stable image tag from releases`
**Labels:** Area **CI/CD** · Improvement · **Priority:** Medium · **Size:** small (close to trivial: one workflow change plus a runbook paragraph).

**Why.**
- §3: today `ci.yml` publishes `:main` and `:<sha>`, and `docker-publish.yml:70-73` publishes `:X.Y.Z`, `:X.Y` and `:<sha>` on `v*` tags. There is no moving release tag.
- Templates must not track `:main`, because a stranger shouldn't get every merge. Ruled **C11 / D-5**: templates track a moving `:stable` cut from releases (§12, §14 #5).

**Acceptance criteria.**
- [ ] `docker-publish.yml` adds a `:stable` tag (e.g. `type=raw,value=stable` in the metadata step) on `v*` tag pushes, alongside the existing semver and sha tags.
- [ ] A pre-release tag does not move `:stable` (see OQ-5a).
- [ ] Re-publishing an older tag does not move `:stable` backwards (see OQ-5b).
- [ ] `docs/runbooks/releasing.md`'s "Two signals" table gains `:stable` ("what deploy templates track") next to `:main`.
- [ ] After the next `v*` release, an anonymous GHCR manifest check for `ghcr.io/sjdodge123/raid-ledger:stable` returns 200, with the same digest as that release's `:X.Y.Z`.

**Tests.** No app test: workflow config only, behaviour-neutral for the app. Verify with the manifest check above. Lint the workflow if `actionlint` is available.

**Dependencies.** None (D-5 ruled). Blocks #12, #13 and #14, whose templates reference `:stable`. The §13 proof deploys use `:main`, so they don't wait for it.

**Operator-only steps.** Cutting the next `v*` release (the releasing runbook only allows one when a `feat:` landed). `:stable` won't exist until then, so #12–#14 can't be checked against it before that release.

**OPEN QUESTIONS.**
- **OQ-5a: pre-release tags.** *Recommendation:* move `:stable` only for plain `vX.Y.Z` (no `-rc`/`-beta` suffix).
- **OQ-5b: re-publishing an old tag (a re-cut).** *Recommendation:* gate the tag on "this is the highest semver tag", so a re-cut of an old version can't move `:stable` backwards.

---

## #6 — prod-only node_modules

**Title:** `chore(docker): ship prod-only node_modules in Dockerfile.allinone`
**Labels:** Area **CI/CD** · Improvement · **Priority:** Medium · **Size:** medium. **Infra: its own PR**, with allinone validation and the `--full` gate.

**Why.**
- §3: a 998 MB `node_modules` layer is 62% of the 1.61 GB unpacked image. `Dockerfile.allinone:49` runs `npm ci` with dev dependencies, and `:174` copies the builder's whole `node_modules` (typescript, vite, @angular-devkit, playwright-core …).
- An api-only production install is the real size win, and it helps every flavour, the NAS included (§3, §14 #6).

**Acceptance criteria.**
- [ ] A prune stage (`npm ci --omit=dev` for the api workspace, or `npm prune --omit=dev`) produces production dependencies, and the runtime stage copies that tree instead of the builder's (`:174`).
- [ ] `@raid-ledger/contract` still resolves at runtime (`:175-176`).
- [ ] Everything that runs before NestJS still runs from the pruned tree: the migration runner, `bootstrap-admin`, the seed scripts, `re-encrypt-settings`, and #4's `resolve-public-url` if it has landed. None of them needs a dev dependency (ts-node, drizzle-kit, tsx …) at runtime.
- [ ] The PR body records before and after: compressed size, unpacked size, and the `node_modules` layer size from `docker history`.
- [ ] CLAUDE.md allinone validation passes: build, run, `/api/health` returns ok, and the migrations log is clean on a fresh `/data` **and** on an existing `/data` volume.
- [ ] The `container-startup` CI job is green.

**Tests.** No unit test (infra). Run the CLAUDE.md five-step allinone check and the `--full` local gate (Dockerfile change).

**Dependencies.** None. Must not be bundled with #7's infra PR or with any app-code change. Infra sequencing: `Dockerfile.allinone` changes (#4 PR B, #6, #7 PR B, #14 IPv6) and `monolith.conf.template` changes (#3, #7 PR B, #14 IPv6, ROK-1408) land one at a time. Each rebases onto the previous one, then reruns the allinone build, run and `/api/health` check. Never stack two unmerged infra PRs.

**Operator-only steps.** None. The operator's NAS picks it up on the next tagged release through Watchtower.

**OPEN QUESTIONS.**
- **OQ-6a: what runs at boot without its dev dependency?** *Recommendation:* the lane greps `docker-entrypoint.sh`, the supervisor programs and `start-api.sh` for `ts-node` / `npx` / `drizzle-kit` before pruning. CLAUDE.md says migrations use the programmatic migrator (ROK-1343), so drizzle-kit should not be needed.

---

## #7 — cloud runtime flavour

**Title:** `feat(deploy): cloud runtime flavour (RL_FLAVOUR=cloud)`
**Labels:** Area **Infrastructure** · Feature · **Priority:** Medium · **Size:** medium. Two PRs: app code, then infra.

**Why.**
- §3 and §9: a second image would save only the 5.1 MB glibc donor. The value of a cloud mode is behavioural:
  - refuse DEMO_MODE and ignore `FLEET_*`;
  - Co-Optimus hard-off (its terms are single-instance: ROK-1420, RM-5);
  - hide Ollama;
  - pin nginx workers;
  - guard against a PORT collision.
- Ruled **D-4**: a runtime flag on one image, with the dead glibc/Ollama donor stage removed for **every** flavour (§12, §14 #7).

**Scope.**
- **PR A (api + web + contract):**
  - an `isCloudFlavour()` helper;
  - the boot guards;
  - Co-Optimus off: nav, `cooptimus-settings.controller.ts`, and the weekly `@Cron(COOPTIMUS_SYNC_CRON)` at `cooptimus-sync.service.ts:78`;
  - Ollama card hidden and demo-data generator hidden;
  - every `FLEET_*` variable ignored: `FLEET_FIRST_DISCORD_LOGIN_ADMIN` and `FLEET_ADMIN_DISCORD_ID` (`api/src/auth/fleet-first-login-admin.helpers.ts:33-34`; `api/scripts/bootstrap-admin.ts:29-31` reads both too). This touches `api/src/auth/**`, so the PR is standard tier with the full gate;
  - flavour exposed to the web app.
- **PR B (infra, own PR):**
  - nginx `worker_processes` pinned to 1–2 under cloud;
  - the PORT collision guard: the API is pinned to `PORT=3000` (`Dockerfile.allinone:274`) while `:612-613` maps the platform's `$PORT` to nginx;
  - delete the glibc-donor stage (`:17-35`, `:102`) and the `/data/ollama/models` mkdirs (`:130`, `:494`).

**Acceptance criteria.**
- [ ] With `RL_FLAVOUR` unset or `nas`, behaviour is exactly today's (regression guard).
- [ ] `RL_FLAVOUR=cloud` + `DEMO_MODE=true`: the API refuses to boot, with a message naming both variables.
- [ ] Cloud: every `FLEET_*` variable the api or the bootstrap scripts read is ignored, with one warning naming them. Today these are `FLEET_FIRST_DISCORD_LOGIN_ADMIN` and `FLEET_ADMIN_DISCORD_ID` (`fleet-first-login-admin.helpers.ts:33-34`). The first Discord login does not become admin, and no fleet operator is bootstrapped.
- [ ] Cloud, even with a Co-Optimus UA configured:
  - no Co-Optimus nav entry;
  - its admin endpoints return 404;
  - the weekly sync does not run.
- [ ] Cloud: the Ollama card is hidden and no Ollama download is attempted.
- [ ] Cloud: the demo-data generator is hidden in admin. First verify what happens today with DEMO_MODE off; §9 marks it UNVERIFIED.
- [ ] `GET /system/status` exposes `flavour: 'nas' | 'cloud'` (contract change). #8 needs it for "claim on cloud only" (C6/D-3) and #15 for the update copy.
- [ ] An unknown `RL_FLAVOUR` value is handled per OQ-7b.
- [ ] PR B: under cloud, nginx runs 1–2 workers; the NAS keeps `auto`.
- [ ] PR B: a platform-injected `PORT=3000` no longer collides with the internal API port. The port is moved, or boot refuses with a clear message.
- [ ] PR B: the glibc-donor stage and the `/data/ollama/models` creation are gone, the image builds, and the size delta is recorded.
- [ ] PR B: allinone validation passes in **both** flavours.

**Tests.**
- Unit: the flavour helper and the boot guard (pure logic).
- Integration (Jest, real DB): Co-Optimus endpoints return 404 under cloud.
- Vitest: nav and card hiding.
- PR B: an allinone container run in both flavours.
- Gate: `--full` on PR A (contract) and on PR B (Dockerfile).

**Dependencies.** None hard; D-4 is ruled. #8 consumes the flavour flag, and #12–#14 set `RL_FLAVOUR=cloud` in their templates.

**Operator-only steps.** None.

**OPEN QUESTIONS.**
- **OQ-7a: glibc donor removal — RULED** (D-4, "yes to all" 2026-09-23): delete it for every flavour. Native Ollama has been dead in allinone since ROK-1036, so the NAS loses nothing.
- **OQ-7b: unknown `RL_FLAVOUR` value.** *Recommendation:* fail fast at boot rather than silently falling back to `nas`.
- **OQ-7c: `TRUST_PROXY` on a PaaS.** ROK-1665 shipped `TRUST_PROXY` with the default `loopback, linklocal, uniquelocal` (`main.helpers.ts:221`). Whether each PaaS edge's address falls in those ranges is unverified. If it doesn't, per-IP rate limits (which #8's claim relies on) collapse onto the edge again.
  - *Recommendation:* add "log `req.ip` for a known client" to §13's per-provider checks, then have cloud mode or each template set `TRUST_PROXY` to match.

---

## #8 — claim this Raid Ledger

**Title:** `feat(onboarding): claim this Raid Ledger — setup code on first visit`
**Labels:** Area **Auth** (it sets the admin password and issues a session; the wizard side is Admin) · Feature · **Priority:** Medium, rising to High when the buttons are next · **Size:** large. Split into at least two ~25-turn lanes: API and bootstrap, then web. Standard tier, contract change, `--full` gate.

**Why.**
- §5: a stranger's first visit shows a bare login form, and the only admin password is printed to stdout once by `api/scripts/bootstrap-admin.ts`. `isFirstRun` (`system.controller.ts`) is never true on allinone. A PaaS URL is guessable, so "first visitor wins" would hand the instance to a stranger.
- Ruled: **C4 / C5** (one screen, code plus new password, the fixed `admin@local`); **C6 / D-3** (claim on cloud only; the NAS keeps the stdout banner); and §17.10's one-line relay disclosure (§12, §14 #8).

**Acceptance criteria: API and bootstrap.**
- [ ] **Code source:**
  - `SETUP_CODE` from the env is accepted verbatim (a platform's generated value).
  - If it is unset, bootstrap generates a code of at least 80 bits, displayed as `XXXX-XXXX-XXXX-XXXX` (base32), and logs it with the `/claim` path. Once #4 has landed, the log shows the full URL.
- [ ] **Storage:** only a hash is stored, in `app_settings` (`claim_code_hash`, `claim_expires_at`, `claimed_at`), and it is compared with `timingSafeEqual`. The plaintext code is never persisted and never returned by any endpoint.
- [ ] Cloud bootstrap creates `admin@local` with an **unprinted** random password. The NAS (non-cloud) keeps today's stdout banner, byte for byte.
- [ ] **Endpoint:** public `POST /setup/claim {code, newPassword}`.
  - A valid code sets the `admin@local` password, records `claimed_at` and returns a session.
  - A consumed code never works again, even if the `SETUP_CODE` env value is unchanged.
- [ ] **Expiry:** 72 h from first boot, after which the endpoint returns **410** with "restart the service for a new code". An expired, unclaimed instance re-arms on boot (see OQ-8a for env-provided codes).
- [ ] **Rate limiting:**
  - `@RateLimit('auth')` (as on `auth.controller.ts:48`), plus a global soft lock: 100 failures per hour locks claims for 15 min.
  - The code is **never** burned after N failures.
- [ ] Cloud: a claim is refused unless the forwarded protocol is `https`.
- [ ] **Status:** `GET /system/status` (`api/src/system/system.controller.ts:106`) gains `claimRequired: boolean`, never the code (contract change).
- [ ] Any new failure path in `bootstrap-admin.ts` follows the CLAUDE.md boot-script Sentry rule: capture, flush, then exit.
- [ ] `RESET_PASSWORD=true` remains the recovery path.
- [ ] Onboarding: on cloud, the claim replaces the "Secure Account" step (`onboarding.controller.ts:105` hard-codes `secureAccount: false`; `secure-account-step.tsx`). NAS behaviour follows OQ-8b.
- [ ] A successful claim emits a hook or event that relay enrollment (§17.11 R10) can subscribe to later. #8 itself does not enroll.

**Acceptance criteria: web.**
- [ ] While `claimRequired` is true, every route redirects to `/claim`; the exceptions are `/claim` itself and static assets.
- [ ] `/claim` is one screen matching the approved claim sheet (C4): setup code, new password and confirm. It shows distinct errors for a wrong code, an expired code (410) and a soft lock. On success the admin lands signed in at the wizard.
- [ ] The relay disclosure line ("Game data comes from the Raid Ledger relay. What's shared →") appears per OQ-8c.
- [ ] Both `default-dark` and `default-light` work, on phone and desktop.

**Tests.**
- Unit: code generation, hashing and expiry arithmetic.
- Integration (Jest, real DB), the `/setup/claim` matrix:
  - valid → session;
  - wrong code → 4xx;
  - consumed code → rejected;
  - expired → 410;
  - soft lock;
  - non-https refused under cloud;
  - `claimRequired` flips after a claim.
- Bootstrap spec: cloud versus NAS output.
- Playwright smoke (desktop **and** mobile): an unclaimed instance redirects to `/claim`, and a successful claim lands on the wizard. This needs a fixture that puts the instance into the unclaimed state (OQ-8d).
- Fleet test plan, run by a `fleet-ui-verify` lane.

**Dependencies.**
- **Hard:** #7 (the flavour flag).
- **Design:** the claim sheet is approved (D-7, C4/C5). Prototype: a private claude.ai prototype (link withheld). Mirror the approved target into `planning-artifacts/specs/ROK-XXXX.md` and the Linear body once filed.
- **Soft:** #4 (full URL in the log line).
- **Already satisfied:** ROK-1665 (per-IP limits).
- **Downstream:** §17.11 R10 (enrollment on claim) and #10's step 1.
- **Order:** §17.11 step 5.

**Operator-only steps.** None to build. Seeing where each provider shows the generated `SETUP_CODE` (Render's env tab, Railway's variables, Fly secrets) is part of the §13 proof deploys on the operator's accounts.

**OPEN QUESTIONS.**
- **OQ-8a: env-provided code after expiry.** §5 says an expired instance "regenerates and logs a fresh code on boot", but when `SETUP_CODE` comes from the platform, regenerating would ignore the value the deployer can see. *Recommendation:* a restart re-arms a fresh 72 h window for the **same** env code, unless it was consumed. A logged code (no env) is regenerated.
- **OQ-8b: the NAS "Secure Account" step.** *Recommendation:* the NAS keeps it, since D-3 keeps the NAS path unchanged. Cloud skips it because the claim already set the password.
- **OQ-8c: the disclosure line before the relay exists.** Neither the R14 relay block nor any default-on flag exists, and `relayHubEnabled` (`/system/version`, `version.controller.ts:37`) is not a proxy after RH-6.
  - *Recommendation:* #8 renders the line only when a boolean that R10 adds is true; until R10 lands, the line is not shown. Its link targets #16's privacy section (R18). This gives the line one owner, since §14 #8 and R10 both list it.
- **OQ-8d: the Playwright fixture.** *Recommendation:* add a DEMO_MODE `/admin/test/*` endpoint that resets the claim state. It stays behind the JWT and admin guards, per the existing fixture pattern.
- **OQ-8e: RH-6 enrolls before the claim.** ROK-1676 self-registers at boot unless `relay_enabled=false`, `NODE_ENV=test` or `DEMO_MODE=true`, so a cloud instance registers while `claimRequired` is true.
  - *Recommendation:* R10 (not #8) gates RH-6's boot registration on `claimRequired===false` under `RL_FLAVOUR=cloud` and subscribes to #8's claim hook. #8's scope is unchanged. The operator confirms the ordering.

---

## #9 — invite URL fallback

**Title:** `fix(discord): invite URL falls back to the saved OAuth client id; correct two stale setup strings`
**Labels:** Area **Discord Bot** · Bug · **Priority:** **High**. It is a fix, it hits every new install's setup today, and §17.11 puts it in step 1.
**Size:** small. The spike calls it trivial tier, but it touches three source files (invite controller, panel copy, bot-service copy), so under CLAUDE.md's single-file rule it is `standard` tier, shipped as one small PR. Splitting it would not make the copy half trivial either, because that half spans two files.

**Why.**
- §6 and the INV: `getClientId()` (`api/src/discord-bot/discord-bot-client.service.ts:176`) is null until the gateway is ready. So `discord-bot-invite.controller.ts:33` returns `url: null` before the bot has connected, which means the invite link only appears after the bot is already in a server.
- Two setup strings are stale:
  - `web/src/components/admin/discord-bot-invite-panel.tsx:19` says the invite appears "once the Discord application client ID is saved on this page";
  - `api/src/discord-bot/discord-bot.service.ts:213` tells users to use "the OAuth2 URL Generator in the Developer Portal".

**Acceptance criteria.**
- [ ] When the bot client isn't ready, the invite endpoint builds the URL from the **saved Discord OAuth client ID** (the same application), with the same permission set and scopes as the ready path (the ROK-1471 invite builder in `discord-bot-client.helpers.ts`).
- [ ] When neither ID is available, the endpoint still returns `url: null`, and the panel explains what to save.
- [ ] When both exist and differ, the ready client's ID wins and a warning is logged (OQ-9a).
- [ ] The panel copy matches the new behaviour: the invite appears once the OAuth client ID or bot token is saved.
- [ ] The token-valid message points to the in-app invite link, not the Developer Portal's URL Generator.
- [ ] No 15+ digit literal is added. `discord-bot-permissions-literal.guard.spec.ts` scans the bot, admin-UI, contract and README sources.

**Tests.**
- Unit, in the controller/service spec:
  - bot not ready + saved client ID → a URL with the expected `client_id` and permissions;
  - neither ID → `null`;
  - both IDs → the ready client's.
- The copy changes are behaviour-neutral; update any text assertions.
- `api/src/discord-bot/**` is on the Discord smoke-trigger list, so the companion-bot smoke runs in CI, and locally per CLAUDE.md if the lane touches bot behaviour.

**Dependencies.** None. Blocks #10 (the wizard's invite step needs the URL before the bot is ready).

**Operator-only steps.** None.

**OPEN QUESTIONS.**
- **OQ-9a: mismatched IDs (two different Discord apps).** *Recommendation:* the ready client's ID wins and a warning is logged. Treat it as a misconfiguration and don't block.

---

## #10 — Discord setup wizard

**Title:** `feat(onboarding): guided Discord setup wizard`
**Labels:** Area **Admin** · Feature · **Priority:** Medium · **Size:** large. Plan sequential ~25-turn lanes: (1) the wizard shell and step 3; (2) the invite, wait-for-join and permission-check step; (3) the default-channel step and Plugins-stub removal. Standard tier, design-gated.

**Why.**
- §6: setting up the Discord application is the dominant friction (10–15 min est.) and no deploy button can automate it.
- Today's wizard (`web/src/pages/admin/admin-setup-wizard.tsx`) has no Discord step, and its Plugins card is a client-only stub that saves nothing (`connect-plugins-step.tsx:57`, `stubEnabled`).
- Ruled **C7** (7 steps; "finish later" once the bot has joined), **C8** (intents checklist plus detect-on-connect) and **C9** (default channel after "bot joined") (§12, §14 #10).

**Acceptance criteria.**
- [ ] Steps 3–5 (Discord application, Invite your bot, Default channel) sit between Community and Done, and the Plugins stub is removed. The wizard runs Claim or Secure Account → Community → Discord application → Invite → Default channel → Done until R15 inserts Game data as step 6, which makes the 7 steps of C7.
- [ ] **Step 3:**
  - read-only redirect URLs `<origin>/api/auth/discord/callback` and `<origin>/api/auth/discord/link/callback` with copy buttons (reuse `DiscordOAuthForm`);
  - Application ID, Client Secret and Bot Token, each live-validated with a ✓ (reuse the existing OAuth and bot-token validators);
  - an intents checklist (Presence, Server Members, Message Content) with a Developer Portal link.
- [ ] **C8:** on connect, a disallowed-intent failure shows actionable text naming the missing intent or intents.
- [ ] **Step 4:**
  - the invite URL and permission list, available before the bot is ready (#9);
  - "Waiting for your bot…" polls bot status until `connected && guildName`, then runs the permission check automatically;
  - a warning when the bot is in more than one server.
- [ ] **Step 5:** a default channel picker that saves to the existing default-channel setting (C9).
- [ ] "Finish later" appears once the bot has joined (C7). Progress comes from the server-side `SETUP_STEP_DEFS` (`api/src/discord-bot/discord-bot.service.ts:229`), so leaving and coming back resumes at the right step.
- [ ] The Plugins stub step and its test are deleted.
- [ ] It uses primitives from `docs/design-system.md`'s inventory, with no hard-coded colours, and is verified in `default-dark` **and** `default-light`, on phone and desktop. Any new pattern gets a `New pattern:` line in the PR.

**Tests.**
- Vitest component tests per step: validation states, and the polling hook with fake timers (no `sleep`).
- Playwright smoke (desktop **and** mobile): wizard navigation, with the Discord validation endpoints mocked or fixtured (OQ-10a).
- Fleet test plan, run by `fleet-ui-verify`. The live bot-join and intents steps are marked **OPERATOR**, because they need a real Discord application and a test guild.

**Dependencies.**
- **Hard:** #9.
- **Design:** the wizard sheet is approved (D-7, C7–C9).
- **Soft:** #8 for step 1 on cloud. The wizard can ship on the NAS path first.
- **Later:** R15 inserts step 6 (Game data), and §17.11 step 5 orders #8, R10, #10, R14, R15.

**Operator-only steps.** The fleet-plan steps needing a real Discord app or test guild. Possibly confirming the Developer Portal deep-link format (OQ-10b). Deciding the Done-screen copy (OQ-10c).

**OPEN QUESTIONS.**
- **OQ-10a: Discord calls in CI.** *Recommendation:* MSW handlers for the validate endpoints in vitest and a fixture backend in Playwright. Live Discord stays an OPERATOR plan step.
- **OQ-10b: the portal deep-link format** (§6, UNVERIFIED). *Recommendation:* link to the application's Bot page if a lane verifies the URL shape, otherwise to the portal root.
- **OQ-10c: step 6 and the Done screen.** Step 6 ships with R15, and #10 adds no placeholder. The approved sheet's Done-screen copy ("Sign in with Discord to link your admin", a backups note, an update note; §6 screen 7) belongs to no story.
  - *Recommendation:* the operator either adds it to #10 explicitly or leaves the existing `DoneStep` as is.
- **OQ-10d: whether a disallowed-intent error reaches `friendlyDiscordErrorMessage` with usable text** (§6, UNVERIFIED). *Recommendation:* lane 1 checks this first with a fixture error.

---

## #11 — superseded

**Not drafted.** §14 marks #11 (`feat(onboarding): optional integrations screen with explicit degraded state`) as **superseded** by §17.11:
- **R15** `feat(onboarding): "Game data" step`, the §17.10 screen;
- **R14** `feat(ui): relay status card + degraded states`.

Both wait on the **revised Keys / KeysLight sheet**. §17.10 reopened D-7 for it, and the INV records no operator approval after the 2026-09-23 18:47 comment. File R14 and R15 under Epic ROK-1666 once that sheet is approved.

---

## #12 — Render Blueprint + button

**Title:** `feat(deploy): image-backed render.yaml Blueprint + Deploy to Render button`
**Labels:** Area **CI/CD** · Feature · **Priority:** Medium (launch-gated) · **Size:** small.

**Why.**
- Render is the default provider (**C1 / D-1**; §0, §1).
- `render.yaml` on main still has four problems (§3, §9):
  - it builds from source (`runtime: docker`, `dockerfilePath`, lines 4–5);
  - it uses `plan: starter` (512 MB) against a measured 557 MB boot peak, and C3 drops Starter (line 6);
  - it uses the deprecated `healthCheckPath: /api/health` (line 7; `app.controller.ts:37`);
  - it has a 1 GB disk (line 11).

**Acceptance criteria.**
- [ ] `render.yaml` uses:
  - `runtime: image` with `image.url: ghcr.io/sjdodge123/raid-ledger:stable`;
  - `plan: standard`;
  - a disk at `/data` of 5–10 GB (OQ-12b);
  - `healthCheckPath: /api/health/ready`;
  - a single instance with no autoscaling.
- [ ] `envVars`: `JWT_SECRET` and `SETUP_CODE` with `generateValue: true`, plus `RL_FLAVOUR=cloud`. **No** field the deployer must fill in, and no `DEMO_MODE`, `FLEET_*` or `ADMIN_PASSWORD`.
- [ ] The README has a "Deploy to Render" button for this repo's Blueprint. It follows OQ-12a's answer about the operator's existing Render staging service.
- [ ] A deploy from the button on a throwaway branch reaches `/claim` (§13 R-2), with T0–T5 and checks a–h recorded in the spike's results appendix (R-3).
- [ ] The update path ("Deploy latest reference" or a deploy hook with `imgURL`) is handed to #15 and #16.

**Tests.** None in CI (provider config). Verification is the operator's §13 R-2 and R-3 run.

**Dependencies.**
- #4: the callback and CLIENT_URL derive from `RENDER_EXTERNAL_URL`.
- #5: `:stable` must exist, which takes the first release after #5.
- #7: `RL_FLAVOUR`.
- #8: `SETUP_CODE` is consumed by the claim.
- §13 R-2: whether the button honours `runtime: image` is UNVERIFIED (§16 #3, §11 risk 1).
- **R-9:** this can merge as a beta. The public announcement waits for relay R5, R6, R9 and R10.
- Deviation from §14's dependency column, intended: #7 is added because the template must set `RL_FLAVOUR=cloud`; otherwise the instance runs NAS mode (stdout banner, no claim) and C6/D-3 is lost.

**Operator-only steps.**
- A Render account; running the button from a throwaway branch with a test guild and a fresh Discord app (§13 R-2, R-3); deleting the service and disk afterwards.
- Deciding OQ-12a.

**OPEN QUESTIONS.**
- **OQ-12a: the existing Render staging service** (memory: Render is staging). If that service is synced to `render.yaml` as a Blueprint, this change moves it to `plan: standard` (from $7 to $25+/mo) and to the image runtime. *Recommendation:* the operator confirms how staging is linked before merge. If it is Blueprint-synced, keep a separate blueprint for the button; whether the button can target a non-root blueprint path is UNVERIFIED, so test it in R-2.
- **OQ-12b: disk size.** *Recommendation:* 5 GB by default ($1.25/mo), with the docs explaining how to grow it.
- **OQ-12c: if the button ignores `runtime: image`** (§11 risk 1). *Recommendation:* the button keeps a source build until Render supports images, and the image Blueprint stays documented for "New Blueprint" users.

---

## #13 — Railway template + button

**Title:** `feat(deploy): Railway template + README button`
**Labels:** Area **CI/CD** · Feature · **Priority:** Medium · **Size:** small in the repo; most of the work is the operator's, in Railway's UI.

**Why.**
- §1: a Railway template is built in Railway's UI, not as a repo file. Railway is the middle option (about $6–12/mo est.; §0, §10).
- Ruled **C2 / D-6**: the template is published from the operator's account on `:stable`, with a sync step in `/releasing`. §11 risk 4 is template drift.

**Acceptance criteria.**
- [ ] The template (built by the operator) has:
  - a service from `ghcr.io/sjdodge123/raid-ledger:stable`;
  - one volume at `/data`;
  - `JWT_SECRET=${{secret(64)}}` and `SETUP_CODE=${{secret(24, "ABCDEFGHJKMNPQRSTVWXYZ23456789")}}`;
  - `RL_FLAVOUR=cloud`;
  - healthcheck `/api/health/ready`;
  - one replica, sleep off (OQ-13c);
  - a public domain.
- [ ] The README has a "Deploy on Railway" button linking the published template.
- [ ] `docs/runbooks/releasing.md` (and the `/releasing` skill, if it exists then) gains a "Railway template sync" step, with a named owner: after each release, check that the template's image tag, variables and volume still match.
- [ ] The stranger's path is timed from a logged-out browser (§13 RW-2). The docs say whether the domain is generated automatically or which click creates it.

**Tests.** None in CI. Verification is the operator's §13 RW-1 to RW-3 run (checks a–h, plus the 24 h usage meter).

**Dependencies.** #4 (`RAILWAY_PUBLIC_DOMAIN` → URL), #5, #7, #8, D-6 (ruled) and §13 RW. R-9 as for #12. Deviation from §14's dependency column, intended: #7 is added because the template must set `RL_FLAVOUR=cloud`; otherwise the instance runs NAS mode (stdout banner, no claim) and C6/D-3 is lost.

**Operator-only steps.** All of the following are operator-only:
- a Railway account;
- building and publishing the template from the operator's account (C2);
- running RW-1 to RW-3 and reading the usage meter after 24 h;
- deleting the throwaway project.

**OPEN QUESTIONS.**
- **OQ-13a: domain auto-generation** (§16 #8, UNVERIFIABLE from the docs). Settled by RW-2.
- **OQ-13b: drift visibility.** *Recommendation (not in the spike):* commit a text mirror of the template's settings, e.g. `docs/deploy/railway-template.md`, so drift shows up in PR review.
- **OQ-13c: sleep and auto-redeploy defaults** (UNVERIFIED). *Recommendation:* pin sleep off in the template. RW-3 records whether Railway redeploys on a new image.

---

## #14 — Fly.io launch config

**Title:** `feat(deploy): Fly.io launch config + launcher instructions`
**Labels:** Area **CI/CD** · Feature · **Priority:** Medium · **Size:** small.

**Why.**
- §1: Fly has no web button, only `fly launch --from <repo>` or `--image`. It is the budget option, about $6.45–11.45/mo (C1, §10).
- It needs three things the other providers don't (§1, §9):
  - `internal_port` in `fly.toml`, because Fly injects no `PORT`;
  - `auto_stop_machines` pinned off, or the bot's gateway connection drops;
  - a check of the IPv4-only nginx listen (`nginx/monolith.conf.template:32`).

**Acceptance criteria.**
- [ ] `fly.toml` at the repo root (none exists on main) contains:
  - `[build] image = "ghcr.io/sjdodge123/raid-ledger:stable"`;
  - `[http_service] internal_port = 80`, `force_https = true`, `auto_stop_machines = "off"`, `min_machines_running = 1`;
  - `[mounts] source = "data"`, `destination = "/data"`;
  - a check on `/api/health/ready`;
  - `RL_FLAVOUR=cloud`;
  - a VM size per OQ-14b.
- [ ] Copy-paste launcher docs cover:
  - `fly launch --from <repo URL> --copy-config` (the F-4 path), or the `--image` flow;
  - `fly volumes create data --size 5`;
  - `fly secrets set JWT_SECRET=… SETUP_CODE=…`, generated locally per OQ-14a;
  - `fly deploy`;
  - updating with `fly deploy --image …:stable`.
- [ ] `FLY_APP_NAME` resolves to `https://<app>.fly.dev` through #4.
- [ ] If §13 F-3 finds the IPv4-only listen unreachable through Fly's proxy, a `listen [::]:${NGINX_PORT}` fix ships as its **own** infra PR with allinone validation, not bundled here.
- [ ] The docs warn that the volume lives on one host: keep off-site dumps, and snapshots are kept 5 days by default (§8, §11 risk 3).

**Tests.** None in CI for `fly.toml`. The IPv6 fix, if needed, gets allinone validation. Verification is the operator's §13 F-1 to F-4 run.

**Dependencies.** #4, #5, #7, #8 and §13 F. R-9 as for #12. Deviation from §14's dependency column, intended: #7 is added because the template must set `RL_FLAVOUR=cloud`; otherwise the instance runs NAS mode (stdout banner, no claim) and C6/D-3 is lost. #8 is added because the launcher sets `SETUP_CODE` (§5, §13 F-1).

**Operator-only steps.** A Fly account and `flyctl` auth; running F-1 to F-4; setting secrets; deleting the app and volume afterwards.

**OPEN QUESTIONS.**
- **OQ-14a: secret generation.** Fly has no generator; its absence is UNVERIFIED. *Recommendation:* the docs show local generation (`openssl rand`), and the shell history caveat is noted.
- **OQ-14b: 1 GB or 2 GB by default** (F-2). *Recommendation:* 1 GB unless F-2 fails a check.

---

## #15 — per-provider update card

**Title:** `feat(admin): per-provider update card`
**Labels:** Area **Admin** · Feature · **Priority:** Low · **Size:** small. Contract change, `--full` gate.

**Why.**
- §8: `UpdateBanner` (`web/src/components/admin/UpdateBanner.tsx`, ROK-1475) says *that* an update exists, not *how* to apply it. Render image services don't auto-redeploy (§16 #4), and Railway and Fly each differ.
- Ruled **C12**: the banner becomes a per-provider update card.
- §17.9: a relay 426 shows "Update to keep receiving game data".

**Acceptance criteria.**
- [ ] The provider comes from #4's resolver `source` (Render, Railway, Fly, else NAS/self-hosted) and is exposed through the system status or version API (contract).
- [ ] The card shows the current and latest version and the release-notes link (`latestReleaseUrl`), plus the provider's steps:
  - Render: "Deploy latest reference" or a deploy hook;
  - Railway: redeploy;
  - Fly: `fly deploy --image …:stable`;
  - NAS: `docker compose pull && docker compose up -d`, or Watchtower.
- [ ] The existing per-version dismiss (sessionStorage) is kept, and ROK-1475's build-level "fixes available" signal is not regressed.
- [ ] The relay 426 state renders "Update to keep receiving game data" once the ROK-1666 relay client reports schema-too-old. Until then the state is wired but never shown.
- [ ] It matches the approved update sheet (C12) in `default-dark` and `default-light`.

**Tests.**
- Vitest component tests per provider, plus the 426 state.
- A changed rendered flow normally needs a Playwright smoke (CLAUDE.md), but "update available" depends on GitHub's releases API (`api/src/version/release-check.ts:7`); see OQ-15a.
- Fleet test plan for the look.

**Dependencies.** **Hard:** #4. **Soft:** the 426 copy waits on the ROK-1666 relay client. §17.11 step 7.

**Operator-only steps.** None.

**OPEN QUESTIONS.**
- **OQ-15a: forcing "update available" in Playwright.** *Recommendation:* a DEMO_MODE fixture or env override for the latest version. Without one, ship vitest plus the fleet plan and record why there is no Playwright spec.
- **OQ-15b: the Railway and Fly update copy depends on §13** (RW-3 auto-redeploy, Fly `deploy --image`). *Recommendation:* write the copy after the proof deploys.

---

## #16 — Host-your-own docs

**Title:** `chore(docs): Host your own Raid Ledger — buttons, honest costs, sleep, backups, TLS`
**Labels:** Area **CI/CD** (there is no Docs area) · Improvement · **Priority:** Low · **Size:** small.

**Why.**
- The ROK-1590 frictionless target #6 asks for honest cost and limits on a public page. §10 holds the date-stamped cost table, and §8 holds the backup and update facts.
- §14 #16 also absorbs **R18**: the relay privacy note (§17.7), the per-provider own-key table (§7), attribution and opt-outs.

**Acceptance criteria.**
- [ ] A new page (path per OQ-16a) plus a README "Host your own" section with the Render button, the Railway button and the Fly launcher, linking to the page.
- [ ] The §10 cost table, date-stamped:
  - no Render Starter row (C3);
  - "no free tier runs it";
  - egress excluded;
  - Fly's regional markup noted;
  - every price claim linked to its source and date.
- [ ] Sleep and idle behaviour per provider. Fly's `auto_stop_machines` must stay off.
- [ ] Backups:
  - the in-app daily `pg_dump` sits on the same disk and is not off-site;
  - how to download one from Admin → Backups;
  - the provider snapshot policies;
  - off-site copies are the deployer's job;
  - a link to the restore drill.
- [ ] A custom domain needs `PUBLIC_URL` (#4), and TLS terminates at the edge.
- [ ] Where to find logs per provider. A stranger has no Sentry DSN, so a failed migration is only a crash loop (§8).
- [ ] Update steps per provider, consistent with #15.
- [ ] What Discord setup involves: the wizard, about 10–15 min.
- [ ] The relay section (R18): what an instance sends (§17.7), opt-outs, attribution, and the own-key-per-provider table (§7).
- [ ] No 15+ digit literal in the README (`discord-bot-permissions-literal.guard.spec.ts` scans `README.md`).

**Tests.** Docs only, so behaviour-neutral and no new test. The README guard spec must stay green; memory says to grep for README contract tests before rewriting.

**Dependencies.** #12, #13 and #14, because the button and launcher URLs must exist. §17.11 R10 for the relay section. R-9: the public announcement waits for R5, R6, R9 and R10. §17.11 step 7, together with R18.

**Operator-only steps.** Deciding when the page goes public (R-9 launch gate). Agents can re-check prices at publication time.

**OPEN QUESTIONS.**
- **OQ-16a: page location.** *Recommendation:* `docs/host-your-own.md` plus a README section. No such file exists on main.
- **OQ-16b: publish before the relay ships?** *Recommendation:* merge the provider sections as a beta with #12–#14, and add the relay/privacy section with R10/R18. Hold any public announcement until R-9 is met.

---

## Appendix A — #3 nginx /p/lineup X-Forwarded-Proto

Outside #4–#16, but still live on main and listed in the Lead's cycle-23 operator ask.

**Title:** `fix(nginx): /p/lineup forwards X-Forwarded-Proto $scheme instead of $proxy_proto`
**Labels:** Area **Infrastructure** · Bug · **Priority:** Medium · **Size:** a one-line change. Infra, so it gets **its own PR**, allinone validation and the `--full` gate.

**Why.**
- §9 and the INV: `nginx/monolith.conf.template:124` sends `X-Forwarded-Proto $scheme`, while `:77` and `:91` send `$proxy_proto`. Behind a PaaS's TLS edge, the API therefore sees `http` on `/p/lineup`.
- The API reads that header in `request-origin.helpers.ts:15` and `api/src/plugins/discord/discord-auth.helpers.ts:102`.

**Acceptance criteria.**
- [ ] `:124` uses `$proxy_proto`, as `:77` and `:91` do.
- [ ] Allinone validation: build and run. A request to a `/p/lineup/...` URL with `X-Forwarded-Proto: https` reaches the API as https (e.g. the generated absolute URLs are `https://`). `/api/health` returns ok.
- [ ] The implementer checks whether `nginx/default.conf:68,101` (`$scheme`, the separate non-allinone topology) needs the same change, and states the conclusion in the PR. That file serves a different topology, so it is out of scope unless the same bug applies.

**Tests.** Infra: the allinone container curl above. No unit test.
**Dependencies.** None. Infra sequencing: `Dockerfile.allinone` changes (#4 PR B, #6, #7 PR B, #14 IPv6) and `monolith.conf.template` changes (#3, #7 PR B, #14 IPv6, ROK-1408) land one at a time. Each rebases onto the previous one, then reruns the allinone build, run and `/api/health` check. Never stack two unmerged infra PRs. **Operator-only:** none.

---

## Open questions roll-up

| ID | Story | Question | Recommendation |
|---|---|---|---|
| OQ-4a | #4 | The fleet passes per-slug `PUBLIC_URL`, `APP_URL` and `BASE_URL` (`env-spin:752-777`), but its explicit slot-host `DISCORD_CALLBACK_URL` and `CLIENT_URL` (`:776-777`) outrank the resolver, so PR A is safe. PR B would set fleet CORS to the per-slug host, because env-spin passes no `CORS_ORIGIN`. | Add `-e CORS_ORIGIN=https://${SLOT_HOST}` to env-spin's `PUBLIC_URL_FLAG` (`rl-infra/**` ride-along) with or before PR B, plus a PR B AC that a fleet env signs in on `slot-N`. Decide before PR B merges. |
| OQ-4b | #4 | ROK-973's fate | Close it for PaaS when #4 lands; keep a NAS note. |
| OQ-5a | #5 | Do pre-release tags move `:stable`? | No, only plain `vX.Y.Z`. |
| OQ-5b | #5 | Can an old-tag re-cut move `:stable` back? | Gate it on "highest semver". |
| OQ-6a | #6 | Does anything at boot need a dev dependency? | Grep the entrypoint and supervisor for ts-node, npx and drizzle-kit before pruning. |
| OQ-7a | #7 | Delete the glibc donor for every flavour? | Ruled (D-4): yes, every flavour. |
| OQ-7b | #7 | Unknown `RL_FLAVOUR` value | Fail fast at boot. |
| OQ-7c | #7, #12–#14 | Is each PaaS edge inside the default `TRUST_PROXY` ranges? | Add a `req.ip` check to §13, then set `TRUST_PROXY` per template or in cloud mode. |
| OQ-8a | #8 | Env-provided `SETUP_CODE` after the 72 h expiry | A restart re-arms the same env code unless it was consumed. A logged code is regenerated. |
| OQ-8b | #8 | Does the NAS keep the Secure Account step? | Yes (D-3). Cloud skips it. |
| OQ-8c | #8 | Show the relay disclosure line before R10? No relay block or default-on flag exists, and `relayHubEnabled` is no proxy after RH-6. | Render it only when a boolean R10 adds is true; hidden until R10 lands. Link to #16's privacy section (R18). |
| OQ-8d | #8 | Playwright fixture for the unclaimed state | A DEMO_MODE `/admin/test/*` reset endpoint. |
| OQ-8e | #8, R10 | RH-6 (ROK-1676) self-registers at boot, so a cloud instance enrolls while `claimRequired` is true | R10 (not #8) gates RH-6's boot registration on `claimRequired===false` under cloud and subscribes to #8's claim hook. The operator confirms the ordering. |
| OQ-9a | #9 | The OAuth client ID and the ready bot's ID differ | The ready client wins, and a warning is logged. |
| OQ-10a | #10 | Discord validation in CI | MSW and fixtures; live Discord is an OPERATOR plan step. |
| OQ-10b | #10 | Portal deep-link format (UNVERIFIED) | Link to the Bot page if verified, else the portal root. |
| OQ-10c | #10 | Step 6 and the Done screen: #10 ships 6 steps, R15 inserts step 6; the §6 screen 7 Done copy has no owner | No placeholder step. The operator adds the Done copy to #10 or keeps the existing `DoneStep`. |
| OQ-10d | #10 | Does the disallowed-intent error text reach the UI? | Lane 1 verifies it with a fixture first. |
| — | #11 | The revised Keys sheet (§17.10) has no recorded approval | The operator approves it, then R14 and R15 are filed under ROK-1666. |
| OQ-12a | #12 | Is the existing Render **staging** service Blueprint-synced to `render.yaml`? (Cost and runtime change) | The operator confirms before merge; use a separate blueprint if it is synced. |
| OQ-12b | #12 | Disk size | 5 GB by default. |
| OQ-12c | #12 | The button ignores `runtime: image` | Keep the source build for the button; document the image Blueprint. |
| OQ-13a | #13 | Does the template auto-generate the domain? | Settled by §13 RW-2. |
| OQ-13b | #13 | Template drift visibility | Commit a text mirror of the template settings (not in the spike). |
| OQ-13c | #13 | Sleep and auto-redeploy defaults | Pin sleep off; RW-3 records redeploy. |
| OQ-14a | #14 | Secret generation on Fly | Local `openssl rand` in the docs. |
| OQ-14b | #14 | 1 GB or 2 GB default | 1 GB unless F-2 fails. |
| OQ-15a | #15 | Forcing "update available" in Playwright | A DEMO fixture or env override; otherwise vitest plus the fleet plan. |
| OQ-15b | #15 | Railway and Fly update copy | Write it after the §13 results. |
| OQ-16a | #16 | Page path | `docs/host-your-own.md` plus a README section. |
| OQ-16b | #16 | Publish before the relay? | Provider sections as a beta; the relay section with R10/R18; announce at R-9. |

**Still with the operator, independent of these drafts** (from the INV and the cycle-23 comment):
- run the §13 proof deploys, or rule that deliverable dropped;
- approve the revised Keys sheet;
- Relay R-1 (domain) and R-2 (hosting) are settled for M1 by RH-6's 2026-09-24 ruling: the operator's hub host through the NAS Cloudflare tunnel. Ask only whether the public (M5) hub keeps that host.
