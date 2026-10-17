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
#   4. Rebuilds + restarts gc-sweeper (its sweep.sh is COPY'd at image build).
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

echo "==> VM-side: exec bits, canonical perms, gc-sweeper rebuild"
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
REMOTE

DEPLOYED_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
ssh "$VM" "echo '$DEPLOYED_SHA' > /srv/rl-infra/.deployed_sha"
echo "==> deployed_sha: $DEPLOYED_SHA"
echo "==> done"
