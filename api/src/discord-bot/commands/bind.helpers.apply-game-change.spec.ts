import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { applyGameChange } from './bind.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';

/**
 * TECH-DEBT L2836: `/bind event:… game:…` must refuse a game change that would
 * leave a guild tag on another game — the same rule the web/API path enforces
 * (`EventGuildTagService.assertUpdate` → GUILD_GAME_MISMATCH).
 */
const EVENT_ID = 42;
const CURRENT_GAME = 7;
const OTHER_GAME = { id: 9, name: 'Valheim' };

let mockDb: MockDb;
const db = () => mockDb as unknown as PostgresJsDatabase<typeof schema>;

/** Queue the game lookup, then the event's guild-tag row. */
function seed(tag: { guildId: number | null; gameId: number | null }) {
  mockDb.limit.mockResolvedValueOnce([OTHER_GAME]).mockResolvedValueOnce([tag]);
}
function seedNone(tag: { guildId: number | null; gameId: number | null }) {
  mockDb.limit.mockResolvedValueOnce([tag]);
}

beforeEach(() => {
  mockDb = createDrizzleMock();
});

describe('applyGameChange guild-tag rule (L2836)', () => {
  it('refuses moving a guild-tagged event to another game, without writing', async () => {
    seed({ guildId: 3, gameId: CURRENT_GAME });
    const result = await applyGameChange(db(), EVENT_ID, 'Valheim');
    expect(result).toEqual({
      error: expect.stringMatching(/tagged to a guild/),
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('refuses setting a guild-tagged event to General, without writing', async () => {
    seedNone({ guildId: 3, gameId: CURRENT_GAME });
    const result = await applyGameChange(db(), EVENT_ID, 'none');
    expect(result).toEqual({
      error: expect.stringMatching(/tagged to a guild/),
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('writes when a guild-tagged event keeps its current game', async () => {
    seed({ guildId: 3, gameId: OTHER_GAME.id });
    const result = await applyGameChange(db(), EVENT_ID, 'Valheim');
    expect(result).toEqual({ change: 'Game reassigned to **Valheim**' });
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: OTHER_GAME.id }),
    );
  });

  it('writes a game change on an untagged event', async () => {
    seed({ guildId: null, gameId: CURRENT_GAME });
    const result = await applyGameChange(db(), EVENT_ID, 'Valheim');
    expect(result).toEqual({ change: 'Game reassigned to **Valheim**' });
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: OTHER_GAME.id }),
    );
  });

  it('writes General on an untagged event', async () => {
    seedNone({ guildId: null, gameId: CURRENT_GAME });
    const result = await applyGameChange(db(), EVENT_ID, 'general');
    expect(result).toEqual({ change: 'Game removed (set to General)' });
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: null }),
    );
  });

  it('still reports an unknown game before checking the tag', async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    const result = await applyGameChange(db(), EVENT_ID, 'Nope');
    expect(result).toEqual({ error: 'Game "Nope" not found.' });
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
