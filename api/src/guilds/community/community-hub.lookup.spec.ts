/** ROK-1870 Codex r3 — a concurrent restore's unique clash is the D11 409. */
import { ConflictException } from '@nestjs/common';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import { RESTORE_NAME_CLASH, restoreHub } from './community-hub.lookup';

const AT = new Date('2026-10-01T00:00:00Z');

const HUB: schema.GuildSelect = {
  id: 7,
  gameId: 9,
  kind: 'game_community',
  region: 'community',
  name: 'Crew',
  nameKey: 'crew',
  realmSlug: null,
  guildSlug: null,
  faction: null,
  memberCount: 2,
  source: 'community',
  lastSnapshotAt: null,
  rawRealm: null,
  pelicanServerId: null,
  hiddenAt: null,
  status: 'archived',
  blurb: null,
  proposedBy: null,
  blizzardGuildId: null,
  reviewedBy: null,
  reviewedAt: null,
  archivedAt: AT,
  archivedReason: 'leader',
  createdAt: AT,
  updatedAt: AT,
};

/** Mock whose clash SELECT finds nothing and whose UPDATE rejects with `err`. */
function dbWithUpdateError(err: Error): never {
  const db = createDrizzleMock();
  db.limit.mockResolvedValueOnce([]);
  db.where.mockReturnValueOnce(db).mockRejectedValueOnce(err);
  return db as never;
}

describe('restoreHub', () => {
  it('maps a unique violation from a concurrent restore to the D11 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: '23505' });
    const run = restoreHub(dbWithUpdateError(dup), HUB);
    await expect(run).rejects.toThrow(ConflictException);
    await expect(run).rejects.toThrow(RESTORE_NAME_CLASH);
  });

  it('rethrows any other failure unchanged', async () => {
    const boom = new Error('connection reset');
    await expect(restoreHub(dbWithUpdateError(boom), HUB)).rejects.toBe(boom);
  });
});
