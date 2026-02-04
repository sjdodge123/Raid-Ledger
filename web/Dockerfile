# ====================
# Stage 1: Dependencies
# ====================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy root package files
COPY package*.json ./
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

# Build web app with production API URL
# Note: VITE_API_URL is set at build time, defaults to /api for reverse proxy
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build -w @raid-ledger/web

# ====================
# Stage 3: Production (Nginx)
# ====================
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/web/dist /usr/share/nginx/html

# Create non-root user for security
RUN chown -R nginx:nginx /usr/share/nginx/html \
    && chown -R nginx:nginx /var/cache/nginx \
    && chown -R nginx:nginx /var/log/nginx \
    && touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Switch to non-root user
USER nginx

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
