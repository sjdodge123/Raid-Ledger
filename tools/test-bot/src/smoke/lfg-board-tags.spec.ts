#!/usr/bin/env npx tsx
/**
 * The companion bot's `BOARD_TAGS` literal must equal the api's
 * `LFG_BOARD_TAGS` exactly — same tags, same count, any order.
 *
 * The live LFG board smoke can only detect an EXTRA tag on a freshly created
 * forum, and the shared guild reuses its forum (`ensureTags` only appends), so
 * that branch never fires there. This spec reads the api source file and
 * compares the two literals with no Discord, API or network access.
 *
 * Run: npx tsx src/smoke/lfg-board-tags.spec.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BOARD_TAGS } from './lfg-board-tags.js';

const API_CONSTANTS = new URL(
  '../../../../api/src/discord-bot/lfg-board/lfg-board.constants.ts',
  import.meta.url,
);

/** The string entries of `export const LFG_BOARD_TAGS = [...] as const`. */
function parseLfgBoardTags(source: string): string[] {
  const block = /export const LFG_BOARD_TAGS = \[([\s\S]*?)\] as const;/.exec(
    source,
  );
  assert.ok(block, `LFG_BOARD_TAGS literal not found in ${API_CONSTANTS.pathname}`);
  return [...block[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(
    (m) => m[1] ?? m[2],
  );
}

const apiTags = parseLfgBoardTags(readFileSync(API_CONSTANTS, 'utf8'));
assert.ok(apiTags.length > 0, 'parsed zero tags from LFG_BOARD_TAGS');

const missing = apiTags.filter((t) => !BOARD_TAGS.includes(t));
const extra = BOARD_TAGS.filter((t) => !apiTags.includes(t));
assert.deepEqual(
  { missing, extra, count: BOARD_TAGS.length },
  { missing: [], extra: [], count: apiTags.length },
  `BOARD_TAGS [${BOARD_TAGS.join(', ')}] has drifted from LFG_BOARD_TAGS ` +
    `[${apiTags.join(', ')}] in lfg-board.constants.ts — missing: ` +
    `[${missing.join(', ')}], extra: [${extra.join(', ')}]`,
);
console.log(`lfg-board-tags.spec: ${apiTags.length} tags in sync — passed`);
