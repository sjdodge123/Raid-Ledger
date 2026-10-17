---
name: reset-password
description: Reset the admin password without data loss (alias for /reset-pwd)
disable-model-invocation: true
allowed-tools: "Bash(./scripts/deploy_dev.sh*), Bash(./scripts/deploy_prod.sh*), Bash(docker *)"
---

# Reset Admin Password

Reset the admin password without wiping any data. This updates `.env` ADMIN_PASSWORD and syncs it across dev/prod.

Ask the user which environment to reset, then run the appropriate command:

- **Dev:** `./scripts/deploy_dev.sh --reset-password`
- **Prod:** `./scripts/deploy_prod.sh --reset-password`
- **Both:** Run both commands in sequence

After the reset completes, tail the API container logs to find the login info:

Run: `docker logs raid-ledger-api --tail 50 2>&1 | grep -i -A2 "admin\|login\|credential\|password\|bootstrap"`

Display the new admin credentials from both the script output and the log message.
