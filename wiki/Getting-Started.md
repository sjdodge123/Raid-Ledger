# Getting Started

## Requirements

- Docker installed on your system
- A machine with at least 1 GB of RAM
- Port 80 available (or configure a custom port)

## Quick Deploy

Run a single command to start Raid Ledger:

```bash
docker run -d -p 80:80 ghcr.io/sjdodge123/raid-ledger:main
```

The container includes PostgreSQL, Redis, and the full application. No external services are required.

## First Login

1. Check the container logs for your initial admin credentials:

```
docker logs $(docker ps -q --filter ancestor=ghcr.io/sjdodge123/raid-ledger:main)
```

Look for the credentials block:

```
+============================================================+
|          INITIAL ADMIN CREDENTIALS                          |
+============================================================+
|  Email:    admin@local                                      |
|  Password: xK9mP2vL...                                     |
+------------------------------------------------------------+
|  Save this password! It will not be shown again.            |
+============================================================+
```

2. Open [http://localhost](http://localhost) in your browser
3. Log in with the email `admin@local` and the password from the logs

## Setup Wizard

On first login, you will be guided through the setup wizard:

1. **Secure Account** — Change the default admin password and optionally link your Discord account for avatar sync
2. **Community** — Set your community's display name and default timezone
3. **Plugins** — Enable integrations (Discord bot, IGDB game catalog, Blizzard API, etc.)
4. **Done** — Summary and next steps

You can skip any step, but skipping the password change will show a security warning.

## Reset Admin Password

If you lose your admin password, restart the container with the `ADMIN_PASSWORD` environment variable:

```bash
docker run -e ADMIN_PASSWORD=mynewpassword -p 80:80 ghcr.io/sjdodge123/raid-ledger:main
```

This updates the admin password on every startup when the variable is set.

## Custom Port

To run on a different port (e.g., 8080):

```bash
docker run -d -p 8080:80 ghcr.io/sjdodge123/raid-ledger:main
```

## Data Persistence

Data is stored in a Docker volume by default. To use a named volume for easier management:

```bash
docker run -d -p 80:80 -v raid-ledger-data:/data ghcr.io/sjdodge123/raid-ledger:main
```

## Next Steps

- [Discord Bot Setup](Discord-Bot-Setup) — Connect the Discord bot
- [Configuration Reference](Configuration-Reference) — All environment variables
- [Events and Scheduling](Events-and-Scheduling) — Start creating events
