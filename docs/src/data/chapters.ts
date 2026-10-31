import type { ShotId } from './shots';

// The four growth chapters (ITEM.md §5). Copy is the approved mockup's.
// `icon` is a 24×24 stroke-path `d` attribute.
export interface Feature { icon: string; title: string; body: string }
export interface Chapter {
  name: string;
  title: string;
  intro: string;
  /** Copy on the right at ≥1024px. */
  flip: boolean;
  /** Desktop frame + phone frame side by side. */
  duo: boolean;
  shots: ShotId[];
  features: Feature[];
}

export const CHAPTERS: Chapter[] = [
  {
    "name": "Bring people in",
    "title": "Turn lurkers into regulars",
    "intro": "New members find a way in on day one: a pinned sign-in post, invite links to the hubs they care about, and a short setup that asks when they play.",
    "flip": false,
    "duo": true,
    "shots": [
      "S2",
      "S3"
    ],
    "features": [
      {
        "icon": "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
        "title": "One-click Discord sign-in",
        "body": "The bot pins a \"Join Raid Ledger\" button in your server. No passwords, no new accounts."
      },
      {
        "icon": "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
        "title": "Hub invite links",
        "body": "Share a link to your guild, server or campaign hub; whoever opens it joins."
      },
      {
        "icon": "M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z",
        "title": "Looking-for-group that fills itself",
        "body": "/lfg for right now, tonight or this week. Groups form on a board channel and members drop into the thread."
      },
      {
        "icon": "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01",
        "title": "Game roles on autopilot",
        "body": "Play a game and you get its Discord role; drift away and it is removed, so pings reach people who still play."
      },
      {
        "icon": "M4 4h16v16H4zM4 9h16M9 4v16",
        "title": "A weekly digest worth reading",
        "body": "What the community played, what's coming up, milestones and the best current game deals, posted to Discord."
      }
    ]
  },
  {
    "name": "Get them showing up",
    "title": "Fewer no-shows, without the nagging",
    "intro": "People show up to plans they can see, answer in one tap and are reminded about at the right moment. Raid Ledger handles all three.",
    "flip": true,
    "duo": false,
    "shots": [
      "S4",
      "S5"
    ],
    "features": [
      {
        "icon": "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
        "title": "Sign up on the bot's post",
        "body": "Roles, bench and tentative spots, with the next player moved up automatically when a slot opens."
      },
      {
        "icon": "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
        "title": "Polls that find the night",
        "body": "Members vote on times; busy hours from their Google or Apple calendar show up, and you can rally anyone who hasn't voted."
      },
      {
        "icon": "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
        "title": "Reminders in their DMs",
        "body": "Batched, never doubled up. Running late? Members flag it, and hosts push the start back 15 or 30 minutes in one tap."
      },
      {
        "icon": "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
        "title": "A voice channel for every event",
        "body": "Created just before the start and removed when it ends, so your channel list stays tidy."
      },
      {
        "icon": "M21 12a9 9 0 1 1-9-9M21 3v6h-6",
        "title": "In everyone's own calendar",
        "body": "Sign-ups go into Google or Apple Calendar, or members subscribe to a personal feed in any calendar app."
      }
    ]
  },
  {
    "name": "Keep them engaged",
    "title": "A home base for every group you run",
    "intro": "Each guild, game server and campaign gets its own hub: a page members come back to between sessions, with the posts, pictures and plans that make a group feel like a group.",
    "flip": false,
    "duo": true,
    "shots": [
      "S6",
      "S7"
    ],
    "features": [
      {
        "icon": "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
        "title": "Hubs you arrange yourself",
        "body": "Leader posts, events and members, plus widgets officers can reorder, hide or add."
      },
      {
        "icon": "M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21",
        "title": "A shared Gallery",
        "body": "Screenshots from the hub's Discord channel and member uploads, in one place."
      },
      {
        "icon": "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
        "title": "Friendly competition",
        "body": "Attendance leaderboards, a Steam achievement race and playtime totals for the hub's game."
      },
      {
        "icon": "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
        "title": "\"What are we playing?\" settled",
        "body": "Community lineups: nominate, vote, and see which games most of the group owns and wants to play."
      },
      {
        "icon": "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4",
        "title": "Before next session",
        "body": "A pinned note and checklist so everyone arrives ready, and a recap of who played after."
      }
    ]
  },
  {
    "name": "Run it without spreadsheets",
    "title": "Officer work, done for you",
    "intro": "Raid Ledger keeps the records your officers used to keep by hand, and shows you who might be drifting away while there is still time to do something about it.",
    "flip": true,
    "duo": false,
    "shots": [
      "S8"
    ],
    "features": [
      {
        "icon": "M22 12h-4l-3 9L9 3l-3 9H2",
        "title": "Attendance from voice",
        "body": "Who joined the voice channel is the attendance record. Absent players get a nudge; the host gets a report."
      },
      {
        "icon": "M18 20V10M12 20V4M6 20v-6",
        "title": "Community insights",
        "body": "Reliability, late and no-show rates, attendance trends and churn risk across the community."
      },
      {
        "icon": "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
        "title": "Channels that tidy themselves",
        "body": "Game channels open when people start playing and archive when they go quiet."
      },
      {
        "icon": "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
        "title": "Admin that stays out of the way",
        "body": "User management, nightly backups, 15 themes and a feedback button that sends you a screenshot of the problem."
      }
    ]
  }
];
