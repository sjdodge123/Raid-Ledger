# Updating

Raid Ledger is distributed as a Docker image. Updates are published to the GitHub Container Registry.

## Updating with Docker

### Pull the Latest Image

```bash
docker pull ghcr.io/sjdodge123/raid-ledger:main
```

### Restart the Container

```bash
# Stop the current container
docker stop raid-ledger-api

# Remove the old container (data is preserved in the volume)
docker rm raid-ledger-api

# Start with the new image
docker run -d --name raid-ledger-api \
  -p 80:80 \
  -v raid-ledger-data:/data \
  ghcr.io/sjdodge123/raid-ledger:main
```

### Automatic Updates with Watchtower

For automatic updates, use [Watchtower](https://containrrr.dev/watchtower/) to monitor for new images:

```bash
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --schedule "0 0 5 * * *" \
  raid-ledger-api
```

This checks for updates daily at 5 AM and automatically restarts the container with the new image.

## Database Migrations

Database migrations run automatically on container startup. Before each migration, a backup snapshot is saved to `/data/backups/migrations/` (see [Backup and Recovery](Backup-and-Recovery)).

No manual intervention is needed for database schema updates.

## Version Tags

| Tag | Description |
|-----|-------------|
| `main` | Latest stable release from the main branch |
| `sha-xxxxxxx` | Specific commit build |

## Rollback

If an update causes issues:

1. Stop the current container
2. Restore from a pre-migration backup (see [Backup and Recovery](Backup-and-Recovery))
3. Run the previous image version:

```bash
docker run -d -p 80:80 \
  -v raid-ledger-data:/data \
  ghcr.io/sjdodge123/raid-ledger:sha-<previous-commit>
```

## Next Steps

- [Backup and Recovery](Backup-and-Recovery) — Database backup management
- [Troubleshooting](Troubleshooting) — Common issues after updates
- [Configuration Reference](Configuration-Reference) — Environment variables
