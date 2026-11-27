/**
 * ROK-2352 — the `''` post's scope: `''` only while the game's adapter is
 * active, the whole game otherwise (every non-WoW game, and the Q10 fold).
 *
 * `currentView` lives in another module (`lfm-embed.views`), mocked here so
 * the test pins the scope the post reads with.
 */
import {
  anyGroupScope,
  nothingToPost,
  readAnyGroup,
} from './lfm-embed.any-group.helpers';
import { currentView } from './lfm-embed.views';
import type { LfmGameRow } from './lfm-embed.db-helpers';
import type { LfmGroupView } from './lfm-embed.helpers';

jest.mock('./lfm-embed.views', () => ({ currentView: jest.fn() }));

const game = { id: 7, name: 'WoW', slug: 'wow-classic' } as LfmGameRow;
const registry = (active: boolean) =>
  ({ getAdapter: jest.fn(() => (active ? {} : undefined)) }) as never;
const view = (state: string, memberCount: number) =>
  ({ state, memberCount }) as LfmGroupView;

describe('anyGroupScope', () => {
  it("is '' while the adapter is active", () => {
    expect(anyGroupScope(registry(true), game)).toBe('');
  });

  it('is the whole game (null) with no active adapter — the fold', () => {
    expect(anyGroupScope(registry(false), game)).toBeNull();
  });

  it('is the whole game (null) with no registry', () => {
    expect(anyGroupScope(undefined, game)).toBeNull();
  });
});

describe('readAnyGroup', () => {
  it("reads the current view scoped to '' while the adapter is active", async () => {
    jest.mocked(currentView).mockResolvedValue(view('open', 2));
    const read = await readAnyGroup({} as never, registry(true), game);
    expect(currentView).toHaveBeenLastCalledWith({}, game, '');
    expect(read).toEqual({ view: view('open', 2), scope: '' });
  });

  it('reads the whole game when folded', async () => {
    jest.mocked(currentView).mockResolvedValue(view('open', 3));
    await readAnyGroup({} as never, registry(false), game);
    expect(currentView).toHaveBeenLastCalledWith({}, game, null);
  });
});

describe('nothingToPost', () => {
  it("is true for an empty open '' group (only keyed hands are up)", () => {
    expect(nothingToPost({ view: view('open', 0), scope: '' })).toBe(true);
  });

  it("is false once the '' group has a hand", () => {
    expect(nothingToPost({ view: view('open', 1), scope: '' })).toBe(false);
  });

  it('is false for a playing session (game-level, attaches to the post)', () => {
    expect(nothingToPost({ view: view('playing', 0), scope: '' })).toBe(false);
  });

  it('is always false for the whole-game scope (non-WoW unchanged)', () => {
    expect(nothingToPost({ view: view('open', 0), scope: null })).toBe(false);
  });
});
