#!/usr/bin/env bash
# Operator deploy: laptop repo rl-infra/ → VM /srv/rl-infra/.
#
# REPLACES the raw `rsync -avh` in SETUP.md Phase 3.1. That bare rsync
# replicates the LAPTOP's directory permissions onto live VM dirs — which
# strips the group-write + setgid bits rl-agent (group rl-fleet) needs on
# traefik/conf.d. Observed 2026-06-06: after such a deploy, every env-spin
# silently aborted at the Traefik route write (perm denied under set -e) and
# rl_env_destroy couldn't remove route files. This script:
#   1. rsyncs file CONTENT only (--no-perms/--no-owner/--no-group) — existing
#      VM perms are preserved; new files inherit VM-side dir defaults.
#   2. Restores exec bits (new scripts arrive 644 under --no-perms).
#   3. Re-asserts the canonical rl-fleet group-write + setgid on the dirs
#      rl-agent must write (traefik/conf.d — matches the state/ pattern),
#      plus 640 root:rl-fleet on .env (bot tokens — group-readable, never o+r).
#   3b. Creates the rl-docker-proxy socket dir and applies the proxy's compose
#      config, failing loudly if its unix socket does not appear (ROK-2049).
#   4. Rebuilds + restarts gc-sweeper (its sweep.sh is COPY'd at image build)
#      and the dashboard (ROK-1847: a bind-mounted server.js edit is not live
#      until the node process restarts, and the image must carry every module
#      server.js imports).
#   5. Stamps /srv/rl-infra/.deployed_sha for rl_status visibility.
#
# Usage: ./rl-infra/deploy.sh            (target from RL_DEPLOY_TARGET or default)
#        RL_DEPLOY_TARGET=rl@10.0.0.5 ./rl-infra/deploy.sh
set -euo pipefail

VM="${RL_DEPLOY_TARGET:-rl@192.168.0.132}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SRC/.." && pwd)"

echo "==> rsync rl-infra/ → ${VM}:/srv/rl-infra/ (content-only, no perms/owner)"
rsync -rltvh --no-perms --no-owner --no-group --omit-dir-times \
    --exclude='.git' \
    "$SRC/" "$VM:/srv/rl-infra/" | tail -3

echo "==> VM-side: exec bits, canonical perms, gc-sweeper + dashboard rebuild"
ssh "$VM" bash -s <<'REMOTE'
set -euo pipefail
cd /srv/rl-infra
chmod +x orchestrator/bin/* gc-sweeper/sweep.sh runner/*.sh cli/rl deploy.sh 2>/dev/null || true
# Canonical perms on dirs rl-agent (group rl-fleet) must write — mirrors state/.
chgrp rl-fleet traefik/conf.d 2>/dev/null || true
chmod 2775 traefik/conf.d 2>/dev/null || true
# /srv/rl-infra/.env holds bot tokens + RL_ADMIN_PASSWORD; rl-agent reads it via
# the rl-fleet group, so it must be 640 root:rl-fleet — never world-readable.
chgrp rl-fleet .env 2>/dev/null || true
chmod 640 .env 2>/dev/null || true
# ROK-1469: same treatment for the settings bundle rl-agent must READ. rsync
# resets these on every deploy, and an unreadable bundle costs each env its
# shared API keys.
if [[ -d settings ]]; then
    chgrp -R rl-fleet settings 2>/dev/null || true
    chmod 2750 settings 2>/dev/null || true
    chmod 640 settings/bundle.enc 2>/dev/null || true
fi
# ROK-2049 — rl-docker-proxy listens on a unix socket in this dir (no TCP).
# rl:rl-fleet 3770: the proxy (uid 65532, primary gid rl-fleet) creates its 0660
# socket here; rl-agent + rl reach it through the group; sticky stops anyone
# but the proxy from unlinking it. Must exist BEFORE the proxy starts, or the
# daemon mkdirs the bind source root:root 0755 and the proxy cannot bind.
# Fails LOUDLY (unlike the dirs above): a silent no-op leaves rl:rl 3770, the
# proxy cannot create its socket (crash loop) and rl-agent cannot traverse.
mkdir -p run/docker-proxy
if ! chgrp rl-fleet run/docker-proxy || ! chmod 3770 run/docker-proxy; then
    echo "ERROR: could not set run/docker-proxy to rl:rl-fleet 3770. The deploy user must be in rl-fleet: sudo usermod -aG rl-fleet rl, then re-run deploy.sh (new SSH session)." >&2
    exit 1
fi
# ROK-2049 (Codex P1) — apply the proxy's compose config on every deploy. Nothing
# else depends on docker-socket-proxy, so without this a fleet keeps the old
# host-TCP 127.0.0.1:2375 listener (the exposure stays open) while the rsynced
# _state.sh and MCP tools look for a socket that does not exist. `up -d` is a
# no-op when the service is unchanged (and pulls the pinned tag if missing).
# Runs on the raw socket (rl is in docker). Readiness is a real _ping, not -S:
# a socket file left by a killed old container would pass -S before the new
# process binds.
docker compose up -d docker-socket-proxy
proxy_ready() { curl -fsS --max-time 1 --unix-socket run/docker-proxy/docker.sock http://localhost/_ping >/dev/null 2>&1; }
for _ in $(seq 1 30); do
    proxy_ready && break
    sleep 0.5
done
if ! proxy_ready; then
    echo "ERROR: rl-docker-proxy is not answering _ping on run/docker-proxy/docker.sock within 15s. Check: docker logs --tail 30 rl-docker-proxy" >&2
    exit 1
fi
echo "docker-socket-proxy up (unix socket ready)"
# A3-B P3 — scaffold /srv/rl-infra/runners/slot-{1..4}/worktree + state/locks
# with the rl-agent:rl-fleet 2775 the Mutagen beta needs. Nothing created the
# slot-3/4 dirs before, so the Docker daemon mkdir'd the bind-mount sources as
# root and every sync entry failed with permission denied. Idempotent: dirs
# already correct need no privilege, so this stays green running as `rl`.
# Exit 96 NAMES what it could not repair; the `|| true` keeps a deploy from
# aborting on it, and the named lines are the deliverable.
bash runner/ensure-runner-dirs.sh --root /srv/rl-infra || true

# gc-sweeper bakes sweep.sh into its image at build time — rebuild is cheap
# (cached) and a no-op restart when nothing changed.
docker compose build gc-sweeper >/dev/null 2>&1
docker compose up -d gc-sweeper >/dev/null 2>&1
echo "gc-sweeper rebuilt + restarted"
# ROK-1847 — the dashboard runs server.js once at start, so rsynced edits to it
# (and to plan-auth.js, which it imports) stay inactive until a restart.
# --force-recreate restarts it even when the image layers are unchanged.
docker compose up -d --build --force-recreate dashboard >/dev/null 2>&1
echo "dashboard rebuilt + restarted"
REMOTE

DEPLOYED_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
ssh "$VM" "echo '$DEPLOYED_SHA' > /srv/rl-infra/.deployed_sha"
echo "==> deployed_sha: $DEPLOYED_SHA"
echo "==> done"
