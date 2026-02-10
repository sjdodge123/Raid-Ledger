# Task: ROK-106 Event Management Epic

> 📋 **Council Decision #004 Active** — See `planning-artifacts/council-decisions.md`
> Phase 1.5: ✅ Complete (ROK-161 done)
> Phase 2 (Current): Calendar Epic + Landing Page Pivot + ROK-157

## ✅ ROK-107 - IGDB Game Discovery (COMPLETE + REVIEWED)
- [x] IGDB module with OAuth2 caching
- [x] Code review fixes (9 issues)
- [x] Tests passing (14/14)

## ✅ ROK-108 - Event CRUD API (COMPLETE + REVIEWED)
- [x] Events module with CRUD
- [x] Code review fixes (4 issues)
- [x] Tests passing (18/18)

## ✅ ROK-109 - Native Sign-Up Logic (COMPLETE + REVIEWED)
- [x] event_signups database table
- [x] Zod schemas (signups.schema.ts)
- [x] SignupsService (signup/cancel/getRoster)
- [x] Controller endpoints
- [x] Auto-signup on event creation (AC-5)
- [x] Tests passing (8/8)

## ✅ ROK-110 - Event List & Details UI (COMPLETE + REVIEWED)
- [x] React Query infrastructure + API client
- [x] EventsPage with responsive grid
- [x] EventDetailPage with roster, signup/cancel
- [x] Auth integration (use-auth.ts hook)
- [x] Toast notifications (sonner)
- [x] signupCount in event response (N+1 eliminated)
- [x] Keyboard accessibility + image fallbacks
- [x] Tests passing (11/11)

## ✅ UX Design Session (2026-02-03)
- [x] Generated 27 UX mockups (saved to `planning-artifacts/ux-mockups/`)
- [x] Updated `ux-design-specification.md` with:
  - Multi-Game Context & Dynamic Availability
  - Extended Component Library (8 components)
  - WoW Data Integration & Character Management
  - Discord Bot Integration
- [x] Key mockups created:
  - Heatmap Grid, Roster Builder, Mobile Check-In
  - Multi-Game Heatmap (4 availability states)
  - Context-Aware RosterCards (WoW/Valheim/General)
  - Character Management (Main/Alt designation)
  - Sign-Up Character Confirmation modal
  - Discord Notification Flow (5 stages)

## ✅ Architecture Revision (2026-02-03)
- [x] Updated `architecture.md` for UX alignment:
  - Multi-Game Support (games, event_types tables)
  - Character Management (Main/Alt model)
  - External Integrations (Blizzard, Raider.IO, WCL OAuth)
  - Discord Bot Components (embed/button builders)
- [x] Created 10 new implementation stories

---

# Upcoming Epics & Stories

## ROK-128: Multi-Game & Character Management (NEW)
- [x] ROK-129: Games Module & Seed Data (COMPLETE)
- [x] ROK-130: Characters CRUD + Main/Alt Designation (COMPLETE + REVIEWED)
  - [x] `characters` table with unique partial index for single main per game
  - [x] Zod schemas (`characters.schema.ts`)
  - [x] CharactersService (CRUD + setMain with atomic swap)
  - [x] CharactersController (5 endpoints under `/users/me/characters`)
  - [x] Tests passing (12/12)
  - [x] Code review fixes: unique index, race condition, transaction tests
  - [x] Migrations applied (0004, 0005)
- [x] ROK-131: Sign-Up Character Confirmation (COMPLETE + REVIEWED)
  - [x] Database schema extended (character_id FK, confirmation_status)
  - [x] Backend API (confirmSignup endpoint, getRoster with character)
  - [x] SignupConfirmationModal component with main/alt display
  - [x] Modal integrated into EventDetailPage
  - [x] Code review fixes: modal integration, gameId filter, pre-select main
  - [x] Tests passing (77/77)

## ✅ ROK-139: Dev Environment Hotfixes (COMPLETE)
- [x] CORS configuration with production validation
- [x] Postgres Date handling fix for upcoming events
- [x] Contract package exports fix (ESM/CJS)
- [x] Test mock fixes for subquery chain
- [x] Site running locally (http://localhost:5173)

## ROK-120: Server Integrations & DevOps
- [ ] ROK-132: Docker Containerization (backlog)
  - Dockerfiles for API and Web
  - docker-compose with all services
  - Health checks and volumes

---

# 🎯 Demo Sprint (Priority)

## ✅ Tier 1: Critical for Demo (COMPLETE)
- [x] **ROK-140: Create Event Form**
  - "Create Event" button + form with game search
  - Date/time pickers, validation, submit
- [x] **ROK-141: Landing Page & Navigation**
  - Hero landing page at `/`
  - Global header with nav and user menu
  - Mobile hamburger menu
- [x] **ROK-142: User Profile & Character Management UI**
  - `/profile` page showing user's characters
  - Set main, add/edit/delete characters

## 🚨 HIGH PRIORITY (Blocking Demo)

- [x] **ROK-152: Fix GHCR Docker Build** ✅
  - [x] `.gitignore` excludes `api/scripts/docker-entrypoint.sh`
  - [x] Update `.gitignore` pattern to allow `api/scripts/`
  - [x] Commit missing entrypoint script to git
  - [x] Verify GitHub Action passes (Build #2 succeeded, 9m 2s)

- [x] **ROK-153: Browser E2E Verification Workflow** ✅
  - [x] Create `/verify-ui` workflow using agent's `browser_subagent`
  - [x] NO external dependencies (Playwright/Cypress not needed)
  - [x] Verify: landing ✅, login ✅, events ❌ (API 500), profile ⚠️ (auth)
  - [x] Capture screenshots/recordings as proof of work
  - [x] Documented in AGENTS.md

- [x] **ROK-154: Events API 500 Error** ✅
  - **Root cause:** Docker prod compose was running (port 5432 not exposed to host)
  - **Fix:** Switched to dev compose, recreated DB volume, applied migrations
  - Both `/events` and `/events?upcoming=true` now return 200 OK
  - **Note:** This was an environment issue, not a code bug

- [x] **ROK-162: Playwright MCP Integration** ✅
  - [x] Installed `@playwright/test` and Chromium browser
  - [x] Created `playwright.config.ts` (30s timeout, screenshots on failure)
  - [x] Created `scripts/verify-ui.spec.ts` (5 tests: Landing, Login, Events, Event Detail, Profile)
  - [x] Updated `/verify-ui` workflow to use `npx playwright test`
  - [x] Documented in AGENTS.md section 7

## Tier 2: Polish (NEXT PRIORITY)
- [x] **ROK-143: Event Cards UI Polish** ✅
  - [x] Status badges (Upcoming/Live/Ended) with color coding
  - [x] Relative time display ("in 2 hours", "started 30 min ago")
  - [x] Enhanced hover effects with shadow
  - [x] Empty state component with illustration and CTA
  - [x] 29 tests passing (16 event-card, 9 roster-list, 4 empty-state)
- [x] **ROK-144: Auth Flow Polish** ✅
  - [x] ProtectedRoute wrapper with redirect preservation
  - [x] OAuth error handling with user-friendly toasts
  - [x] Session expiry toast notifications
  - [x] Discord login button loading state
  - [x] 37 tests passing

## Tech Debt
- [ ] **TD-001: Fix hardcoded game ID in profile-page.tsx**
  - Currently uses hardcoded WoW UUID instead of game-registry
  - CharacterList should display game name, not just count
- [ ] **TD-002: Add rate limiting to auth endpoints**
  - `/auth/local` endpoint vulnerable to brute-force attacks
  - Add endpoint-specific throttling (e.g., 5 attempts per minute)
- [ ] **TD-003: First-Time Admin Setup Wizard**
  - Redirect new admin to setup flow instead of requiring `/login` route
  - Guided steps: login, change password, link Discord (optional)
  - Skip linking if user chooses; show default admin avatar
- [ ] **TD-005: Default Admin Avatar**
  - Show fallback avatar icon when user has no Discord avatar
  - Generic user silhouette or Admin badge in header/menu
- [ ] **TD-006: Research GitHub Action Build Time** (Low Priority)
  - Current build takes ~9 minutes — investigate why
  - Consider: Layer caching, multi-arch build time, dependency optimization
  - Goal: Reduce to <5 minutes for faster CI feedback
- [ ] **TD-007: Add delete confirmation for availability windows** (ROK-112 Review)
  - `handleDeleteAvailability()` in profile-page.tsx deletes immediately
  - Should show confirmation dialog before destructive action
- [ ] **TD-008: Accessibility improvements for AvailabilityCard** (ROK-112 Review)
  - Add `aria-label` attributes to Edit/Delete icon buttons
  - Currently only has `title` which screen readers may not announce
- [ ] **TD-009: Fix datetime-local timezone edge case** (ROK-112 Review)
  - `formatDateTimeLocal()` in AvailabilityForm may produce incorrect results near DST
  - Use date-fns or similar library for robust handling
- [ ] **TD-010: Modal keyboard trap and escape handling** (ROK-112 Review)
  - AvailabilityForm modal doesn't trap focus or handle Escape key
  - Should use radix-ui Dialog or implement focus trap
- [ ] **TD-012: Fix system.controller.spec.ts test failures** (Code Review)
  - 4 failing tests related to dependency injection in system controller
  - Tests can't resolve SettingsService dependencies
- [ ] **TD-013: Fix login-page.test.tsx test failure** (Code Review)
  - Test expects single password label but finds multiple elements
  - Need to update test selector or fix duplicate label IDs

---

# Backlog (After Demo)

## ROK-132: External Data Integrations
- [ ] ROK-133: Blizzard OAuth Integration (ready-for-dev)
- [ ] ROK-134: Raider.IO API Integration (ready-for-dev)
- [ ] ROK-135: WarcraftLogs API Integration (ready-for-dev)
- [ ] ROK-136: Character Stats Sync Job (ready-for-dev)

## ROK-116: Discord Bot Integration (Enhanced)
- [ ] ROK-117: Bot Module Infrastructure (backlog)
- [ ] ROK-118: Event Notification Embeds (backlog)
- [ ] ROK-137: Interactive Signup Buttons (ready-for-dev)
- [ ] ROK-138: Character Select Ephemeral (ready-for-dev)
- [ ] ROK-119: Bidirectional Syncing (backlog)
- [ ] ROK-126: Event Reminder Job (backlog)

### Notification System (SPLIT per Council 2026-02-06)
- [x] **ROK-197: Notification Core Infrastructure** — ✅ COMPLETE + REVIEWED
  - [x] Database schema (notifications, preferences tables)
  - [x] NotificationService (create, query, mark read, cleanup)
  - [x] In-app notification bell + dropdown
  - [x] Code review fixes (8 issues): index, pagination, docs, cleanup method
  - [x] Migration 0015 (composite index for performance)
- [ ] **ROK-204: Browser Push Notifications** — 🟡 P1
  - Web Push API integration
  - Permission flow + subscription storage
  - **Depends on:** ROK-197
- [ ] **ROK-205: Presence-Aware Notification Sync** — 🟢 P2 (Phase 3)
  - Cross-channel read status sync
  - Read on Discord → marked read in web
  - **Depends on:** ROK-197, ROK-199
- [ ] **ROK-198: Notification Preferences UI** — 🟡 P1
  - Settings panel on profile page (private section)
  - Channel toggles + category toggles + game subscriptions grid
  - **Depends on:** ROK-197, ROK-195
- [ ] **ROK-199: Discord Bot Welcome & Dispatch** — 🟡 P1 (Phase 3)
  - Welcome DM when Discord notifications enabled
  - Notification dispatch routing
  - **Depends on:** ROK-197, ROK-117
- [ ] **ROK-206: Notification Real-time Updates** — 🟢 P2 (Phase 3)
  - Polling/WebSocket for live bell badge updates
  - **Depends on:** ROK-197

## 🎯 ROK-111: Availability & Roster (CURRENT SPRINT - Phase 1.5)
> **Story files created:** See `implementation-artifacts/stories/`
> **Sprint plan:** See `planning-artifacts/sprint-phase-1.5.md`

- [x] **ROK-112: Availability Service (tsrange)** ✅
  - [x] `availability` table with tsrange (migration 0009)
  - [x] Zod schemas (`availability.schema.ts`)
  - [x] AvailabilityService (CRUD + conflict detection)
  - [x] AvailabilityController (5 REST endpoints)
  - [x] Frontend hooks (`use-availability.ts`)
  - [x] Frontend components (AvailabilityList, Card, Form)
  - [x] Profile Page "My Availability" section
  - [x] Tests passing (21/21 — 13 service, 8 controller)
- [x] **ROK-113: Heatmap Grid Component** ✅
  - [x] Backend: `GET /events/:id/roster/availability` endpoint
  - [x] Frontend: HeatmapGrid, AvailabilityCell, HeatmapTooltip components
  - [x] Integration: Team Availability section on Event Detail Page
  - [x] Bug fix: `inArray()` for userIds in availability.service.ts
  - [x] Tests passing (98/98)
- [x] **ROK-114: Roster Tetris (Drag-and-Drop)** ✅
  - [x] RosterBuilder component with dnd-kit integration
  - [x] RosterSlot, RosterCard components
  - [x] useRoster hook for data fetching/updates
  - [x] Integration in Event Detail Page (creator only)
  - [x] Tests passing
- [x] **ROK-115: Flash Check-In (Zero-Click)** — ⚠️ DEPRECATED
  - Replaced by organizer attendance tracking (post-event)
  - See ROK-203 for event reminder notifications

### Game Time System (Council Decision 2026-02-06)
- [ ] **ROK-189: Weekly Game Time Selector** — 🟡 P1
  - Paintable heatmap for weekly template
  - Drag-select time blocks
  - **Depends on:** ROK-112 ✅
- [ ] **ROK-201: Weekly Game Time Check-In** — 🟡 P1 (NEW)
  - Sunday notification to confirm/tweak weekly schedule
  - Admin-configurable check-in day
  - 3-month inactivity clears game time
  - **Depends on:** ROK-189, ROK-197
- [ ] **ROK-202: First-Time User Game Time Setup** — 🟡 P1 (NEW)
  - Onboarding flow for new users
  - Same paintable heatmap component
  - **Depends on:** ROK-189
- [ ] **ROK-203: Event Reminder Notifications** — 🟡 P1 (NEW)
  - Day-of and starting-soon reminders
  - Reminders only (no check-in)
  - **Depends on:** ROK-197

### Council Decision #003 Stories (2026-02-04)

- [x] **ROK-156: Event Detail Layout (Desktop)** ✅
  - [x] 60/40 split layout (lg:grid-cols-5 → 3/2)
  - [x] Heatmap always visible (no toggle)
  - [x] Skeleton loader matches new layout

- [ ] **ROK-157: Event Detail Layout (Mobile)** — 🟡 P1 → **Moved to Phase 2**
  - AvailabilityCardList component (cards instead of grid)
  - ResponsiveHeatmap wrapper with media query
  - Depends on: ROK-156, Calendar/Event Detail integration

- [x] **ROK-158: Testing Infrastructure Hardening** — ✅
  - [x] `GET /health` endpoint with DB connectivity check (200/503)
  - [x] Docker healthchecks for db, redis, api services
  - [x] `test` profile with web service in docker-compose.yml
  - [x] `seed-testing.ts` for signups/availability fixtures
  - [x] Tests passing (101/101)

- [x] **ROK-160: Game Seed Expansion (IGDB)** — ✅
  - [x] Static seed file with 48 games (MMORPGs, survival, shooters, co-op, competitive)
  - [x] Real IGDB IDs as canonical (prevents duplicates)
  - [x] `api/seeds/games-seed.json` + `seed-igdb-games.ts` script
  - [x] Docker entrypoint runs seed in DEMO_MODE
  - [x] Documentation updated (AGENTS.md, .env.example)

- [ ] **ROK-161: IGDB Rate Limit Protection** — 🟡 P1
  - Search result caching (24h TTL)
  - 429 retry with exponential backoff
  - Debounce on frontend search input

---

## 🗓️ ROK-170: Calendar Epic (PHASE 2 — NEXT)
> **Council Decision #004** — Calendar as home page, tool-first UX
> **Story files:** See `implementation-artifacts/stories/ROK-170.md` through `ROK-176.md`
> **Mockups:** See `planning-artifacts/ux-mockups/calendar/`

### Landing Page Pivot
- [x] **ROK-176: Remove Marketing Landing Page** — ✅
  - [x] Delete hero/marketing content
  - [x] Redesign login page (centered card, glassmorphism)
  - [x] Community name configuration via env
  - [x] First-run hint for admin credentials

### Calendar Implementation
- [x] **ROK-174: Calendar API (Date Range)** — ✅
  - [x] `startAfter`/`endBefore` query params
  - [x] Efficient range queries for month/week views
- [x] **ROK-171: Calendar Month View** — ✅
  - [x] `/calendar` route with navigation link
  - [x] Month grid with react-big-calendar + date-fns
  - [x] Event chips with click-to-detail navigation
  - [x] Custom toolbar (prev/next/today, month/year display)
  - [x] Dark glassmorphism theme CSS
  - [x] Loading and empty states
  - [x] Desktop sidebar with mini-calendar and quick actions
- [x] **ROK-175: Calendar as Default Route** — ✅
  - [x] Authenticated users redirect to `/calendar`
  - [x] Post-login redirect to `/calendar` (local + OAuth)
  - [x] Deep-link preservation via sessionStorage
  - [x] First-run welcome toast with localStorage flag
- [x] **ROK-172: Calendar Week View** — ✅ COMPLETE
  - [x] Time-slot week grid
  - [x] Event blocks spanning duration
  - [x] Game art backgrounds and details preview
  - [x] Full-width event blocks with title, game, time, signups
  - [x] View toggle with URL/localStorage persistence
  - [x] Game filter shows current view only (bug fix)
  - [x] Fixed infinite 404 loop (default-avatar.svg)
  - [x] Unit tests (11 tests)

- [ ] **ROK-182: IGDB Admin Configuration Panel** — 🟡 P2
  - Add IGDB section to `/admin/settings` page
  - UI to configure IGDB Client ID and Client Secret in database
  - Store credentials in settings table (encrypted)
  - Hot-reload IGDB service on credential change
  - Show connection status (valid/invalid credentials)
  - **Depends on:** ROK-146

- [x] **ROK-177: Week View Attendee Avatars** — 🟡 P1 (COMPLETE)
  - [x] Contract: Added `signupsPreview` to `EventResponseSchema` and `includeSignups` to `EventListQuerySchema`
  - [x] API: `getSignupsPreviewForEvents()` helper with batched query (no N+1)
  - [x] Frontend: `AttendeeAvatars` component with overlapping avatars, initials fallback, +N badge
  - [x] Integration: Week/Day views show attendee avatars when signupsPreview available
  - [x] Unit tests: 9 tests passing for AttendeeAvatars component
  - Discord activity status (deferred Phase 3)
- [ ] **ROK-173: Calendar Mobile Responsive** — 🟡 P1
  - Agenda list view on mobile
  - Infinite scroll for dates
  - FAB for create event
- [x] **ROK-178: Calendar Day View** — ✅
  - Single-day detailed view with time slots
  - Day navigation (prev/next/today)
  - Reuse WeekEventComponent styling
- [ ] **ROK-179: IGDB Artwork Integration for Calendar** — 🟡 P1
  - Game artwork in calendar tiles
  - Different sizes per view (month chip, week block, day detail)
  - **Depends on:** ROK-178 ✅
- [ ] **ROK-180: Contextual Back Navigation** — 🟡 P1
  - "Back to" button returns to originating view
  - Calendar → Event Detail → Calendar (same date)
  - **Depends on:** None

- [ ] **ROK-200: User Feedback Widget** — 🟡 P1 (NEW)
  - Floating help icon in sidebar (always visible)
  - Quick capture modal: Bug 🐛 | Feedback 💡 | Frustration 😤
  - Auto-captures: console errors, page state, optional screenshot
  - Creates GitHub issue on submit
  - **Depends on:** None

### Event Detail Polish (Council Decision #005)
- [x] **ROK-182: Team Availability → Event Creation** — ✅
  - Heatmap moved from Event Detail to Event Create/Edit
  - Helps organizers pick optimal time slots
- [ ] **ROK-185: Event Details Mobile (Stories UI)** — 🟢 P2 (Phase 3)
  - Instagram-style stories layout on mobile
  - Swipe between events
  - **Depends on:** ROK-184 ✅
- [x] **ROK-157: Event Detail Layout (Mobile)** — ⚠️ DEPRECATED
  - Superseded by ROK-182 + ROK-185 per Council Decision #005

### Universal Roster & Quick-Join (Council Decision #005)
- [x] **ROK-183: Universal Roster Builder + Quick-Join** — ✅
  - Universal roster that works for all game types (not just MMOs)
  - Double-click to claim a slot pattern
  - Role buttons for MMO games, generic player slots for others
  - **Depends on:** ROK-156

- [x] **ROK-184: Event Details Page Redesign (Desktop)** — ✅
  - Game banner header with cover art
  - Unified layout with roster as primary focus
  - Glow effects and premium visual polish
  - **Depends on:** ROK-183 ✅

### User Profile Enhancements
- [x] **ROK-186: Calendar Avatar Overflow Fix** — ✅
  - Fixed avatar overlap/overflow in week view tiles

- [ ] **ROK-187: User Timezone Preferences** — 🟡 P1
  - User can set preferred timezone in profile
  - All event times display in user's timezone
  - **Depends on:** None

- [ ] **ROK-188: Delete User Account** — 🟢 P2
  - User can delete their account from profile
  - Cascades to characters, signups, availability
  - **Depends on:** None

- [x] **ROK-189: Weekly Availability Heatmap Selector** — ✅
  - Visual week grid to set recurring availability
  - Click-drag to select time blocks
  - **Depends on:** ROK-112

- [x] **ROK-194: Dynamic Avatar Resolution** — ✅ COMPLETE
  - [x] Avatar resolution utility (`resolveAvatar`)
  - [x] Character data in API responses (signups, roster)
  - [x] Component updates (AttendeeAvatars, RosterCard)
  - [x] Seed data with character avatars
  - [x] 14 unit tests passing
  - Falls back to Discord avatar when no character
  - **Depends on:** ROK-181 ✅

- [x] **ROK-195: Hub & Spoke Integration Model** — ✅ COMPLETE
  - Visual hub/spoke diagram on profile page
  - Center: player's chosen avatar (editable)
  - Spokes: Discord, Battle.net, Steam with status dots
  - Discord details modal with two-click unlink confirmation
  - Multi-strand pulse conduits with varied curvature (desktop + mobile)
  - Activation burst on successful Discord OAuth return
  - Full-page space background (nebula + stars)
  - DELETE /users/me/discord with unlink/relink persistence
  - **Depends on:** ROK-181 ✅, ROK-151 ✅

- [ ] **ROK-224: CSS Theme Token Migration** — 🟡 P1 (NEW)
  - Convert ~517 hardcoded slate/white Tailwind classes to semantic CSS variables
  - Define tokens via Tailwind 4 @theme directive
  - Zero visual regression — dark theme preserved exactly
  - **Depends on:** None
  - **Blocks:** ROK-124

- [ ] **ROK-124: Theme System (Light/Dark/Auto)** — 🟡 P1 (NEW)
  - Auto mode (system) is default
  - Profile settings + header quick toggle
  - DB sync for logged-in users
  - Extensible architecture for future custom themes
  - **Depends on:** ROK-195, ROK-224

- [ ] **ROK-196: Player Profile Demo Data** — 🟢 P2 (NEW)
  - Seeded characters with portraits across games
  - Event history section
  - Game preferences grid
  - **Depends on:** ROK-195

### Roster UX Improvements
- [x] ~~**ROK-190: Double-Click to Leave Slot**~~ — ⚠️ CANCELED
  - Replaced by ROK-226 (Player Self-Unassign from Roster Slot)

- [ ] **ROK-226: Player Self-Unassign from Roster Slot** — 🔴 P0
  - Same red X button admins have, but only on the player's own slot
  - Unassigns from slot (moves to unassigned pool), stays signed up
  - Fires `slot_vacated` notification to organizer (ROK-225)
  - **Depends on:** ROK-225 ✅

- [ ] **ROK-191: Calendar Day View Quick-Join** — 🟡 P1
  - Join events directly from calendar day view
  - Role buttons for MMO games, player buttons for generic
  - Same double-click pattern as roster
  - **Depends on:** ROK-190

- [x] **ROK-192: Event Detail Layout — Collapsible Banner** — ✅ DONE
  - Full cinematic banner collapses to slim sticky bar on scroll
  - Description absorbed into banner (no standalone card)
  - Responsive: mobile/tablet/desktop breakpoints
  - Tighter vertical spacing for roster visibility
  - **Depends on:** ROK-184 ✅

- [ ] **ROK-208: Click-to-Assign Roster Interaction** — 🔴 P0 (NEW)
  - Replace drag-and-drop with click-to-assign model
  - Admin clicks slot → assignment popup with role-sorted unassigned players
  - Regular user clicks slot → existing "+ Join" flow
  - Sticky "Unassigned" bar (rebranded from "Signup Pool")
  - Remove dnd-kit, override warnings, dashed borders
  - Responsive: bottom sheet (mobile), modal (tablet/desktop)
  - **Depends on:** ROK-192, ROK-183



## ROK-150: Docker Deployment & Admin Bootstrap
> **Goal:** Full containerized deployment with bootstrap auth and Discord account linking.
>
> **Flow:** Deploy → Login with bootstrap password → Link Discord in profile → Discord tied to admin account

### Phase 1: Docker Containerization
- [ ] **ROK-149: Docker Production Build** ⭐ (Priority)
  - `Dockerfile` for API (NestJS) and Web (Vite static build)
  - Add `api` and `web` services to `docker-compose.yml`
  - Nginx reverse proxy for unified port
  - Environment variable configuration
  - Database migrations on startup
  - **Depends on:** None

### Phase 2: Bootstrap Authentication
- [x] **ROK-145: Local Admin Auth (Username/Password)** ✅
  - `local_admins` table with bcrypt-hashed passwords
  - `/auth/local` login endpoint (email/password)
  - Docker entrypoint generates initial admin password
  - Print credentials to container logs on first run
  - Frontend login page at `/login`
  - **Depends on:** ROK-149 ✅

### Phase 3: Account Linking
- [x] **ROK-151: Link Discord Account** ⭐ (Key Feature) ✅
  - \"Link Discord Account\" button on `/profile` page
  - OAuth flow that links Discord to existing user (not create new)
  - Store `discord_id` on existing user record
  - After linking, user can login via Discord OR password
  - **Depends on:** ROK-145 ✅

### Phase 4: Admin Settings (Optional)
- [x] **ROK-146: Admin Settings Page** — ✅
  - `/admin/settings` route (admin-only)
  - UI to configure Discord OAuth credentials in database
  - Hot-reload OAuth strategy on credential change

- [ ] **ROK-193: Delete Demo Data Button** — 🟢 P2 (NEW)
  - Button in admin settings with confirmation dialog
  - Deletes: demo events, signups, availability, demo users
  - Preserves: IGDB games, admin users, real user data
  - **Depends on:** ROK-146 ✅

- [ ] **ROK-159: Admin Onboarding Wizard** — 🟡 P1 (Phase 2)
  - Step-by-step setup tutorial for first-time admins
  - Steps: Secure Account → Choose Games → Connect Data Sources → Done
  - Every step skippable, all settings in Admin Settings later
  - **Depends on:** ROK-133/134/135 (integrations)

---

## Session Progress (2026-02-06 Evening) — COMPLETE
- [x] ROK-192: Collapsible banner implemented, browser verified, committed `ce896a2`

---

## Session Progress (2026-02-06 Night) — COMPLETE
- [x] ROK-208: Click-to-assign roster interaction developed, browser-tested

---

## Session Progress (2026-02-07 Day)

- [x] Step 1: Loaded project context and guidelines
- [x] Step 2: Scanned stories, next number ROK-212
- [x] Step 3: Sprint status displayed — Sprint A complete, Sprint B next
- [x] Step 4: Active sprint path selected
- [x] Step 5: ROK-195 identified, then pivoted to roster-focused sprint
- [x] Step 6-7: ROK-212 (Seeded Role Accounts & Impersonation) story created
- [x] Step 8: Story review approved — admin dropdown for impersonation

---

## Session Progress (2026-02-07 Evening)

- [x] Step 1: Loaded project context and guidelines
- [x] Step 2: Scanned stories, next number ROK-215
- [x] Step 3: Sprint status — Sprint B active, ROK-195/ROK-189/ROK-190 next
- [x] Step 4: Active sprint path selected

---

## Session Progress (2026-02-08 Morning)

- [x] Step 1: Loaded project context and guidelines
- [x] Step 2: Scanned stories, next number ROK-221
- [x] Step 3: Sprint status — Sprint B active, ROK-195/ROK-189 next
- [x] Step 4: Active sprint path selected
- [x] Step 5: ROK-195 selected as next priority
- [x] Step 6: Story file found and validated
- [x] Step 7: Story scope expanded — 3 rings, user_preferences table, ROK-221 created
- [x] Step 8: Story approved, seed data sufficient
- [x] Step 9: Backend complete — user_preferences schema, migration 0017, PreferencesService, controller endpoints
- [x] Step 9 (cont): Frontend complete — 3 orbital rings (AUTH/GAMING/COMMS), hexagonal frames, tractor beams, orbit animations

---

## Session Progress (2026-02-09 Evening)

- [x] ROK-189 marked done (sprint-status, task.md, Linear)
- [x] ROK-124 readiness audit — found ~530 hardcoded Tailwind color classes blocking theme work
- [x] ROK-224 story created — CSS Theme Token Migration (split from ROK-124)
- [x] ROK-224 implemented — 12 semantic tokens via @theme, 51 files migrated, zero visual regression
- [x] ROK-224 committed (`bf82160`), Linear → Done
- [x] Handover: lint pass, build pass, 5/5 chrome smoke tests pass

---

## Session Progress (2026-02-09 Night)

- [x] ROK-190: Notify Organizer on Slot Leave — backend notification dispatch
  - [x] Imported NotificationModule into EventsModule
  - [x] Injected NotificationService into SignupsService
  - [x] Updated `cancel()` to check roster assignments before delete
  - [x] Dispatches `slot_vacated` notification to event creator when assigned user leaves
  - [x] 3 new tests + all 146 API tests pass, lint clean
  - [x] Browser-tested: assign user → impersonate → leave → organizer notification bell shows "Slot Vacated"

