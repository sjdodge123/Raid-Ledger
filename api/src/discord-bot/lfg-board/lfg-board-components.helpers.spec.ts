/**
 * ROK-1471 D7 / AC5(iii)(iv) — the `+1` + `Open group` row on a board post.
 *
 * The high-risk assertions here, and why each exists:
 *
 *  - **the custom id round-trips through the LISTENER'S parser.** Asserting the
 *    string shape here and hoping `parseJoinCustomId` agrees is exactly how the
 *    button ends up inert in production: nothing would fail. So the spec
 *    imports the real parser and asserts it recovers the game id.
 *  - **every non-open state returns an EMPTY row list.** A live `+1` on a
 *    converted group is a trap (E11), and Discord happily renders it.
 *  - **no second builder.** D7 says one embed builder with one option; a
 *    `buildLfgForumEmbed` is a spec violation, so the source is scanned for one.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ButtonStyle, ComponentType } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import { parseJoinCustomId } from '../listeners/lfg-join.listener';
import type { LfmRenderState } from '../lfm/lfm-embed.helpers';
import {
  LFG_JOIN_BUTTON_LABEL,
  LFG_OPEN_GROUP_LABEL,
} from './lfg-board.constants';
import { buildLfgPostComponents } from './lfg-board-components.helpers';

const CLIENT_URL = 'https://raid.example';
const GAME_ID = 12;
const GAME_SLUG = 'deep-rock-galactic';

/** The rendered row list as Discord's API sees it. */
function render(overrides: Record<string, unknown> = {}) {
  return buildLfgPostComponents({
    gameId: GAME_ID,
    gameSlug: GAME_SLUG,
    clientUrl: CLIENT_URL,
    state: 'open',
    ...overrides,
  }).map((row) => row.toJSON());
}

describe('buildLfgPostComponents — the open-state row (AC5 iii)', () => {
  it('is exactly one row of exactly two buttons', () => {
    const rows = render();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(ComponentType.ActionRow);
    expect(rows[0].components).toHaveLength(2);
  });

  it('carries a join id the REAL listener parser recovers the game id from', () => {
    const [join] = render()[0].components;
    expect(join).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      label: LFG_JOIN_BUTTON_LABEL,
    });
    const customId = (join as { custom_id: string }).custom_id;
    expect(customId).toBe(`${LFG_BUTTON_IDS.JOIN}:${String(GAME_ID)}`);
    expect(parseJoinCustomId(customId)).toBe(GAME_ID);
  });

  it('links the second button at the web group page', () => {
    const [, link] = render()[0].components;
    expect(link).toMatchObject({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: LFG_OPEN_GROUP_LABEL,
      url: `${CLIENT_URL}/lfg/${GAME_SLUG}`,
    });
  });

  it('drops the link button — but keeps the +1 — with no client URL', () => {
    const rows = render({ clientUrl: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0].components).toHaveLength(1);
    expect(rows[0].components[0]).toMatchObject({
      style: ButtonStyle.Primary,
      custom_id: `${LFG_BUTTON_IDS.JOIN}:${String(GAME_ID)}`,
    });
  });
});

describe('buildLfgPostComponents — terminal states have no row (AC5 iv)', () => {
  it.each<LfmRenderState>(['scheduled', 'expired', 'closed'])(
    'renders no components at %s — a live +1 on a dead group is a trap',
    (state) => {
      expect(render({ state })).toEqual([]);
      // Not even an empty row: Discord renders an empty action row as a gap.
      expect(render({ state })).toHaveLength(0);
    },
  );
});

describe('D7 — one embed builder, never a second (AC5)', () => {
  /**
   * Matched on the DECLARATION, not the bare identifier: the spec and the
   * design note both name `buildLfgForumEmbed` in prose to forbid it, and a
   * guard that trips on the sentence forbidding the thing is the ROK-1314
   * defect. Only an actual export can match these.
   */
  const DECLARATIONS = [
    /export\s+(?:async\s+)?function\s+buildLfgForumEmbed\b/,
    /export\s+(?:const|let|var)\s+buildLfgForumEmbed\b/,
  ];

  const dirs = [__dirname, join(__dirname, '..', 'lfm')];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(dir, f)),
  );

  it('finds the files it is supposed to be guarding', () => {
    // Without this the guard passes vacuously if a directory is renamed.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('declares no buildLfgForumEmbed anywhere in the LFG/LFM families', () => {
    const hits = files.filter((file) => {
      const source = readFileSync(file, 'utf-8');
      return DECLARATIONS.some((re) => re.test(source));
    });
    expect(hits).toEqual([]);
  });
});
