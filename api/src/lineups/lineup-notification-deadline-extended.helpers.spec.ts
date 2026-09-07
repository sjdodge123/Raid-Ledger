/**
 * ROK-1443 (T4) — the deadline-extended channel notice.
 *
 * Pins the dedup key + channel-override routing of the orchestrator and the
 * copy/chrome of the builder. Chrome owns chrome (ROK-1459): the builder must
 * never call the three setters `createLineupEmbed` owns, so the source is
 * scanned (comment-stripped, assembled names — the ROK-1314 lesson).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDeadlineExtendedEmbed,
  notifyDeadlineExtended,
} from './lineup-notification-deadline-extended.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
} from './lineup-notification-dispatch.helpers';
import type { EmbedContext } from './lineup-notification-embed.helpers';

jest.mock('./lineup-notification-dispatch.helpers', () => ({
  postChannelEmbed: jest.fn(),
  resolveEmbedCtx: jest.fn(),
}));

const mockPost = postChannelEmbed as jest.MockedFunction<
  typeof postChannelEmbed
>;
const mockResolveCtx = resolveEmbedCtx as jest.MockedFunction<
  typeof resolveEmbedCtx
>;

const NEW_DEADLINE = new Date('2026-09-09T18:00:00.000Z');
const ctx: EmbedContext = {
  baseUrl: 'https://raid.example.net',
  lineupId: 42,
  communityName: 'Gamer Night',
  phase: 'nominations',
  lineupTitle: 'Friday Co-op',
  phaseDeadline: NEW_DEADLINE,
};

describe('notifyDeadlineExtended', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCtx.mockResolvedValue(ctx);
    mockPost.mockResolvedValue(null);
  });

  it('posts under the per-lineup dedup key with the channel override', async () => {
    const deps = { db: {}, settingsService: {} } as never;
    await notifyDeadlineExtended(
      deps,
      { id: 42, title: 'Friday Co-op', channelOverrideId: 'chan-9' },
      NEW_DEADLINE,
      0,
    );
    expect(mockPost).toHaveBeenCalledWith(
      deps,
      'lineup-deadline-extended:42',
      expect.any(Function),
      ctx,
      'chan-9',
    );
  });

  it('resolves the context with the NEW deadline so the author line reads it', async () => {
    await notifyDeadlineExtended(
      {} as never,
      { id: 42, channelOverrideId: null },
      NEW_DEADLINE,
      1,
    );
    expect(mockResolveCtx).toHaveBeenCalledWith(
      {},
      42,
      'nominations',
      expect.objectContaining({ phaseDeadline: NEW_DEADLINE }),
    );
  });
});

describe('buildDeadlineExtendedEmbed', () => {
  it('carries the Deadline extended footer label under the created chrome', () => {
    const { embed } = buildDeadlineExtendedEmbed(ctx, NEW_DEADLINE, 0);
    expect(embed.data.footer?.text).toBe('Gamer Night · Deadline extended');
    expect(embed.data.author?.name).toMatch(/NOMINATIONS OPEN · closes/);
  });

  it('names the new deadline and the nobody-nominated fact', () => {
    const { embed } = buildDeadlineExtendedEmbed(ctx, NEW_DEADLINE, 0);
    const unix = Math.floor(NEW_DEADLINE.getTime() / 1000);
    expect(embed.data.description).toContain('Nobody has nominated a game yet');
    expect(embed.data.description).toContain(`<t:${unix}:f>`);
    expect(embed.data.description).toContain(
      '[Nominate a game ↗](https://raid.example.net/community-lineup/42)',
    );
  });

  it('reads differently when one game is already on the board', () => {
    const { embed } = buildDeadlineExtendedEmbed(ctx, NEW_DEADLINE, 1);
    expect(embed.data.description).toContain(
      'Only one game has been nominated so far',
    );
  });

  it('never grows its own chrome — no colour, author or footer setter', () => {
    const source = readFileSync(
      join(__dirname, 'lineup-notification-deadline-extended.helpers.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const setters = ['set' + 'Color', 'set' + 'Author', 'set' + 'Footer'];
    for (const setter of setters) {
      expect(source).not.toContain(`.${setter}(`);
    }
  });
});
