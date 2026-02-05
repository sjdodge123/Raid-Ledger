# ====================
# Stage 1: Dependencies
# ====================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy root package files
COPY package*.json ./
COPY api/package*.json ./api/
COPY packages/contract/package*.json ./packages/contract/

# Install all dependencies (including dev for build)
RUN npm ci

# ====================
# Stage 2: Build
# ====================
FROM deps AS builder

WORKDIR /app

# Copy source code
COPY . .

# Build contract package first (api depends on it)
RUN npm run build -w @raid-ledger/contract

# Build API
RUN npm run build -w @raid-ledger/api

# ====================
# Stage 3: Production
# ====================
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nestjs

# Copy built application (NestJS outputs to dist/src/)
COPY --from=builder /app/api/dist ./dist

# Copy package.json for package info
COPY --from=builder /app/api/package.json ./package.json

# Copy drizzle migrations (SQL files only)
COPY --from=builder /app/api/src/drizzle/migrations ./drizzle/migrations

# Copy production node_modules (npm workspaces hoists all to root)
COPY --from=builder /app/node_modules ./node_modules

# Copy contract package AFTER node_modules to overlay the built version
COPY --from=builder /app/packages/contract/dist ./node_modules/@raid-ledger/contract/dist
COPY --from=builder /app/packages/contract/package.json ./node_modules/@raid-ledger/contract/package.json

# Copy entrypoint script
COPY api/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Copy seed scripts for demo mode
COPY --from=builder /app/api/dist/scripts ./dist/scripts

# Copy seed data files (games-seed.json for ROK-160)
COPY --from=builder /app/api/seeds ./dist/seeds

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Start application - NestJS outputs main.js to dist/src/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
