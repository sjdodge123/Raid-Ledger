# ROK-1846 — rl-docker-guard. Zero npm dependencies: node's own http + net.
FROM node:22-alpine
WORKDIR /guard
COPY package.json ./
COPY src ./src
COPY bin ./bin
# Non-root; compose sets the group to the host docker GID so the socket is
# readable (same pattern as rl-docker-proxy).
USER node
EXPOSE 2375
CMD ["node", "src/server.mjs"]
