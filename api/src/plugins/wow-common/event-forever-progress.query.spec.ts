/**
 * ROK-1748 fix round 1: unit coverage for the Forever progress loader —
 * D8 inactive statuses and the PUT path's single-character snapshot read
 * (ROK-2109: both paths go through `loadForeverQuestSources`), and the
 * per-call Blizzard overlay on the memoised curated read (ROK-2143 Codex P2 3).
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  applyKnownQuestOverlay,
  type QuestOverlayDeps,
} from './dungeon-quests.overlay';
import {
  INACTIVE_SIGNUP_STATUSES,
  clearKnownQuestMemo,
  loadForeverEventProgress,
  loadForeverMemberProgress,
} from './event-forever-progress.query';
import { loadForeverQuestSources } from './forever-quest-source.query';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

jest.mock('./forever-quest-source.query');
const sources = jest.mocked(loadForeverQuestSources);
jest.mock('./dungeon-quests.overlay');
const overlay = jest.mocked(applyKnownQuestOverlay);

let db: MockDb;
let deps: QuestOverlayDeps;

/** Queue: event row (limit), known quests (where), signups (where). */
function queueRows(): void {
  db.limit.mockResolvedValueOnce([
    { slug: WOW_FOREVER_GAME_SLUG, contentInstances: [{ id: 63 }] },
  ]);
  db.where
    .mockReturnValueOnce(db)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { userId: 1, characterId: 'char-1', username: 'Questa' },
    ]);
}

beforeEach(() => {
  clearKnownQuestMemo();
  db = createDrizzleMock();
  deps = { db: db as never, settings: { get: jest.fn() } };
  sources.mockReset().mockResolvedValue(new Map());
  overlay.mockReset().mockImplementation((_deps, quests) =>
    Promise.resolve(quests),
  );
});

describe('INACTIVE_SIGNUP_STATUSES (D8)', () => {
  it('excludes departed signups alongside declined and roached_out', () => {
    expect([...INACTIVE_SIGNUP_STATUSES].sort()).toEqual([
      'declined',
      'departed',
      'roached_out',
    ]);
  });
});

describe('loadForeverMemberProgress', () => {
  it('reads only the writer’s character quest data', async () => {
    queueRows();
    await loadForeverMemberProgress(deps, 10, 1);
    expect(sources).toHaveBeenCalledTimes(1);
    expect(sources).toHaveBeenCalledWith(db, ['char-1']);
  });
});

describe('loadForeverEventProgress', () => {
  it('reads every member’s quest data in one batched load', async () => {
    queueRows();
    await loadForeverEventProgress(deps, 10);
    expect(sources).toHaveBeenCalledTimes(1);
    expect(sources).toHaveBeenCalledWith(db, ['char-1']);
  });

  it('memoises the known-quest read across calls', async () => {
    queueRows();
    await loadForeverEventProgress(deps, 10);
    db.limit.mockResolvedValueOnce([
      { slug: WOW_FOREVER_GAME_SLUG, contentInstances: [] },
    ]);
    db.where.mockReturnValueOnce(db).mockResolvedValueOnce([]);
    await loadForeverEventProgress(deps, 10);
    expect(db.where).toHaveBeenCalledTimes(5);
  });

  it('applies the switch-aware overlay on every call, over the memoised curated rows', async () => {
    queueRows();
    await loadForeverEventProgress(deps, 10);
    db.limit.mockResolvedValueOnce([
      { slug: WOW_FOREVER_GAME_SLUG, contentInstances: [] },
    ]);
    db.where.mockReturnValueOnce(db).mockResolvedValueOnce([]);
    await loadForeverEventProgress(deps, 10);
    expect(overlay).toHaveBeenCalledTimes(2);
    expect(overlay).toHaveBeenNthCalledWith(2, deps, []);
  });
});
