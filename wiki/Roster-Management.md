# Roster Management

The roster system manages event signups with support for role-based slot assignments, drag-and-drop management, bench tracking, and PUG (Pick-Up Group) invites.

## Roster Types

### Generic Roster

Simple headcount tracking. Players sign up and are counted against the max attendees limit. No role assignments.

### MMO Roster

Role-based slot assignments for MMO-style content:

- **Tank** — Frontline/defensive role
- **Healer** — Support/healing role
- **DPS** — Damage role
- **Flex** — Can fill any role as needed
- **Bench** — Available as backup

Slot counts are configurable per event (e.g., 2 Tanks, 3 Healers, 15 DPS).

## Managing the Roster

### Signing Up

Players can sign up from:
- The web app event detail page
- Discord invite links
- PUG invite DMs

### Role Assignment

Event creators and admins can:
- Assign players to specific role slots
- Drag and drop players between slots
- Move players to/from the bench
- Swap two players' positions

### Reassign Mode

Click the **Reassign** button on the event detail page to enter reassign mode:
1. Select a player to move
2. Choose a target slot (empty or occupied)
3. If the target is occupied, a swap is performed
4. Click **Back** to exit reassign mode

### Viewing the Roster

**Web app:** The event detail page shows the full roster with role breakdown.

**Discord:** Use the `/roster` command:

```
/roster event:"Friday Night Raid"
```

The embed shows:
- Role groups with player names
- Slot counts per role (e.g., Tank 2/2)
- Total signups vs max attendees
- Link to the full roster in the web app

Custom role emojis are used when available in the Discord server.

## PUG (Pick-Up Group) System

The PUG system lets event creators invite external players:

### Anonymous Invite Link

```
/invite event:"Raid Night"
```

Generates a shareable tiny URL. Anyone who clicks it can join the event.

### Named Invite

```
/invite event:"Raid Night" user:@Player
```

Creates a named PUG slot for the specified Discord user and triggers a DM invite.

## No-Show Detection

Raid Ledger tracks attendance and detects no-shows:
- Players who signed up but didn't join are flagged
- Absent players receive a DM notification
- Event creators are notified with an option to PUG the empty slot

## Next Steps

- [Events and Scheduling](Events-and-Scheduling) — Creating events
- [Ad-Hoc Voice Events](Ad-Hoc-Voice-Events) — Voice channel events
- [Analytics and Metrics](Analytics-and-Metrics) — Attendance tracking
