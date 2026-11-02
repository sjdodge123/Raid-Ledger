---
title: "WoW: Forever setup"
description: "How guild officers and members get their WoW: Forever guild and characters into Raid Ledger with the LedgerLink addon and the Raid Ledger Companion."
---

Raid Ledger can't read World of Warcraft: Forever on its own. The **LedgerLink** addon
packs your guild and character into a text string in game. You paste that string
into your Raid Ledger site, or let the **Raid Ledger Companion** app upload it for you.

This page covers both. Officers should read every section. Members only need
sections 2, 3, 5 and (optionally) 6.

## 1. What Raid Ledger shows for your guild

Once exports arrive, your guild's hub on Raid Ledger fills in these cards:

| Card | What it shows | Where its data comes from |
|---|---|---|
| **Class breakdown** | How many members play each class | An officer's guild export |
| **Level progression** | Where the roster's levels sit and who is at cap | An officer's guild export |
| **Role breakdown** | Tanks, healers and DPS ready for dungeons and raids | The guild export, plus the roles members set on their characters |
| **Guild professions** | Who has each profession and their best skill | Members add their professions from their own character page |
| **Dungeon quests** | Who has the quests for upcoming dungeon runs | Members' character exports. Quest data arrives after launch |
| **Who's saved** | Who is saved to which instance, and when it resets | Members' character exports |
| **Recent dings** | Who levelled up in the last 30 days | An officer re-exporting the guild |
| **Last seen** | Who was online at the last export, and who has been away longest | An officer's guild export |
| **Ready for next run** | Whether everyone signed up for the next raid or dungeon meets its level, quests, lockout and item level | Members' character exports, for an upcoming guild event |

Each card shows how fresh its data is, for example *"via LedgerLink · as of 3 days ago"*.
An empty card tells you what it's waiting for. *Last seen*, for example, says it
"shows up when an officer exports the roster from LedgerLink".

:::note
The guild export fills the roster cards. Each member's own character export
fills the lockout, quest and readiness cards. You need both.
:::

## 2. Install LedgerLink

1. Download the latest LedgerLink zip from its
   [GitHub releases page](https://github.com/sjdodge123/ledger-link/releases).
   LedgerLink is also published to CurseForge, so you can install it with the
   CurseForge app instead.
2. Unzip it into your game's AddOns folder. You should end up with:

   `World of Warcraft/_forever_/Interface/AddOns/LedgerLink/LedgerLink.toc`

3. Start the game (or type `/reload`). On the character screen, open **AddOns**
   and make sure **Ledger Link** is ticked.
4. In game, type `/rl` or click the LedgerLink minimap button to open its panel.

:::note
WoW: Forever lives in the `_forever_` folder inside your `World of Warcraft`
folder. Install LedgerLink there, not in `_classic_` or `_retail_`.
:::

If another addon already uses `/rl`, type `/ledgerlink` instead. It works
everywhere `/rl` does.

## 3. One-time setup on each character

Do this once on every character you'll export:

1. Tell LedgerLink your ruleset:

   `/rl ruleset normal` (or `pvp`, `rp` or `hardcore`)

   Hardcore characters are detected automatically, but setting it does no harm.
2. Only if the game doesn't report a region, set yours:

   `/rl region us` (or `eu`, `kr` or `tw`)

   The LedgerLink panel only shows region buttons when the game doesn't report one.
   If you don't see them, skip this step.

## 4. Officers: export the guild

1. Open the in-game **Guild** window once, so the game loads your roster.
2. Type `/rl export guild`.

   Or type `/rl export all`, or click **Export to Raid Ledger** in the LedgerLink
   panel. That gives you your character, the guild and any recorded boss pulls
   in one box, so you copy and paste once.
3. Click the text in the export window (that selects all of it), then press Ctrl+C.

**Big guilds come in pages.** A guild of more than 250 members is split into
pages of 250. The export window shows **Page 1/3** with **< Prev** and
**Next >** buttons. Copy every page and paste them all into the same box in
Raid Ledger, one after another. Order doesn't matter.

**Notes.** Officer notes are never read or exported. Public notes are left out
unless you turn them on with `/rl guildnotes on` (turn off again with
`/rl guildnotes off`).

### Where to paste the guild export

The guild export is pasted through your own character on Raid Ledger:

1. On your Raid Ledger site, open your WoW: Forever character's page.
2. Click **Import string**.
3. Paste, check the preview, and import.

If your character isn't on Raid Ledger yet: open **Add Character**, click
**Import LedgerLink character** and paste an Export all there. It creates the
character and imports the rest in one go.

:::note
The character that made the export must be on the guild roster. Any guild
member's newer export updates the roster, so members can keep it fresh too.
If a roster changes a lot at once, Raid Ledger tells the guild's staff so they
can check it.
:::

## 5. Members: export your character

1. Type `/rl export char`, or click **Export to Raid Ledger** in the LedgerLink panel
   (`/rl export all`).
2. Click the text, then press Ctrl+C.
3. On your Raid Ledger site, open your character's page and click **Import string**.
   Paste, check the preview, and import.

New to Raid Ledger? Use **Add Character** → **Import LedgerLink character**
instead. It creates the character from the export.

## 6. Skip the copy-paste: the Raid Ledger Companion

The Raid Ledger Companion is a small desktop app. It uploads your LedgerLink
exports for you after you log out of the game.

1. On your Raid Ledger site, go to **Profile → My Integrations** and find the
   **Raid Ledger Companion** card. Click **Download**. It opens the
   [releases page](https://github.com/Raid-Ledger-Plugins/rl-companion/releases)
   (Windows `.exe`, macOS `.dmg`).
2. Install it and open it.

   :::note
   **Unsigned test build.** The current build (v0.1.0-test.1) isn't signed yet.
   Windows may say "Windows protected your PC": choose **More info**, then
   **Run anyway**. On a Mac, right-click the app and choose **Open** the first time.
   :::

   **Can't see the Companion's tray icon on Windows 11?** Go to **Settings →
   Personalization → Taskbar → Other system tray icons** and turn on
   **RL Companion**.

3. In the Companion, click **Link this device**. It shows an 8-letter code.
4. Enter the code at `/link` on your Raid Ledger site (for example
   `https://your-site/link`), then turn on the games you want it to read.
5. In the Companion's **WoW: LedgerLink uploads** section, tick
   **Upload LedgerLink exports automatically after you log out or /reload**.

:::note
Some Raid Ledger screens call this button **Link this computer**. It's the same
**Link this device** button.
:::

**How uploads happen.** LedgerLink saves an Export all every time you log out.
That's on by default; `/rl autoexport off` turns it off and `/rl autoexport on`
turns it back on. The Companion uploads it after you log out or type `/reload`.
You can still paste by hand whenever you like.

**If the Companion doesn't find WoW:** under **World of Warcraft folder**, click
**Choose folder…** and pick the `World of Warcraft` folder, the one that holds the
`_…_` client folders. Then click **Save**. **Upload now** sends the latest exports
straight away.

## 7. Keep it fresh

Cards like **Recent dings** and **Last seen** only change when a new guild export
arrives. Officers: re-export the guild at least once a week, or run the Companion
so it happens every time you log out. Members: re-export after a raid or a few
levels, or let the Companion do it.

## 8. Troubleshooting

- **When did I last export?** Type `/rl status`. It shows your last export times
  and how many boss pulls are recorded.
- **"Already imported — this export has no new data."** Nothing changed since
  your last import. Export again later.
- **"This export is older than the data already imported."** Someone already
  imported newer data. Export again and paste the new string.
- **The date doesn't match the server clock.** Raid Ledger refuses an export
  dated more than a day in the future or more than a year in the past. Check
  your computer's date and time, then export again.
- **"Different character".** You pasted another character's export. Add that
  character first (Add Character → **Import LedgerLink character**), then import there.
- **"Not in this guild".** The character that made the export isn't on that guild's roster.
- **"Pages missing".** Your guild export has several pages. Paste every page, once,
  in one box.
- **"String looks cut off" or "Not an import string".** Copy it again: click the
  text in the export window, then Ctrl+A and Ctrl+C. It must start with `!RL1!`.
- **"String too large".** Imports are capped at 256 KB. Big guilds usually hit
  this with Export all: export the guild on its own with `/rl export guild`, and
  your character with `/rl export char`.
- **"Unsupported addon version".** Update LedgerLink and export again.
- **Lua errors in game?** Type `/console scriptErrors 1`, try again, and report
  the error text on the
  [LedgerLink issue tracker](https://github.com/sjdodge123/ledger-link/issues).
