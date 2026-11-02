# ROK-1728 L7 — Web flow handover

## Done (commits on feat/rok-1728-series-signup)
- 75e3bc748 api client + hooks + series-signup components
- 4987fbddd mounts (fallback signup, roster header, SignedUpActions) + .btn -> Button (design Q7) + series-state invalidation in use-signups
- 3646a1408 useSignupSelection moved to `web/src/components/events/use-signup-selection.ts` (unchanged; react-refresh lint forbids a hook export from the modal file)
- 6cab3a58b / 341b34203 Vitest specs

## Files
- NEW `web/src/lib/api/series-signups-api.ts`, `web/src/hooks/use-series-signup.ts` (+ `.test.tsx`)
- NEW `web/src/components/events/series-signup/`: `JoinSeriesButton`, `JoinSeriesOverlay`, `JoinSeriesBody`, `LeaveSeriesConfirm`, `SeriesMemberActions` (also `SeriesSkippedNight`, `LeaveSeriesButton`), `SeriesSignupSlots` (`SeriesNotSignedUpSlot`, `SeriesSignedUpActions`), `series-signup-format.ts`, `use-join-series-selection.ts`, `series-signup.test-helpers.ts`, 4 test files
- NEW `web/src/components/events/use-signup-selection.ts`; edited `signup-confirmation-modal.tsx` (import only)
- Edited `web/src/hooks/use-signups.ts` (signup/cancel also invalidates `['series-signup', eventId]` so Skip / re-signup refresh the member state)
- Edited `EventDetailSubComponents.tsx` (`EventDetailFallbackSignup` gains `event` prop; `SignedUpActions` gains `event`), `EventDetailRosterSlot.tsx`, `event-detail-page.tsx`

## testids
`join-series-button`, `join-series-confirm`, `join-series-kept`, `series-member-actions`, `skip-this-night`, `leave-series`, `leave-series-confirm`, `leave-series-late-warning`, `series-skipped-night`

## Decisions to flag (not in spec text)
1. Join series is ALSO mounted beside the roster header's "Join Event" (`EventDetailRosterSlot`), not only in `EventDetailFallbackSignup`: the fallback renders only when the event has no roster assignments, so otherwise a non-member would never see the button.
2. The skipped-night state shows the wireframe's Leave series beside the muted "In for the series · Skipping <date> · back on the next night" line (spec §5.3 lists only the muted line; wireframe §3 draws Leave).
3. The join success toast ("You joined the series / Signed up for N nights") and the join/leave error toasts are additions; spec only defines the leave toasts.
4. Leave confirm footer is "Stay in series" (wireframe) instead of "Cancel" (spec).
5. Join's role picker shows when `event.game.hasRoles` is true (fallback false, same as the page's `gameHasRoles`); confirm is NOT disabled with zero roles (the api accepts none).
6. Leave's night count/range comes from the state of the current night forward (`in_series` nights only).

## Not done / next
- Red-first was not observed: implementation was written before the specs. Mutation-check the key assertions (late-cancel boundary, kept-line, hidden cases) if the reviewer wants it.
- Both colour families not visually checked (tokens only: text-success/text-warning/text-muted, Button variants). The verify lane covers it.

## Verification
- Fleet vitest (task 76e02a596bb4): 15 files / 156 tests PASS: series-signup/*, use-series-signup, signup-confirmation-modal, pages/event-detail/*, use-signups.
- Laptop: tsc app + test configs clean; eslint clean on all touched files.
