import { containedBlobPath, fogEtag } from './valheim-armory-map-bytes.service';

describe('containedBlobPath (ROK-1837 D3 — the path stays in the blob root)', () => {
  const prev = process.env.VALHEIM_LINK_BLOB_DIR;
  beforeAll(() => {
    process.env.VALHEIM_LINK_BLOB_DIR = '/srv/vh-blobs';
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
    else process.env.VALHEIM_LINK_BLOB_DIR = prev;
  });

  it('resolves a stored relative path under the root', () => {
    expect(containedBlobPath('7/abc.png')).toBe('/srv/vh-blobs/7/abc.png');
  });

  it.each([
    '../etc/passwd',
    '7/../../etc/passwd',
    '../vh-blobs-evil/7/abc.png',
    '/etc/passwd',
    '.',
  ])('refuses %s (escapes or is the root)', (rel) => {
    expect(containedBlobPath(rel)).toBeNull();
  });
});

describe('fogEtag', () => {
  it('is a strong validator keyed to the layer and capture instant', () => {
    const at = new Date('2026-10-17T20:15:00Z');
    expect(fogEtag('personal', at)).toBe(`"personal-${at.getTime()}"`);
    expect(fogEtag('shared', at)).not.toBe(fogEtag('personal', at));
  });
});
