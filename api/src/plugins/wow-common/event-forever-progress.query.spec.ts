/**
 * ROK-1748 fix round 1: unit coverage for the Forever progress loader —
 * D8 inactive statuses and the PUT path's single-character snapshot read
 * (ROK-2109: both paths go through `loadForeverQuestSources`).
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
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

let db: MockDb;

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
  sources.mockReset().mockResolvedValue(new Map());
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
    await loadForeverMemberProgress(db as never, 10, 1);
    expect(sources).toHaveBeenCalledTimes(1);
    expect(sources).toHaveBeenCalledWith(db, ['char-1']);
  });
});

describe('loadForeverEventProgress', () => {
  it('reads every member’s quest data in one batched load', async () => {
    queueRows();
    await loadForeverEventProgress(db as never, 10);
    expect(sources).toHaveBeenCalledTimes(1);
    expect(sources).toHaveBeenCalledWith(db, ['char-1']);
  });

  it('memoises the known-quest read across calls', async () => {
    queueRows();
    await loadForeverEventProgress(db as never, 10);
    db.limit.mockResolvedValueOnce([
      { slug: WOW_FOREVER_GAME_SLUG, contentInstances: [] },
    ]);
    db.where.mockReturnValueOnce(db).mockResolvedValueOnce([]);
    await loadForeverEventProgress(db as never, 10);
    expect(db.where).toHaveBeenCalledTimes(5);
  });
});
