# Notifications and Reminders

Raid Ledger provides automated notifications and reminders to keep your community informed about events.

## Event Reminders

Automatic reminders are sent before events start:
- Reminders are sent to all signed-up players
- Timing is configurable per event or at the community level

## Discord Notifications

When the Discord bot is connected, notifications are delivered via:

### Channel Announcements

- **Event created** — New events are announced in the bound channel
- **Event updated** — Changes to events (time, game, roster) update the announcement embed
- **Event cancelled** — Cancellation notices are posted
- **Signup updates** — Embed signup counts update in real-time

### Direct Messages

- **Event reminders** — DMs to signed-up players before events
- **No-show alerts** — DMs to absent players after events start
- **PUG invites** — DMs to invited players with join links
- **Invite notifications** — DMs when you're invited to an event

## No-Show Detection

The no-show detection system:
1. Checks attendance after an event starts
2. Identifies players who signed up but aren't present
3. Sends DM alerts to absent players
4. Notifies the event creator with the option to PUG the empty slot

## Notification Preferences

Users can configure their notification preferences:
- **Timezone** — Events display in the user's preferred timezone
- Notification preferences are managed through the user profile

## Channel Binding Notifications

Notifications are routed based on [channel bindings](Channel-Bindings):
- **Game-specific channels** — Events for that game are announced in the bound channel
- **General channels** — All events or auto-detected games
- **Per-event overrides** — Override the notification channel for specific events using `/bind event`

## Next Steps

- [Events and Scheduling](Events-and-Scheduling) — Creating events
- [Discord Bot Setup](Discord-Bot-Setup) — Bot configuration
- [Channel Bindings](Channel-Bindings) — Configure announcement channels
