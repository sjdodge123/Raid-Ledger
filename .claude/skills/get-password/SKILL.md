---
name: get-password
description: Retrieve the current admin password from the .env file
disable-model-invocation: true
allowed-tools: "Bash(grep *)"
---

# Get Admin Password

Retrieve and display the current admin credentials from the `.env` file.

Run: `grep ADMIN_PASSWORD .env`

Display the result as:

- **Admin Email:** admin@local
- **Admin Password:** (value from .env)
