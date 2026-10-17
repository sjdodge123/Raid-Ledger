# Community Lineup

The Community Lineup is a structured way to pick the next game your community
will play together. It runs in phases: members nominate games, then vote, and
the top picks are auto-grouped into match cards your community can join or
rally around.

## Starting a Lineup

### From the Web App

1. Navigate to the **Games** page
2. If no lineup is active, click the **Start Lineup** button
3. Configure the lineup:
   - **Title** — Lineup name (defaults to "Lineup — Month Year")
   - **Description** — Optional context for members
   - **Phase durations** — How long building / voting / decided phases stay open (sliders)
   - **Votes per player** — Each voter's vote budget during the voting phase (1–10, default 3)
   - **Match threshold** — Minimum agreement % required to schedule a match
   - **Visibility** — `Public` (everyone in the community) or `Private` (invitees only)
   - **Public share link** — Toggle on to generate a sharable un-authed URL
4. Click **Create Lineup** — you land on the lineup detail page

### From Discord

Use the `/lineup start` slash command (admins/operators only):

```
/lineup start title:"April Game Night" votes-per-player:3
```

The bot announces the new lineup in the bound notification channel and
prompts members to nominate.

## Visibility

### Public Lineups

Visible to every authenticated member of the community. Lifecycle
notifications (created, voting opens, decided, archived) post to the bound
notification channel as Discord embeds. If you toggle **Public share** on,
the lineup also gets a slug-based URL like `/p/lineup/<slug>` that is
accessible without authentication.

### Private Lineups

Visible only to the creator and invited users. All lifecycle notifications
are sent as direct messages instead of channel embeds. The public share
endpoint always returns 404 for private lineups, even if the share toggle
is on — privacy wins.

## Phases

A lineup moves through four phases. Phase transitions can be automatic
(based on the configured durations) or manual (operators click the next
phase in the breadcrumb).

### 1. Building (a.k.a. Nominating)

Members suggest games via the **Nominate** button or the `/lineup nominate`
Discord command. You can search by name or paste a Steam store URL to
auto-fetch metadata. Each nomination shows up as a card on the lineup
detail page with the nominator's name and any optional note.

### 2. Voting

Each member spends their vote budget on the games they want to play.
Voting is open — every member sees the leaderboard update in real time
as votes are cast. A vote-count pill shows how many of your votes you've
used and flips to "waiting on N others" once you've spent them all.

### 3. Decided

The top vote-getter becomes the Champion. The detail page shows:

- **Podium** — Champion, Silver, Bronze cards with vote counts
- **Tiered match cards** — games grouped into "Scheduling Now",
  "Almost There", and "Rally Your Crew" tiers based on community
  match strength
- **Bandwagon UI** — join a match directly, or click "I'm interested"
  on lower-tier rows to signal demand
- **Carried Forward** — games from the previous decided lineup that are
  still active candidates for the new cycle

### 4. Archived

Once the lineup serves its purpose (matches have been scheduled, or an
operator manually archives it), it moves to archived. Archived lineups
remain viewable but no longer accept nominations or votes. Aborted
lineups also land here with an "Aborted by {operator}" notation.

## Tiebreaker Modes

When voting ends with two or more games tied for the top spot, the
operator is prompted to start a tiebreaker. There are three resolutions:

### Bracket

A single-elimination bracket with the tied games seeded by their
original vote count. Members vote on each round's matchups; the round
auto-advances when all expected voters have weighed in. Includes an
SVG bracket tree and a progress meter ("voted in X of Y matchups").

### Veto

Members submit blind vetoes against games they want to eliminate.
Vetoes are not revealed until everyone has voted or the round
deadline elapses. Total vetoes are capped at `games - 1` so at least
one game survives. The survivor (fewest vetoes, original vote count
as tiebreak) wins.

### Dismiss

The operator can dismiss the tiebreaker prompt and proceed to the
decided phase with default match logic. This is the fastest path when
the tie is between games the community would happily play either way.

### Operator Tools

- **Force-resolve** — operators can resolve any active tiebreaker
  immediately, even before all votes are in.
- **Late-join voting** — a member who arrives after the tiebreaker has
  started can still cast their vote as long as the round is `active`.

## Channel Override

By default, lineup notifications post to the channel bound under
**Channel Bindings → Lineup**. Per-lineup overrides let operators
target a different channel (e.g. a campaign-specific channel):

1. Open the lineup detail page as an operator
2. Click **Settings** → **Channel Override**
3. Pick the target channel from the dropdown (or enter a snowflake)

If the bot loses post permissions on the override channel mid-lineup,
the dispatcher logs a warning and falls back to the bound default
channel automatically.

## Public Share Link

Public lineups can be shared with people who don't have a Raid Ledger
account. Toggle **Public share** on either at creation or later via
the detail page's settings. The lineup gets a slug-based URL:

```
https://your-host/p/lineup/<slug>
```

The public page shows:

- Lineup title + status badge
- Decision block (Champion + match summary) — only when status is `decided`
- "Made with Raid Ledger" footer attribution
- No login form, no community navigation, no member-only details
  (voters, votes, invitees, nominees are all stripped from the public
  payload)

Toggling **Public share** off makes the same slug return a 404 page.

## Admin Abort

Operators can abort a lineup at any phase via the **Abort Lineup** button
on the detail page. The flow opens a confirmation modal with a required
reason field; submitting flips the lineup to archived and (for public
lineups) posts an "Aborted by {operator} — {reason}" embed to the bound
channel. Members do not see the Abort button.

## Edge Cases

- **Zero nominations.** A lineup that advances to voting with no games
  still renders without crashing; operators can abort it from the detail
  page.
- **Single voter.** Vote percentages and match scores stay numeric (no
  NaN, no Infinity) even with one voter.
- **Carryover.** Games from your most recent public decided lineup carry
  forward as suggestions on the next lineup, so popular-but-not-picked
  games don't drop off the radar.

## Next Steps

- [Channel Bindings](Channel-Bindings) — Bind a default notification channel
- [Notifications and Reminders](Notifications-and-Reminders) — DM cadence and reminder rules
- [Events and Scheduling](Events-and-Scheduling) — Schedule the games your lineup picks
