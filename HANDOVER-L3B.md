# ROK-1888 L3b handover (drop before PR)

Commits: `6bec56a5b` (tests: AC5/AC6 integration, AC7 units, OQ3 red), `2c585626d` (OQ3 fix).

## Done
- `services/ad-hoc-unlinked-server-count.integration.spec.ts` — AC5 (card `1 playing`, push `1 signed up`,
  `**Loanati** · on server`, ENDED `Attendance · 1 player`), ruling 1 grace (`getActiveCount` vs
  `getOpenRowCount` = [1,2] then [0,1] after the voice member leaves), AC6 (linked other user counts by name,
  anonymous `+1 on server` uncounted).
- `listeners/voice-lobby-server-merge.helpers.spec.ts` — AC7: voice + unlinked → groupSize 2; linked entry in voice
  counted once. These pin UNCHANGED lobby code (ruling 1), so no red phase exists for them.
- OQ3: `recapEvents(db, bindingId, openedAt, presenceRowId?)` — new `services/channel-presence-recap-scope.helpers.ts`
  (`recapScope`, `joinedByOccupants`): binding channel OR any session an occupancy-ledger member of that message
  participated in. `hydrateRecap(deps, bindingId, row: {openedAt, id})`; both callers (`channel-presence-flush.ts`
  close path, `channel-presence-brief-visit.ts`) pass the row. Without a row id the old born-on-channel scope holds,
  so the 1851 "other channel → recap []" case is unchanged.
- Spec `channel-presence-recap-cross-channel.integration.spec.ts`: A-born event, Alpha (A) + Bravo (B) participants,
  B's presence row with Bravo in the ledger → recap lists the event, hydrated roster = [Alpha, Bravo]; unrelated
  occupant → [].

## Red evidence (task 2faceee2da04, L3 count logic scratch-reverted: `f9f1cf1d1` notification-helpers hunks +
`getActiveCount` filter; OQ3 code not yet written): 6 failed / 1 passed — `Expected: 1 Received: 2` (signupCount),
`Expected substring "Attendance · 1 player"`, `[1,2]` deep-equal diff, AC6 `Expected: 2 Received: 3`, OQ3 recap
`toEqual([eventId])` got `[]`, hydrated names got `[]`.

## Not done / follow-up
- `recapParticipants` (flush.helpers) does not set ruling-2 row flags, so the PRESENCE-card recap counts an unlinked
  server row and renders it without `· on server`. The Quick Play ENDED card (readParticipants) is right. Decide
  whether to switch it to `readParticipants(db, id)`.

## Green evidence (task 6044ab419d7a, L3 restored + OQ3 fix): 4 suites / 18 tests PASS — the two new specs plus
`channel-presence-recap-room.integration.spec.ts` and the 1851 lobby-reuse spec. Unit: merge helpers 17/17;
recap/flush/brief-visit units 7 suites / 111 PASS. `tsc -p api/tsconfig.json` clean; eslint clean on touched files.
