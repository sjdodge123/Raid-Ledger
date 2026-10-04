/**
 * `LFG_BOARD_TAGS` — the forum's lifecycle tags, verbatim, mirrored from
 * `api/src/discord-bot/lfg-board/lfg-board.constants.ts`. A hand-copied
 * literal (the companion bot does not depend on the api workspace), so it goes
 * stale when a tag is appended: ROK-1494's `PLAYING NOW` was missing until
 * ROK-1505 appended it together with its own `LOOKING`.
 *
 * Drift is caught statically by `lfg-board-tags.spec.ts`, which parses the api
 * constant and requires the exact same set. The live smoke's extra-tag check
 * (`assertForumTags`) can only fire on a freshly created forum, and the shared
 * guild reuses its forum, so the spec is the guard that always runs.
 */
export const BOARD_TAGS: readonly string[] = [
  'NEEDS PLAYERS',
  'READY TO SCHEDULE',
  'SCHEDULED',
  'EXPIRED',
  'CLOSED',
  'PLAYING NOW',
  'LOOKING',
];
