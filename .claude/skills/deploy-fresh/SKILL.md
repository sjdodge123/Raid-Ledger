---
name: deploy-fresh
description: Fresh deploy — wipe the database and start clean with a new admin password
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*), Bash(./scripts/deploy_prod.sh*)"
---

# Fresh Deploy

Wipe the database entirely and start clean with a new admin password.

**WARNING:** This destroys all data. Confirm with the user before proceeding.

Ask the user which environment:

- **Dev:** `./scripts/deploy_dev.sh --fresh`
- **Prod:** `./scripts/deploy_prod.sh --fresh`

Display the new admin credentials and URLs from the script output.
