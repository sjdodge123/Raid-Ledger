# Events and Scheduling

Events are the core of Raid Ledger. Create one-time or recurring events, manage signups, and keep your community organized.

## Creating Events

### From the Web App

1. Navigate to the **Events** page
2. Click the **Create Event** button (floating action button on mobile)
3. Fill in the event details:
   - **Title** — Event name
   - **Game** — Select from the IGDB game catalog (optional)
   - **Start Time / End Time** — When the event takes place
   - **Max Attendees** — Limit signups (optional)
   - **Roster Type** — Generic (headcount) or MMO (Tank/Healer/DPS slots)
   - **Description** — Additional details (optional)
   - **Recurrence** — Set up recurring events (weekly, biweekly, etc.)

### From Discord

Use the `/event create` slash command:

```
/event create title:"Friday Night Raid" game:"World of Warcraft" time:"tonight 8pm"
```

The bot supports natural language time parsing including:
- "tonight 8pm"
- "Friday 7:30pm"
- "tomorrow at 6pm"
- "next Wednesday 9pm EST"

Time is interpreted using the user's timezone preference, the community default timezone, or Eastern Time as a fallback.

## Event Views

### Events List

The events page shows upcoming events with:
- Game name and cover art
- Start time with relative countdown
- Signup count vs max attendees
- Creator name
- Live status badge for ad-hoc voice events

### Calendar View

Toggle to calendar view to see events displayed across the month. Click any event for details.

### Event Detail

The event detail page shows:
- Full event information
- Roster with role assignments
- Signup/decline buttons
- Description and game info
- Links to the event creator's profile

## Recurring Events

Events can be set up with recurrence rules:
- Weekly, biweekly, or custom frequency
- Events in a recurrence group share the same recurrence group ID
- Channel bindings can target an entire series

## Event Planning (Polls)

Use `/event plan` in Discord or the web planning form to:
1. Propose multiple candidate time slots
2. Community members vote on preferred times
3. The best time is automatically selected

## Signups

- **Sign up** — Confirm attendance
- **Decline** — Mark yourself as not attending
- **Bench** — Available as a backup if a slot opens

Admins can manage signups on behalf of other users.

## Discord Integration

When the Discord bot is connected:
- **Automatic announcements** — Events are announced in bound channels
- **Embed updates** — Event embeds update in real-time as signups change
- **Magic links** — Discord embeds include magic links for one-click web access

## Next Steps

- [Roster Management](Roster-Management) — Role assignments and slot management
- [Ad-Hoc Voice Events](Ad-Hoc-Voice-Events) — Spontaneous events
- [Notifications and Reminders](Notifications-and-Reminders) — Automated event reminders
