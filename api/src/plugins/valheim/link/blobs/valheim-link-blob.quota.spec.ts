import {
  assertUnderQuota,
  declaredLength,
  fitsQuota,
} from './valheim-link-blob.quota';

describe('Valheim Link blob quota (ROK-1833)', () => {
  beforeEach(() => {
    process.env.VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER = '100';
    process.env.VALHEIM_LINK_MAX_BLOBS_PER_SERVER = '3';
  });
  afterEach(() => {
    delete process.env.VALHEIM_LINK_MAX_BLOB_BYTES_PER_SERVER;
    delete process.env.VALHEIM_LINK_MAX_BLOBS_PER_SERVER;
  });

  it('fitsQuota admits up to both caps, never past either', () => {
    expect(fitsQuota({ bytes: 60, count: 2 }, 40)).toBe(true);
    expect(fitsQuota({ bytes: 60, count: 2 }, 41)).toBe(false);
    expect(fitsQuota({ bytes: 0, count: 3 }, 1)).toBe(false);
  });

  it('a missing Content-Length checks only the count cap in the preflight', () => {
    expect(declaredLength({})).toBe(0);
    expect(() => assertUnderQuota({ bytes: 100, count: 1 }, 0)).not.toThrow();
    // …while the authoritative post-read check rejects the actual bytes.
    expect(fitsQuota({ bytes: 100, count: 1 }, 57)).toBe(false);
  });
});
