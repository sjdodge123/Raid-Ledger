FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl jq ca-certificates gnupg cron procps && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
        > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

COPY sweep.sh /usr/local/bin/sweep
RUN chmod +x /usr/local/bin/sweep

ENV SWEEP_INTERVAL_SECONDS=900 \
    CLAIM_HEARTBEAT_TIMEOUT_SECONDS=300 \
    DEFAULT_ENV_TTL_HOURS=24

ENTRYPOINT ["/bin/bash", "-c", "while true; do sweep; sleep \"$SWEEP_INTERVAL_SECONDS\"; done"]
