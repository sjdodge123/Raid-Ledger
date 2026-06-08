# rl-infra runner image — long-lived per-slot dev container.
#
# Built once on the VM (docker compose build runner-1). Mutagen syncs the
# worktree from the laptop into /workspace; node_modules + cache live in
# named volumes that survive rebuilds.
# Pin matches the repo's playwright devDependency. When package.json bumps
# Playwright, bump this base image in lockstep and rebuild the runner image,
# or globalSetup fails fleet-wide with a missing chromium binary.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Node 22 is already present in the playwright image; we add system tooling
# the dev/CI scripts expect plus debugging niceties.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg jq tmux htop tcpdump strace lsof \
        redis-tools rsync git unzip make build-essential \
        netcat-openbsd iproute2 dnsutils inotify-tools \
        lsb-release && \
    # ROK-1331 dogfood (2026-05-20): install postgresql-client-16 specifically
    # so pg_dump matches the postgres testcontainers' server version (pg 16.x
    # via pgvector/pgvector:pg16). Default Ubuntu repo's `postgresql-client`
    # pulls v14, which can't dump from a v16 server (server version mismatch).
    # The official postgresql apt repo provides version-specific packages.
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
        gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] \
        http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && apt-get install -y --no-install-recommends \
        postgresql-client-16 && \
    # Docker CLI (no daemon — uses the host docker.sock).
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
        > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends \
        docker-ce-cli docker-buildx-plugin docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Mutagen agent is NOT installed here. The agent runs on the VM host
# (installed by cloud-init), not inside the runner container — Mutagen syncs
# to /srv/rl-infra/runners/slot-N/worktree on the VM, which is bind-mounted
# into this container at /workspace. The runner just sees the synced files.

# Profiling toolchain — installed globally so `clinic doctor` / `0x` are
# available without per-claim npm installs.
RUN npm install -g clinic 0x autocannon

# pgweb — single-binary web UI for Postgres introspection.
RUN curl -fsSL https://github.com/sosedoff/pgweb/releases/download/v0.16.2/pgweb_linux_amd64.zip -o /tmp/pgweb.zip && \
    unzip /tmp/pgweb.zip -d /usr/local/bin && \
    mv /usr/local/bin/pgweb_linux_amd64 /usr/local/bin/pgweb && \
    chmod +x /usr/local/bin/pgweb && \
    rm /tmp/pgweb.zip

WORKDIR /workspace

# tmux default session so `rl shell` attaches to a stable name.
COPY tmux.conf /root/.tmux.conf
COPY entrypoint.sh /usr/local/bin/runner-entrypoint
RUN chmod +x /usr/local/bin/runner-entrypoint

ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
CMD ["sleep", "infinity"]
