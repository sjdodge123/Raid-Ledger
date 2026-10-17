# API Reference

Raid Ledger exposes a REST API at `/api`. The API uses JSON for request and response bodies.

## Authentication

Most endpoints require authentication via a session cookie or Bearer token. Obtain a session by logging in via the `/api/auth/login` endpoint.

## Core Endpoints

### Health

```
GET /api/health
```

Returns `200 OK` when the application is running.

### Authentication

```
POST /api/auth/login          — Log in with email and password
POST /api/auth/logout         — Log out
GET  /api/auth/me             — Get current user info
GET  /api/auth/discord        — Start Discord OAuth flow
GET  /api/auth/discord/callback — Discord OAuth callback
```

### Events

```
GET    /api/events            — List events (supports pagination, filters)
GET    /api/events/:id        — Get event details
POST   /api/events            — Create an event
PATCH  /api/events/:id        — Update an event
DELETE /api/events/:id        — Cancel an event
```

**Query parameters for `GET /api/events`:**
- `page` — Page number (default: 1)
- `limit` — Items per page (default: 20)
- `upcoming` — Filter to upcoming events (`true`/`false`)
- `gameId` — Filter by game ID

### Signups

```
POST   /api/events/:id/signups    — Sign up for an event
DELETE /api/events/:id/signups    — Cancel signup
GET    /api/events/:id/roster     — Get roster with assignments
PATCH  /api/events/:id/roster     — Update roster assignments
```

### Users

```
GET    /api/users                 — List users (admin)
GET    /api/users/:id             — Get user profile
PATCH  /api/users/:id             — Update user
GET    /api/users/:id/preferences — Get user preferences
PATCH  /api/users/:id/preferences — Update user preferences
```

### Games

```
GET    /api/games                 — Search games (IGDB catalog)
GET    /api/games/:id             — Get game details
GET    /api/game-registry         — List active community games
```

### Settings

```
GET    /api/settings              — Get application settings (admin)
PATCH  /api/settings              — Update settings (admin)
GET    /api/settings/branding     — Get public branding info
```

### PUGs (Pick-Up Groups)

```
POST   /api/events/:id/pugs      — Create a PUG invite
GET    /api/invites/:code         — Resolve an invite code
POST   /api/invites/:code/accept  — Accept a PUG invite
```

## OpenAPI / Swagger

The API generates OpenAPI documentation automatically via `nestjs-zod`. When the application is running in development mode, Swagger UI is available at:

```
GET /api/docs
```

## Validation

All request bodies are validated using Zod schemas defined in `packages/contract`. Invalid requests return `400 Bad Request` with a detailed error message.

## Error Responses

Errors follow a standard format:

```json
{
  "statusCode": 400,
  "message": "Validation error message",
  "error": "Bad Request"
}
```

Common status codes:
- `400` — Validation error
- `401` — Not authenticated
- `403` — Insufficient permissions
- `404` — Resource not found
- `409` — Conflict (e.g., duplicate signup)

## Next Steps

- [Configuration Reference](Configuration-Reference) — API configuration
- [Authentication](Authentication) — Auth methods
- [Plugin System](Plugin-System) — Plugin API extensions
