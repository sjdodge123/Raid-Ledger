# Plan: Community Lineup — Collaborative Game Picking

**Date:** 2026-03-22
**Status:** implemented — M1–M8 shipped (see `api/src/lineups/`); doc retained as design history
**Epic:** [ROK-929](https://linear.app/roknua-projects/issue/ROK-929)

## Problem Statement

Communities (~12 people) struggle to decide which game to play for recurring game nights. The decision process is async throughout the week, not a single live moment. Raid Ledger already knows what games members own, playtime, pricing, and player count support — it should use that data to streamline the decision.

The "Community Lineup" is a living shortlist of nominated games that the group narrows down through voting, with optional tiebreaker ceremonies (bracket, veto). Games that don't win carry over to future lineups, building a persistent shortlist over time.

## Affected Workspaces

- [x] `packages/contract` — shared types/schemas (`lineup.schema.ts`)
- [x] `api` — NestJS backend (lineups module, notifications, cron)
- [x] `web` — React frontend (Games page banner, lineup detail page)

## Contract Changes

New file: `packages/contract/src/lineup.schema.ts`

- Schema: `LineupStatusSchema`, `CreateLineupSchema`, `LineupEntryResponseSchema`, `LineupDetailResponseSchema`, `LineupBannerResponseSchema` (shipped names)
- DTO: `CreateLineupDto` — input for creating a new lineup
- DTO: `LineupDetailResponseDto` — full lineup detail with entries and votes

## Technical Approach

### Data Model

Three core tables (as shipped, plus later additions: `community_lineup_invitees`, four `community_lineup_tiebreaker*` tables, matches and user-submission tables — see `api/src/drizzle/schema/community-lineup*.ts`):

**`community_lineups`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `status` | enum | `building` / `voting` / `decided` / `archived` |
| `target_date` | date | nullable |
| `decided_game_id` | FK -> games | nullable, set when decided |
| `linked_event_id` | FK -> events | nullable, set after event creation |
| `created_by` | FK -> users | |
| `voting_deadline` | timestamp | nullable |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**`community_lineup_entries`** (nominations)
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `lineup_id` | FK -> community_lineups | CASCADE |
| `game_id` | FK -> games | CASCADE |
| `nominated_by` | FK -> users | CASCADE |
| `note` | text | nullable |
| `carried_over_from` | FK -> community_lineups | nullable |
| `created_at` | timestamp | |
| | UNIQUE | `(lineup_id, game_id)` |

**`community_lineup_votes`**
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `lineup_id` | FK -> community_lineups | CASCADE |
| `user_id` | FK -> users | CASCADE |
| `game_id` | FK -> games | CASCADE |
| `rank` | int | nullable, reserved for future ranked choice |
| `created_at` | timestamp | |
| | UNIQUE | `(lineup_id, user_id, game_id)` |

### API Module Structure

```
api/src/lineups/
├── lineups.module.ts
├── lineups.controller.ts
├── lineups.service.ts
├── lineups-query.helpers.ts
└── lineups.service.spec.ts
```

As shipped, the module grew far beyond this sketch: `api/src/lineups/` now holds ~125 files with sub-modules for `tiebreaker/`, `scheduling/`, `ai-suggestions/`, `queue/` (BullMQ phase transitions), `quorum/`, `standalone-poll/`, and `submit/`, plus a WebSocket gateway (`lineups.gateway.ts`) and a public share controller (`public-lineup.controller.ts`).

### API Endpoints

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/lineups` | Create lineup | operator/admin |
| `GET` | `/lineups/:id` | Full detail with entries + votes | member |
| `GET` | `/lineups/active` | All lineups currently in building/voting status (array; was singular pre-ROK-1065) | member |
| `PATCH` | `/lineups/:id/status` | Transition status | operator/admin |
| `GET` | `/lineups/common-ground` | Ownership overlap query | member |
| `POST` | `/lineups/:id/nominate` | Add game to lineup | any member |
| `DELETE` | `/lineups/:id/nominations/:gameId` | Remove own nomination | member |
| `POST` | `/lineups/:id/vote` | Toggle a vote on one game (call again to retract; per-lineup vote budget) | member |
| `POST` | `/lineups/:id/tiebreaker` | Start bracket or veto | operator/admin |
| `POST` | `/lineups/:id/tiebreaker/bracket-vote` | Bracket matchup vote (shipped controller also exposes `GET`, `POST .../dismiss`, `POST .../resolve`) | member |
| `POST` | `/lineups/:id/tiebreaker/veto` | Cast veto | member |

### Games Page Integration

`LineupBanner` component on `/games` when an active lineup exists:
- Status bar with pulsing dot + "COMMUNITY LINEUP" + target date
- "What are we playing this week?" heading + status badge (Building/Voting)
- Scrollable nomination thumbnails with vote count badges and ownership counts
- CTAs: "View Lineup & Vote" (primary) + "Nominate" (secondary)

### Lineup Detail Page (`/community-lineup/:id`)

Single route, content transforms based on lineup status:
- **Building** — nomination grid (2-col desktop, 1-col mobile), Common Ground panel, progress bar
- **Voting** — tournament leaderboard with ranked rows, vote bars, deadline display
- **Decided** — podium (2nd-1st-3rd), Also Ran section, carry forward tags, lineup stats
- Collapsible activity timeline at top in all states (reuses `ActivityTimeline` from ROK-930)

### Discord Notifications

Channel embeds (guild text channel): lineup created, nomination milestones, voting opened, winner announced, tiebreaker started.

Player DMs: voting opened (all members), reminders at 24h and 1h before deadline (non-voters only), winner announced (all members), nomination removed by operator (nominator only).

New notification preference toggle: "Community Lineup" (controls DMs only; channel embeds are guild-level).

### Carryover Mechanism

When a lineup transitions to `decided`, all unchosen nominations (2nd place and below) are eligible for carryover. When a new lineup is created, those entries are auto-copied with `carried_over_from` set. Carried entries show the original nominator and "carried over from [date]". Operators can manually remove carried entries.

### Post-Decided: Matches & Scheduling (shipped post-plan)

As shipped, the lifecycle continues past `decided`: a matching algorithm (`match_threshold`) groups voters into per-game **matches** (`GET`/`POST /lineups/:id/matches...`), and an optional **scheduling poll** phase after Decided (`include_scheduling_phase`, ROK-1302) at `/community-lineup/:lineupId/schedule/:matchId` culminates in event creation.

### Alternatives Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Embed in event lifecycle | Unified flow, no new models | Couples game selection to event creation; lineup is conceptually separate | Rejected |
| Standalone page (`/community-lineup`) | Clean separation | Disconnected from game browsing; users must navigate away from Games page | Evolved into current approach |
| Games page integration with detail route | Discoverable banner on existing page; dedicated detail page for depth | Slightly more complex routing | **Selected** |
| Discord-only (bot commands) | No web UI needed | Poor UX for browsing/voting; no visual presentation of ownership data | Rejected |

## Milestones

### M1: Schema & Foundation
[ROK-933](https://linear.app/roknua-projects/issue/ROK-933)

- **Workspace(s):** contract, api
- **Scope:** Database migration, Drizzle schema, Zod contract schemas, CRUD API
- **Acceptance Criteria:**
  - [ ] Migration creates all 3 tables with FKs and unique constraints
  - [ ] Drizzle schema matches migration with proper relations
  - [ ] Contract exports all lineup schemas and DTOs
  - [ ] `POST /lineups` creates a new lineup (operator/admin only)
  - [ ] `GET /lineups/:id` returns lineup detail with entries and votes
  - [ ] `GET /lineups/active` returns active lineups (shipped: array of all building/voting lineups, ROK-1065)
  - [ ] Status transitions enforced: `building -> voting -> decided -> archived`
  - [ ] Only one lineup can be in `building` or `voting` status at a time — superseded by ROK-1065: multiple lineups may be in `building`/`voting` simultaneously (each with `public`/`private` visibility); the single-active constraint was removed
  - [ ] Unit tests for service and status transition logic
- **Complexity:** M
- **Dependencies:** None

### M2: Common Ground
[ROK-934](https://linear.app/roknua-projects/issue/ROK-934)

- **Workspace(s):** api, web
- **Scope:** Ownership overlap query endpoint and UI component showing games owned by N+ community members, filtered by player count. Surfaces both library and wishlist owners with badge distinction.
- **Acceptance Criteria:**
  - [ ] Endpoint returns games with ownership counts and pricing
  - [ ] Results include both library and wishlist owner counts with clear distinction
  - [ ] Player count filter works when game metadata supports it
  - [ ] Sorting algorithm prioritizes on-sale + high-ownership games
  - [ ] UI shows ownership badges (library vs wishlist), sale status, early access
  - [ ] "+ Nominate" from Common Ground adds game to active lineup
  - [ ] Playwright smoke test: common ground section renders, filters work
- **Complexity:** M
- **Dependencies:** M1

### M3: Nominations & Detail Page
[ROK-935](https://linear.app/roknua-projects/issue/ROK-935)

- **Workspace(s):** api, web
- **Scope:** Nomination endpoints, Games page banner, and lineup detail page with compact grid layout
- **Acceptance Criteria:**
  - [ ] `POST /lineups/:id/nominate` adds game with optional note
  - [ ] `DELETE /lineups/:id/nominations/:gameId` removes own nomination
  - [ ] Duplicate game nomination returns 409
  - [ ] Nomination cap enforced (shipped as dynamic `max(20, participants × 5)` via `nominationCap()`)
  - [ ] `LineupBanner` on Games page shows active lineup status + CTAs
  - [ ] Banner hidden when no active lineup exists
  - [ ] `/community-lineup/:id` detail page renders nomination grid
  - [ ] Nomination cards show ownership, pricing, badges, notes, carryover status
  - [ ] Activity timeline collapsible at top of detail page
  - [ ] Responsive: 2-col grid desktop, 1-col mobile
  - [ ] Playwright smoke tests: banner renders, nomination flow works (desktop + mobile)
- **Complexity:** L
- **Dependencies:** M1, M2, ROK-930 (ActivityTimeline component)

### M4: Voting
[ROK-936](https://linear.app/roknua-projects/issue/ROK-936)

- **Workspace(s):** api, web
- **Scope:** Voting endpoints, tournament-style leaderboard UI, deadline enforcement, vote tallying
- **Acceptance Criteria:**
  - [ ] `POST /lineups/:id/vote` toggles a vote on a single game (shipped: per-lineup vote budget, default 3)
  - [ ] Voting rejected when status != `voting`
  - [ ] Votes can be changed before deadline
  - [ ] Deadline transitions ship as BullMQ delayed jobs on the lineup-phase queue (`phase-transition` + quorum `grace-advance`, ROK-946/ROK-1253); cron is used only for the 24h/1h reminders
  - [ ] Tie detection: stays in `voting` if no clear winner
  - [ ] Tournament leaderboard renders with vote bars and rank badges
  - [ ] Voted games show emerald accent + checkmark
  - [ ] "2 of 3 votes used" status shown
  - [ ] Activity timeline shows voting events
  - [ ] Playwright smoke tests: voting flow, results display
- **Complexity:** L
- **Dependencies:** M1, M3

### M5: Decided + Carryover
[ROK-937](https://linear.app/roknua-projects/issue/ROK-937)

- **Workspace(s):** api, web
- **Scope:** Decided state UI with podium display, automatic carryover of unchosen nominations, manual event creation from winning game
- **Acceptance Criteria:**
  - [ ] Podium renders 1st/2nd/3rd with crown, medals, vote counts, ownership, pricing, badges
  - [ ] "Create Event" opens event form pre-filled with winning game
  - [ ] `linked_event_id` updated after event creation
  - [ ] Auto-carryover: unchosen entries copied to next lineup on creation
  - [ ] Carried entries show `carried_over_from` date and original nominator
  - [ ] Operator can remove carried entries from new lineup
  - [ ] "Also Ran" section shows remaining games with vote bars
  - [ ] Activity timeline shows full lineup history
  - [ ] Playwright smoke tests: decided view renders, event creation flow
- **Complexity:** M
- **Dependencies:** M4

### M6: Discord Notifications
[ROK-932](https://linear.app/roknua-projects/issue/ROK-932)

- **Workspace(s):** api
- **Scope:** Channel embeds and player DMs at key lifecycle points; notification preference toggle; cron-based vote reminders
- **Acceptance Criteria:**
  - [ ] Channel embed posted when lineup enters building status
  - [ ] Channel embed updated at nomination milestones
  - [ ] Channel embed + DMs sent when voting opens with deadline
  - [ ] DM reminders sent to non-voters at 24h and 1h before deadline
  - [ ] Channel embed + DMs sent when winner is decided (includes podium: 1st/2nd/3rd)
  - [ ] DM sent to nominator when their nomination is removed
  - [ ] "Community Lineup" toggle in user notification preferences controls all lineup DMs
  - [ ] Channel embeds not affected by user preference toggles
  - [ ] Graceful handling when user has DMs disabled or no linked Discord
- **Complexity:** M
- **Dependencies:** M1-M5 (lineup foundation through decided)

### M7: LLM Suggestions
[ROK-931](https://linear.app/roknua-projects/issue/ROK-931)

- **Workspace(s):** api, web
- **Scope:** LLM-powered nomination suggestions via the provider-agnostic `LlmService` (registry of Ollama / OpenAI / Claude / Google providers, `api/src/ai/providers/`) analyzing community play history, voter-specific preferences, and game metadata
- **Acceptance Criteria:**
  - [ ] LLM prompt includes historical play patterns, voter scope, current nominations, and game metadata
  - [ ] Suggestions scale strategy based on number of active voters (full group vs small group)
  - [ ] Results are cached per lineup round (re-generated on demand, not every page load)
  - [ ] Suggestion cards show reasoning and ownership overlap
  - [ ] Feature degrades gracefully when no AI provider is configured
  - [ ] Unit tests for prompt construction and response parsing
- **Complexity:** L
- **Dependencies:** ROK-542 (Ollama Foundation — shipped as the provider-agnostic `LlmService`), M1-M3

### M8: Tiebreakers
[ROK-938](https://linear.app/roknua-projects/issue/ROK-938)

- **Workspace(s):** api, web
- **Scope:** Optional tiebreaker modes — bracket (head-to-head elimination) and veto (each member vetoes one game)
- **Acceptance Criteria:**
  - [ ] Bracket: operator can initiate with top N games
  - [ ] Bracket: head-to-head matchups with member voting
  - [ ] Bracket: single elimination to winner
  - [ ] Bracket: tournament tree visualization
  - [ ] Veto: each member gets one veto
  - [ ] Veto: last standing or vote-count fallback determines winner
  - [ ] Veto: strikethrough visualization on eliminated games
  - [ ] Discord notification when tiebreaker starts
  - [ ] Transitions to `decided` when tiebreaker resolves
  - [ ] Playwright smoke tests: bracket and veto flows
- **Complexity:** L
- **Dependencies:** M4, M6

### Related: Activity Timeline
[ROK-930](https://linear.app/roknua-projects/issue/ROK-930)

- **Workspace(s):** web, api
- **Scope:** Reusable `ActivityTimeline` component in `web/src/components/common/` with event detail page integration. Designed generically to serve both event and lineup features.
- **Note:** Not a lineup milestone per se, but M3 depends on this component. Designed alongside the lineup feature.

## Resolved Questions

- [x] **Who can initiate a lineup?** Operators/admins only (via `POST /lineups`)
- [x] **Who can nominate?** Any guild member
- [x] **Voting model?** Toggle-vote with a per-lineup vote budget — configurable 1–10 votes per player, default 3 (ROK-976). `rank` column reserved for future ranked choice.
- [x] **Common Ground scope?** Includes both Steam library owners AND wishlist owners with badge distinction (emerald for library, amber for wishlist). Also shows early access and sale badges. Algorithmic sorting favors on-sale + high-ownership games.
- [x] **Max nominations?** Dynamic cap: `max(20, participants × 5)` per lineup (fixed 20 was superseded by `nominationCap()`)
- [x] **Event creation from winner?** Manual button ("Create Event") — not automatic. Pre-fills the event form with the winning game. One-way link: lineup -> event.
- [x] **Scope?** Per-guild. Originally one active lineup (building or voting) at a time — superseded by ROK-1065: multiple lineups may be active simultaneously.
- [x] **Visibility?** (added post-plan) Lineups carry a `visibility` mode — `private` lineups restrict nominate/vote to an invitee roster (`community_lineup_invitees`, ROK-1065) and suppress channel embeds; `public` lineups can additionally be shared un-authed at `/p/lineup/:publicSlug` (ROK-1067).

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Low adoption if nomination/voting UX feels heavy | Medium | High | Games page banner provides low-friction entry point; pick-3 is simpler than ranked choice |
| Common Ground query slow on large game libraries | Low | Medium | Index on ownership table; paginate results; cache per-lineup |
| Voting ties require manual intervention | Medium | Low | Tiebreaker modes (M8) provide structured resolution; operator can also extend deadline |
| AI provider dependency adds infrastructure complexity | Medium | Medium | Graceful degradation — feature hidden when no AI provider is configured (provider-agnostic `LlmService`); LLM suggestions are enhancement, not core |
| Carryover accumulation clutters future lineups | Low | Low | Operators can manually remove carried entries; consider auto-expiry after N lineups |
| Notification fatigue from lineup lifecycle DMs | Medium | Medium | Per-category DM toggle; milestone-based channel embeds (not per-nomination) |

## Open Questions

- [ ] **Carryover UX** — Should carried-over games be visually distinct enough to encourage fresh nominations, or subtly integrated? How many rounds should a game carry over before auto-expiring?
- [ ] **Bracket size** — Should bracket tiebreakers always use top 4, or allow top 8? What if there are fewer tied games than the bracket size?
