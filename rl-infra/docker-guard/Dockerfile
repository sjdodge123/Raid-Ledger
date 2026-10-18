# ROK-1846 — rl-docker-guard. node's own http + net; one pinned runtime
# dependency (dockerfile-ast, MIT, c3) installed from the committed lockfile.
FROM node:22-alpine
WORKDIR /guard
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY bin ./bin
# Non-root; compose sets the group to the host docker GID so the socket is
# readable (same pattern as rl-docker-proxy).
USER node
EXPOSE 2375
CMD ["node", "src/server.mjs"]
