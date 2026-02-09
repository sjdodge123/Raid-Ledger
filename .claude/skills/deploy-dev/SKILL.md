---
name: deploy-dev
description: Start the local development environment (Docker DB + Redis, native API + Vite)
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*)"
---

# Deploy Dev Environment

Start the local development environment using the deploy script.

Run: `./scripts/deploy_dev.sh`

This starts:
- Docker containers for PostgreSQL and Redis
- NestJS API in watch mode on http://localhost:3000
- Vite dev server with HMR on http://localhost:5173

After startup, display the admin credentials and available URLs from the script output.
