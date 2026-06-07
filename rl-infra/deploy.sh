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
#      rl-agent must write (traefik/conf.d — matches the state/ pattern).
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
chmod +x orchestrator/bin/* gc-sweeper/sweep.sh runner/entrypoint.sh cli/rl deploy.sh 2>/dev/null || true
# Canonical perms on dirs rl-agent (group rl-fleet) must write — mirrors state/.
chgrp rl-fleet traefik/conf.d 2>/dev/null || true
chmod 2775 traefik/conf.d 2>/dev/null || true
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
