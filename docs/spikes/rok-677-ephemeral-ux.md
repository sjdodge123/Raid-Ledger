# ROK-677: Discord Ephemeral Reply UX Investigation

## Problem Statement

When a user clicks **Sign Up** (or similar buttons) on an event embed, Discord sends an ephemeral reply at the bottom of the channel. Two UX issues compound:

1. **Scroll position**: If the user clicked the button while scrolled up (e.g. via "View in Discord" from a DM), the ephemeral reply appears at the bottom — the user must manually scroll down to see it.
2. **"Mark as Read" dismissal**: Discord shows a purple "1 new message" banner with "Mark As Read". If the user clicks that banner (natural instinct), the ephemeral **disappears** without the user ever seeing it — they never complete the character/role selection flow.

This was discovered during ROK-535 testing (recruitment reminder DM "Sign Up" button).

## Current Implementation Analysis

### Files Using Ephemeral Replies for Signup Flows

| File | Pattern | Purpose |
|------|---------|---------|
| `api/src/discord-bot/listeners/signup-interaction.listener.ts` | `deferReply({ ephemeral: true })` at L162 | **Primary signup flow** — Sign Up, Tentative, Decline, Quick Sign Up buttons |
| `api/src/discord-bot/utils/signup-dropdown-builders.ts` | `editReply()` at L92, L153 | Character select and role select dropdown menus (shared by signup + reschedule) |
| `api/src/discord-bot/listeners/reschedule-response.listener.ts` | `deferReply({ ephemeral: true })` at L96 | Reschedule confirm/decline — reuses signup dropdown builders |
| `api/src/discord-bot/listeners/pug-invite.listener.ts` | `deferReply({ ephemeral })` at L100 | PUG accept/decline and "Join Event" button |
| `api/src/discord-bot/listeners/roach-out-interaction.listener.ts` | `deferReply({ ephemeral: true })` at L104 | "Roach Out" confirmation prompt on reminder DMs |
| `api/src/discord-bot/listeners/interaction.listener.ts` | `followUp/reply({ ephemeral: true })` at L120-123 | Error fallback for slash commands |

### Current Flow (Signup Example)

1. User clicks "Sign Up" button on event embed
2. `handleButtonInteraction()` calls `deferReply({ ephemeral: true })` immediately
3. Async work: DB lookups, linked user check, character list fetch
4. `editReply()` sends character select dropdown (or role select, or confirmation)
5. User interacts with dropdown -> `handleSelectMenuInteraction()` -> final `editReply()` confirmation

The `deferReply()` must happen within 3 seconds of the button click (Discord interaction token expiry). All subsequent responses use `editReply()` on the deferred reply.

### Key Constraint

The current code calls `deferReply({ ephemeral: true })` as the **first** response to every button interaction. This is deeply embedded — every handler assumes the interaction is already deferred.

## Discord API Options Investigated

### Option 1: Modals (`interaction.showModal()`)

**How it works**: Instead of an ephemeral reply, show a modal dialog that overlays the screen regardless of scroll position. Modals are always visible.

**Compatibility**: discord.js v14.25.1 (our version) supports Components v2 modals with String Select menus since v14.19.3.

**What modals support (Components v2)**:
- String Select (type 3) — exactly what we need for character/role selection
- Text Input (type 4)
- User/Role/Mentionable/Channel Select (types 5-8)
- Label containers (type 18) — required wrapper for components in modals
- Radio Group, Checkbox Group (types 21-22)

**Critical constraint**: `showModal()` must be the **first** response to an interaction. You cannot call `deferReply()` before `showModal()`. This means we cannot do async DB lookups before deciding to show a modal — the modal must be shown immediately, then populated via the modal submit handler.

**Pros**:
- Solves both scroll position AND "Mark as Read" dismissal problems completely
- Modal is always front-and-center, cannot be accidentally dismissed
- Components v2 supports String Select in modals — can keep the same dropdown UX
- Better UX: feels like a proper form, not a chat message

**Cons**:
- Must show modal as first response — cannot defer then decide. Requires restructuring the handler to show the modal immediately
- Character list must be available at modal-show time (must complete within 3 seconds)
- Mobile support caveat: String Select in modals may not render on all mobile clients (Discord is still rolling this out). Need to test on iOS/Android.
- Requires `IS_COMPONENTS_V2` flag for modal responses
- Unlinked users (onboarding flow with "Join & Sign Up" URL button) cannot use modals — URL buttons must remain as messages

### Option 2: `interaction.followUp()` Instead of `interaction.reply()`

**How it works**: Use `followUp()` to send a separate message after the initial response.

**Result**: Does NOT solve the problem. `followUp()` after `deferReply({ ephemeral: true })` inherits the ephemeral flag and appears at the bottom of chat just like the original reply. The ephemeral state is locked by the initial `deferReply()` call.

**Verdict**: Not viable. Same scroll/dismissal issues.

### Option 3: Non-Ephemeral Reply with Auto-Delete

**How it works**: Send a non-ephemeral (visible to all) reply, then `setTimeout(() => interaction.deleteReply(), timeout)` after the user completes the flow.

**Pros**:
- Non-ephemeral messages are persistent — not affected by "Mark as Read"
- User can scroll up and the message remains

**Cons**:
- **Visible to everyone in the channel** — character selection, role selection, and signup confirmations would be public. Major privacy/spam concern.
- Channel gets cluttered with signup flow messages even with auto-delete
- Race condition: if bot restarts before `setTimeout` fires, orphaned messages remain
- Multi-step flows (character select -> role select -> confirm) would show 3+ public messages

**Verdict**: Not viable for signup flows due to privacy and spam concerns.

### Option 4: DM-Based Flow

**How it works**: Instead of replying in the channel, send the character/role selection as a DM to the user.

**Pros**:
- DMs are always visible in the user's DM list
- Private by nature

**Cons**:
- Users may have DMs disabled from server members
- Adds latency — must open DM channel first
- Breaks the mental model of "click button, see response here"
- More complex error handling (DM failures, blocked users)

**Verdict**: Possible fallback for unlinked users, but not a good primary approach.

## Recommended Approach: Hybrid Modal + Ephemeral

Use modals for flows that require user input (character/role selection) and keep ephemeral replies for simple confirmations.

| Flow | Current | Proposed |
|------|---------|----------|
| Sign Up (linked, has characters) | Ephemeral -> char select -> role select | **Modal** with char + role select |
| Sign Up (linked, no characters) | Ephemeral confirmation | Ephemeral confirmation (unchanged) |
| Sign Up (unlinked) | Ephemeral with Join/Quick buttons | Ephemeral (unchanged — URL buttons can't go in modals) |
| Tentative (linked, has characters) | Ephemeral -> char select -> role select | **Modal** with char + role select |
| Decline | Ephemeral confirmation | Ephemeral confirmation (unchanged) |
| Quick Sign Up | Ephemeral -> role select | **Modal** with role select |
| Reschedule Confirm | Ephemeral -> char select -> role select | **Modal** with char + role select |

### Rationale

1. Modals solve both root causes (scroll position and "Mark as Read" dismissal) for the flows where users are most affected — multi-step character/role selection.
2. Simple confirmations ("You've declined") are fine as ephemeral — they're one-shot messages the user doesn't need to interact with.
3. The onboarding flow for unlinked users must remain ephemeral because it contains URL buttons ("Join & Sign Up"), which are not supported in modals.
4. discord.js v14.25.1 supports Components v2 modals with String Select, so no library upgrade needed.

### Implementation Notes

1. **`showModal()` must be the first response** — cannot `deferReply()` first. The handler must branch immediately: if the flow will need character/role selection, call `showModal()` instead of `deferReply()`.
2. **Character list prefetch**: The modal must include the character select options when shown. The characters query is indexed and should be fast (<100ms), but needs validation under load.
3. **Modal submit handler**: Need a new `ModalSubmitInteraction` handler to process the selections and create the signup. This replaces the current `StringSelectMenuInteraction` handlers for these flows.
4. **Mobile testing required**: String Select in modals is a newer Discord feature. Must verify on iOS and Android before shipping.
5. **Components v2 flag**: Modal responses using String Select in Label containers require the `IS_COMPONENTS_V2` flag.

### Migration Path

1. Add `ModalBuilder` + `ModalSubmitInteraction` handling to `signup-interaction.listener.ts`
2. Create modal-compatible builders in a new `signup-modal-builders.ts` (or extend existing `signup-dropdown-builders.ts`)
3. Modify `handleButtonInteraction()` to branch: modal for multi-step flows, deferReply for simple flows
4. Add `ModalSubmitInteraction` handler alongside existing `StringSelectMenuInteraction` handler
5. Keep existing ephemeral flows as fallback for:
   - Unlinked users (onboarding with URL buttons)
   - Simple confirmations (decline, already signed up)
   - Mobile clients where modal selects don't render (if detected)

## Follow-Up Stories

1. **feat: Replace character/role selection ephemeral with modal (signup flow)**
   - Refactor signup button handler to use `showModal()` for character/role selection
   - Add `ModalSubmitInteraction` handler
   - Create modal-compatible builders
   - Acceptance: linked users clicking Sign Up/Tentative see a modal, not an ephemeral

2. **feat: Replace reschedule confirm character/role selection with modal**
   - Apply same modal pattern to `reschedule-response.listener.ts`
   - Reuses modal builders from story 1

3. **feat: Replace PUG accept character/role selection with modal**
   - Apply same modal pattern to `pug-invite.listener.ts`
   - Reuses modal builders from stories 1-2

4. **chore: Mobile compatibility testing for modal String Select**
   - Test modal String Select rendering on iOS and Android Discord clients
   - Document any client version requirements
   - Determine if ephemeral fallback is needed for mobile

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mobile clients don't render String Select in modals | Medium | High | Test early; keep ephemeral as fallback path |
| 3-second timeout on character prefetch for modal | Low | Medium | Characters query is indexed and fast; add cache if needed |
| discord.js Components v2 modal API instability | Low | Medium | Pin discord.js version; test thoroughly |
| Increased handler complexity (two response paths) | Low | Low | Clear branching logic; shared builders |
| Users confused by modal vs ephemeral inconsistency | Low | Low | Modal is strictly better UX — users won't notice the difference |

## References

- [Discord API: Receiving and Responding to Interactions](https://discord.com/developers/docs/interactions/receiving-and-responding)
- [Discord API: Using Modal Components](https://docs.discord.com/developers/components/using-modal-components)
- [Discord API: Component Reference](https://docs.discord.com/developers/components/reference)
- [discord.js Guide: Modals](https://discordjs.guide/legacy/interactions/modals)
- [discord.js Components v2 in v14 PR #10781](https://github.com/discordjs/discord.js/pull/10781)
- [Discord API Issue #4675: Ephemeral hide on unloaded messages](https://github.com/discord/discord-api-docs/issues/4675)
- [Discord API Discussion #5883: Most Wanted Features for Modals](https://github.com/discord/discord-api-docs/discussions/5883)
