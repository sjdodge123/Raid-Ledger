import { snapshotFits, snapshotQuota } from './valheim-link-snapshot.quota';

describe('Valheim Link snapshot quota (ROK-1833)', () => {
  afterEach(() => {
    delete process.env.VALHEIM_LINK_MAX_SNAPSHOTS_PER_SERVER;
    delete process.env.VALHEIM_LINK_MAX_SNAPSHOT_BYTES_PER_SERVER;
  });

  it('defaults to 2,000 snapshots and 256 MiB per server', () => {
    expect(snapshotQuota()).toEqual({
      maxSnapshots: 2000,
      maxBytes: 256 * 1024 ** 2,
    });
  });

  it('a new key fits up to both caps, never past either', () => {
    process.env.VALHEIM_LINK_MAX_SNAPSHOTS_PER_SERVER = '3';
    process.env.VALHEIM_LINK_MAX_SNAPSHOT_BYTES_PER_SERVER = '100';
    expect(snapshotFits({ count: 2, bytes: 60 }, 40)).toBe(true);
    expect(snapshotFits({ count: 2, bytes: 60 }, 41)).toBe(false);
    expect(snapshotFits({ count: 3, bytes: 0 }, 1)).toBe(false);
  });
});
