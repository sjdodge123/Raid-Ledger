# Authentication

Raid Ledger supports multiple authentication methods for flexibility.

## Login Methods

### Local Authentication

The default authentication method. Users log in with an email and password.

- The initial admin account is created automatically on first startup (`admin@local`)
- The admin password is displayed in the container logs on first run
- Passwords can be reset via the `ADMIN_PASSWORD` environment variable

### Discord OAuth

When the Discord plugin is configured, users can log in via Discord OAuth:

1. Click **Login with Discord** on the login page
2. Authorize the Discord application
3. Your Discord account is linked to your Raid Ledger profile

Discord OAuth provides:
- One-click login
- Automatic username and avatar sync
- Account linking between Discord and Raid Ledger

### Magic Links

Magic links provide passwordless authentication from Discord:

- When a user interacts with the bot (e.g., `/events`), embeds include a **magic link button**
- Clicking the button opens the web app with automatic authentication
- Magic links are one-time-use and expire after a short period
- No password entry required — seamless Discord-to-web transition

## User Roles

| Role | Permissions |
|------|------------|
| **Admin** | Full access — manage settings, users, plugins, and all events |
| **Operator** | Manage events, bindings, and community settings |
| **User** | Create and sign up for events, manage own profile |

## Invite System

Admins can invite new users through:
- The admin panel user management page
- Discord `/invite` command (creates PUG slots with invite links)

## Setting Up Discord OAuth

See [Discord Bot Setup](Discord-Bot-Setup) for full instructions on configuring Discord OAuth.

## Next Steps

- [Discord Bot Setup](Discord-Bot-Setup) — Configure Discord login
- [Plugin System](Plugin-System) — Authentication plugins
- [Getting Started](Getting-Started) — Initial setup
