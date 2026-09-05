/**
 * ROK-1471 D7 / AC5 — the forum post's component row.
 *
 * Three claims are load-bearing here:
 *
 *  - **AC5 iii — the `+1` custom id is symmetric with the parser.** The id is
 *    built here and read by `parseJoinCustomId`; asserting the string shape
 *    alone would let the two drift, so the parser itself is fed the id this
 *    file produces and must return the game back.
 *  - **AC5 iv — terminal states carry NO row.** A live `+1` on a converted
 *    group is the trap the whole option exists to avoid: the click would run
 *    `createIntent` on a group that already got scheduled.
 *  - **there is exactly ONE embed builder.** The spec calls a second one
 *    (`buildLfgForumEmbed`) a violation, so it is a source scan rather than a
 *    comment: nothing under `lfm/` or `lfg-board/` may export one.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ButtonStyle, ComponentType } from 'discord.js';
import type { APIButtonComponent } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import { parseJoinCustomId } from '../listeners/lfg-join.listener';
import type { LfmRenderState } from '../lfm/lfm-embed.helpers';
import { buildLfgPostComponents } from './lfg-board-components.helpers';

const GAME_ID = 42;
const CLIENT_URL = 'https://raid.example';

/** The raw API buttons of the row the helper returned, or `[]` when it built none. */
function buttons(
  state: LfmRenderState,
  clientUrl: string | null = CLIENT_URL,
): APIButtonComponent[] {
  const rows = buildLfgPostComponents({
    gameId: GAME_ID,
    gameSlug: 'deep-rock-galactic',
    clientUrl,
    state,
  });
  if (rows.length === 0) return [];
  expect(rows).toHaveLength(1);
  return rows[0].toJSON().components;
}

describe('buildLfgPostComponents — the open row (AC5 iii)', () => {
  it('carries the +1 button first, then the group link', () => {
    const [join, link] = buttons('open');

    expect(join).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      label: "+1 · I'm in",
    });
    expect(link).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: 'Open group ↗',
      url: `${CLIENT_URL}/lfg/deep-rock-galactic`,
    });
  });

  it('builds a custom id the join listener parses back to this game', () => {
    const [join] = buttons('open');
    const customId = 'custom_id' in join ? join.custom_id : '';

    // Symmetry, not shape: `parseJoinCustomId` is the ONLY reader, so pinning
    // the literal string here would still let a prefix change break the button
    // while both this test and the parser's own tests stayed green.
    expect(customId).toBe(`${LFG_BUTTON_IDS.JOIN}:${String(GAME_ID)}`);
    expect(parseJoinCustomId(customId)).toBe(GAME_ID);
  });

  it('drops the Link button — never the +1 — when no client URL is set', () => {
    // A Link button without a URL is rejected by Discord at post time, which
    // would cost the group its whole post rather than just its link.
    const rendered = buttons('open', null);

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ style: ButtonStyle.Primary });
  });
});

describe('buildLfgPostComponents — terminal states carry no row (AC5 iv)', () => {
  it.each(['scheduled', 'expired', 'closed'] as const)(
    'returns no rows at %s',
    (state) => {
      expect(
        buildLfgPostComponents({
          gameId: GAME_ID,
          gameSlug: 'deep-rock-galactic',
          clientUrl: CLIENT_URL,
          state,
        }),
      ).toEqual([]);
    },
  );
});

/**
 * The spec is explicit: `buildLfmEmbed` plus an option, never a second builder.
 * Assembled at runtime so this file cannot match itself.
 */
describe('one embed builder, ever (D7)', () => {
  const FORBIDDEN = 'build' + 'LfgForumEmbed';
  const DIRS = [join(__dirname), join(__dirname, '..', 'lfm')];

  function sources(): Array<[string, string]> {
    return DIRS.flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
        .map((f): [string, string] => [
          `${dir.split('/').pop() ?? ''}/${f}`,
          readFileSync(join(dir, f), 'utf-8'),
        ]),
    );
  }

  it('finds the files it is guarding', () => {
    // A source scan whose glob matches nothing passes forever.
    expect(sources().length).toBeGreaterThanOrEqual(8);
  });

  it('declares no second LFG embed builder anywhere', () => {
    expect(
      sources()
        .filter(([, text]) => text.includes(FORBIDDEN))
        .map(([name]) => name),
    ).toEqual([]);
  });
});
