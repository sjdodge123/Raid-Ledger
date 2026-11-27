/**
 * ROK-2352 Q11 — the `''` ("Any") post's line for keyed groups past the
 * open-post cap, rendered through `buildLfmEmbed`, and the per-game cache
 * that carries it onto every open `''` render.
 *
 * MUTATION: drop the `overflowLine` push from `description`
 * (`lfm-embed.helpers.ts`) and the one/many cases fail on
 * `expect(received).toContain(expected)`. Drop the `state === 'open'` guard
 * and the EXPIRED case still holds (D6 copy returns first) while the
 * SCHEDULED case fails on `not.toContain`.
 */
import { buildLfmEmbed, type LfmGroupView } from './lfm-embed.helpers';
import { overflowLine, type LfmOverflowGroup } from './lfm-embed.overflow-line';
import {
  LfmOverflowCache,
  refreshAnyPostOverflow,
} from './lfm-embed.overflow.helpers';

const CONTEXT = {
  communityName: 'Guild',
  clientUrl: 'https://raid.example',
  timezone: 'UTC',
};

function anyPost(overrides: Partial<LfmGroupView> = {}): LfmGroupView {
  return {
    state: 'open',
    gameId: 7,
    gameName: 'WoW Classic',
    gameSlug: 'world-of-warcraft-classic',
    memberCount: 2,
    memberNames: ['Bosco', 'Karl'],
    ...overrides,
  };
}

function descriptionOf(view: LfmGroupView): string {
  return buildLfmEmbed(view, CONTEXT, 0).embed.data.description ?? '';
}

const ONE: LfmOverflowGroup[] = [{ label: 'Deadmines', count: 2 }];
const MANY: LfmOverflowGroup[] = [
  { label: 'Deadmines', count: 2 },
  { label: 'Stockade', count: 3 },
  { label: 'Ragefire Chasm', count: 5 },
];

describe('overflowLine', () => {
  it('is null for no overflow (absent or empty)', () => {
    expect(overflowLine(undefined)).toBeNull();
    expect(overflowLine([])).toBeNull();
  });

  it('names one group with its head-count', () => {
    expect(overflowLine(ONE)).toBe('Also looking: Deadmines (2)');
  });

  it('lists many groups in board order', () => {
    expect(overflowLine(MANY)).toBe(
      'Also looking: Deadmines (2), Stockade (3), Ragefire Chasm (5)',
    );
  });
});

describe("buildLfmEmbed — the '' post's overflow line", () => {
  it('renders no line with 0 overflow groups, byte for byte as before', () => {
    expect(descriptionOf(anyPost({ overflowGroups: [] }))).toBe(
      descriptionOf(anyPost()),
    );
    expect(descriptionOf(anyPost())).not.toContain('Also looking');
  });

  it('renders the line under the roster for 1 overflow group', () => {
    const lines = descriptionOf(anyPost({ overflowGroups: ONE })).split('\n');
    const roster = lines.findIndex((l) => l.includes('Bosco'));
    expect(lines[roster + 1]).toBe('Also looking: Deadmines (2)');
  });

  it('renders every group for many overflow groups', () => {
    expect(descriptionOf(anyPost({ overflowGroups: MANY }))).toContain(
      'Also looking: Deadmines (2), Stockade (3), Ragefire Chasm (5)',
    );
  });

  it('renders no line once the post is not open', () => {
    expect(
      descriptionOf(anyPost({ state: 'expired', overflowGroups: MANY })),
    ).not.toContain('Also looking');
    expect(
      descriptionOf(
        anyPost({
          state: 'scheduled',
          target: { kind: 'event', eventId: 9 },
          overflowGroups: MANY,
        }),
      ),
    ).not.toContain('Also looking');
  });
});

describe('LfmOverflowCache', () => {
  it('reports a change only when the overflow differs', () => {
    const cache = new LfmOverflowCache();
    expect(cache.set(7, [])).toBe(false);
    expect(cache.set(7, ONE)).toBe(true);
    expect(cache.set(7, [{ label: 'Deadmines', count: 2 }])).toBe(false);
    expect(cache.set(7, [{ label: 'Deadmines', count: 3 }])).toBe(true);
    expect(cache.set(7, [])).toBe(true);
    expect(cache.get(7)).toEqual([]);
  });

  it("decorates only the open '' post of that game", () => {
    const cache = new LfmOverflowCache();
    cache.set(7, MANY);
    expect(cache.decorate(anyPost()).overflowGroups).toEqual(MANY);
    expect(cache.decorate(anyPost({ groupKey: '' })).overflowGroups).toEqual(
      MANY,
    );
    expect(
      cache.decorate(anyPost({ groupKey: 'dungeon:36' })).overflowGroups,
    ).toBeUndefined();
    expect(
      cache.decorate(anyPost({ state: 'expired' })).overflowGroups,
    ).toBeUndefined();
    expect(
      cache.decorate(anyPost({ gameId: 8 })).overflowGroups,
    ).toBeUndefined();
  });
});

describe('refreshAnyPostOverflow', () => {
  it('reads and edits nothing when the overflow did not change', async () => {
    const cache = new LfmOverflowCache();
    cache.set(7, ONE);
    const editRow = jest.fn();
    const db = new Proxy(
      {},
      {
        get: () => {
          throw new Error('no read expected');
        },
      },
    );
    await refreshAnyPostOverflow({ db: db as never, cache, editRow }, 7, [
      { label: 'Deadmines', count: 2 },
    ]);
    expect(editRow).not.toHaveBeenCalled();
  });
});
