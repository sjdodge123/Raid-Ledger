# Backup and Recovery

Raid Ledger automatically manages database backups to protect your data.

## Automatic Backups

### Daily Backups

A `pg_dump` runs every night at 2 AM and stores compressed `.dump` files:

```
/data/backups/daily/
```

Backups older than 30 days are automatically deleted.

### Pre-Migration Snapshots

Before every schema migration at container startup, a snapshot is saved:

```
/data/backups/migrations/
```

Migration snapshots are not auto-rotated and should be cleaned up manually when no longer needed.

## Accessing Backups

### List Available Backups

```bash
# Daily backups
docker exec raid-ledger-api ls /data/backups/daily/

# Migration snapshots
docker exec raid-ledger-api ls /data/backups/migrations/
```

### Copy a Backup to the Host

```bash
docker cp raid-ledger-api:/data/backups/daily/raid_ledger_2024-01-15_020001.dump ./restore.dump
```

## Restoring a Backup

### From a Custom-Format Dump

```bash
pg_restore --host localhost --port 5432 --username user --dbname raid_ledger \
  --no-owner --no-privileges ./restore.dump
```

### Full Restore Process

1. Stop the application
2. Drop and recreate the database (or use a fresh container)
3. Restore from the dump file
4. Restart the application — migrations will run automatically if needed

## Backup Preservation

Both development (`deploy_dev.sh --fresh`) and production (`deploy_prod.sh --fresh`) fresh resets automatically preserve and restore the `/data/backups/` directory across the volume wipe. Your backup history is never lost during a fresh reset.

## Best Practices

- **Test restores periodically** — Verify your backups work by restoring to a test environment
- **Copy critical backups off-server** — Docker volumes are local to the host; copy important backups to external storage
- **Monitor disk space** — Daily backups accumulate; ensure sufficient disk space
- **Keep migration snapshots** — Don't delete migration snapshots until you've verified the new schema works correctly

## Next Steps

- [Updating](Updating) — Update to the latest version
- [Configuration Reference](Configuration-Reference) — All settings
- [Troubleshooting](Troubleshooting) — Common issues
