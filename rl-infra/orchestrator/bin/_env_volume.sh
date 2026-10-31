#!/usr/bin/env bash
# ROK-1846 c6 — env-spin owns rl-data-<slug> from its first byte.
#
# env-spin used to let `docker run -v rl-data-<slug>:…` auto-create the env's
# PostgreSQL volume, so a volume that already existed was mounted unchanged.
# A runner could create that name first (through rl-docker-guard, which
# stamps rl.guard.owner on everything a runner creates) and keep read/write
# access to the live env's database. The guard now refuses rl-data-* names;
# this is the orchestrator-side half: a fresh PG gets a volume env-spin
# created and labelled itself, and a pre-existing one carrying a guard owner
# label is refused loudly. A pre-existing UNLABELLED volume is a pre-guard
# env's own data (recreate flow, or a PG removed by hand) and is reused.

# env_volume::ensure <volume> <slug> — 0 when <volume> is safe to mount
# (created here, or pre-existing without a guard owner); 1 + stderr otherwise.
env_volume::ensure() {
    local vol="$1" slug="$2" owner
    if owner=$(docker volume inspect "$vol" --format '{{ index .Labels "rl.guard.owner" }}' 2>/dev/null); then
        if [[ -n "$owner" && "$owner" != "<no value>" ]]; then
            echo "volume $vol was created by runner $owner, not the orchestrator — refusing to mount it as env $slug's database. Remove it (docker volume rm $vol) and re-spin." >&2
            return 1
        fi
        return 0
    fi
    docker volume create --label rl.role=env --label "rl.env_slug=$slug" "$vol" >/dev/null
}
