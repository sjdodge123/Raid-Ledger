# Troubleshooting

Common issues and solutions for Raid Ledger.

## Startup Issues

### Container Won't Start

**Check the logs:**
```bash
docker logs raid-ledger-api
```

Common causes:
- **Port conflict** — Port 80 is already in use. Try a different port: `-p 8080:80`
- **Insufficient memory** — The container needs at least 1 GB of RAM
- **Volume permissions** — Ensure Docker has permission to write to the data volume

### Lost Admin Password

Reset the admin password by starting the container with the `ADMIN_PASSWORD` variable:

```bash
docker run -e ADMIN_PASSWORD=newpassword -p 80:80 ghcr.io/sjdodge123/raid-ledger:main
```

## Discord Bot Issues

### Slash Commands Not Appearing

- Discord can take up to 1 hour to propagate new slash commands
- Restart the container to re-register commands
- Verify the `DISCORD_BOT_TOKEN` environment variable is set
- Check that the bot has the **Use Application Commands** permission

### Bot Not Responding

- Check that the bot is showing as online in your Discord server
- Verify the bot token is correct
- Check container logs for Discord connection errors
- Ensure the **Presence Intent** and **Server Members Intent** are enabled in the Discord Developer Portal

### Rich Presence Not Detected

- The user must have Discord Rich Presence enabled (User Settings > Activity Privacy)
- Some games don't support Rich Presence — use `/playing` as a manual fallback
- The bot requires the **Presence Intent** to be enabled

### Event Announcements Not Posting

- Check that a [channel binding](Channel-Bindings) exists for the target channel
- Verify the bot has **Send Messages** and **Embed Links** permissions in the channel
- Check if the event's game matches the binding's game filter

## Database Issues

### Database Connection Errors

The built-in PostgreSQL starts automatically. If you see connection errors:
- Wait a few seconds — the database may still be initializing
- Check available disk space — PostgreSQL needs space for WAL files
- Review logs for PostgreSQL-specific errors

### Data Not Persisting After Restart

Ensure you're using a named Docker volume:

```bash
docker run -d -p 80:80 -v raid-ledger-data:/data ghcr.io/sjdodge123/raid-ledger:main
```

Without a named volume, data is stored in an anonymous volume that may be lost.

## Performance Issues

### Slow Page Loads

- Enable `DEBUG=true` to see query timing in the logs
- Check available memory — the container runs PostgreSQL, Redis, and the Node.js application
- Ensure the host machine has sufficient resources (recommended: 2+ GB RAM)

## Health Check

Use the health check endpoint to verify the application is running:

```bash
curl http://localhost/api/health
```

Returns `200 OK` when healthy.

## Debug Mode

Enable verbose logging for troubleshooting:

```bash
docker run -d -p 80:80 -e DEBUG=true ghcr.io/sjdodge123/raid-ledger:main
```

Debug mode outputs:
- Query details and timing
- Startup diagnostics
- Plugin internals
- Discord bot event logs

## Getting Help

- [GitHub Issues](https://github.com/sjdodge123/Raid-Ledger/issues) — Report bugs or request features
- [Configuration Reference](Configuration-Reference) — All environment variables
- [Getting Started](Getting-Started) — Initial setup guide
