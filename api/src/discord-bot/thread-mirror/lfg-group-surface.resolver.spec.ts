/**
 * ROK-1483 — the `lfg-group` resolver's contract, over the shared drizzle mock.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { LfgGroupSurfaceResolver } from './lfg-group-surface.resolver';
import type { ThreadMirrorDb } from './thread-mirror.db-helpers';

describe('LfgGroupSurfaceResolver', () => {
  let db: MockDb;
  let resolver: LfgGroupSurfaceResolver;

  beforeEach(() => {
    db = createDrizzleMock();
    resolver = new LfgGroupSurfaceResolver(db as unknown as ThreadMirrorDb);
  });

  describe('resolveThread', () => {
    it('returns the thread and guild of the game’s forum post', async () => {
      db.limit.mockResolvedValue([
        { threadId: 'thread-1', guildId: 'guild-1' },
      ]);

      await expect(resolver.resolveThread('42')).resolves.toEqual({
        threadId: 'thread-1',
        guildId: 'guild-1',
      });
    });

    it('returns null when the game has no forum post', async () => {
      db.limit.mockResolvedValue([]);

      await expect(resolver.resolveThread('42')).resolves.toBeNull();
    });

    it('returns null for a non-numeric surface id without touching the database', async () => {
      await expect(resolver.resolveThread('not-a-game')).resolves.toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('resolveSurface', () => {
    it('maps a thread back to its lfg-group surface', async () => {
      db.limit.mockResolvedValue([{ gameId: 42 }]);

      await expect(resolver.resolveSurface('thread-1')).resolves.toEqual({
        kind: 'lfg-group',
        id: '42',
      });
    });

    it('returns null for a thread this kind does not own', async () => {
      db.limit.mockResolvedValue([]);

      await expect(
        resolver.resolveSurface('someone-elses'),
      ).resolves.toBeNull();
    });
  });

  describe('canView (D3 / A2)', () => {
    it('lets any authenticated caller read, matching GET /lfg/:gameId', async () => {
      await expect(resolver.canView()).resolves.toBe(true);
    });
  });
});
