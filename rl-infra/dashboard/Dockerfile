FROM node:20-alpine
WORKDIR /app
COPY server.js .
COPY public/ public/
ENV NODE_ENV=production STATE_DIR=/state PUBLIC_DIR=/app/public PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
USER node
CMD ["node", "server.js"]
