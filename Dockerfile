# ====================
# Stage 1: Dependencies
# ====================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY api/package*.json ./api/
COPY web/package*.json ./web/
COPY packages/contract/package*.json ./packages/contract/

# Install all dependencies
RUN npm ci

# ====================
# Stage 2: Build
# ====================
FROM deps AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build contract package first
RUN npm run build -w @raid-ledger/contract

# Build API
RUN npm run build -w @raid-ledger/api

# Build Web with /api prefix for nginx proxy
ENV VITE_API_URL=/api
RUN npm run build -w @raid-ledger/web

# ====================
# Stage 3: Production
# ====================
FROM node:20-alpine AS production

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 app \
    && adduser --system --uid 1001 app

# Copy built API
COPY --from=builder /app/api/dist ./dist
COPY --from=builder /app/api/package.json ./package.json
COPY --from=builder /app/api/src/drizzle/migrations ./drizzle/migrations
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contract/dist ./node_modules/@raid-ledger/contract/dist
COPY --from=builder /app/packages/contract/package.json ./node_modules/@raid-ledger/contract/package.json

# Copy seed scripts and data
COPY --from=builder /app/api/dist/scripts ./dist/scripts
COPY --from=builder /app/api/seeds ./dist/seeds

# Copy built Web static files
COPY --from=builder /app/web/dist /usr/share/nginx/html

# Copy nginx config (monolith uses localhost proxy)
COPY nginx/monolith.conf /etc/nginx/http.d/default.conf

# Copy entrypoint script
COPY api/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create supervisor config
RUN mkdir -p /etc/supervisor.d
COPY <<EOF /etc/supervisor.d/raid-ledger.ini
[supervisord]
nodaemon=true
user=root
logfile=/dev/stdout
logfile_maxbytes=0
pidfile=/run/supervisord.pid

[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:api]
command=/usr/local/bin/docker-entrypoint.sh node /app/dist/src/main.js
directory=/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
environment=NODE_ENV="production"
EOF

# Fix nginx directory permissions
RUN mkdir -p /run/nginx \
    && chown -R app:app /run/nginx \
    && chown -R app:app /var/lib/nginx \
    && chown -R app:app /var/log/nginx

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/api/health || exit 1

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=80

# Start supervisor (manages nginx + node)
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
