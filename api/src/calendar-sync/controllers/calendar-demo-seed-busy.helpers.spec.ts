/**
 * ROK-1595 review MINOR: the demo busy seed stamps `lastSyncedAt` only when
 * the account reads after the seed — a non-reading account never synced.
 */
import {
  SEEDED_SYNC_AGE_MS,
  seedConnectionSet,
} from './calendar-demo-seed-busy.helpers';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const STAMP = new Date(NOW - SEEDED_SYNC_AGE_MS);

describe('seedConnectionSet', () => {
  it('readAccess granted → read on, and stamped synced', () => {
    const set = seedConnectionSet('granted', false, NOW);
    expect(set).toMatchObject({ readEnabled: true, lastSyncedAt: STAMP });
  });

  it('readAccess missing → read off, and NOT stamped synced', () => {
    const set = seedConnectionSet('missing', true, NOW);
    expect(set).toMatchObject({ readEnabled: false });
    expect(set).not.toHaveProperty('lastSyncedAt');
  });

  it('no readAccess, connection already reads → stamped synced', () => {
    expect(seedConnectionSet(undefined, true, NOW)).toMatchObject({
      lastSyncedAt: STAMP,
    });
  });

  it('no readAccess, connection read off → NOT stamped synced', () => {
    const set = seedConnectionSet(undefined, false, NOW);
    expect(set).not.toHaveProperty('lastSyncedAt');
    expect(set).toEqual({ updatedAt: new Date(NOW) });
  });
});
