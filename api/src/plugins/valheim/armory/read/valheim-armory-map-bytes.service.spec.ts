import type { ValheimBitmapLike } from '../../link/ingest/valheim-link-bitmap.helpers';
import {
  collectMaskLayers,
  containedBlobPath,
  fogEtag,
} from './valheim-armory-map-bytes.service';

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

describe('collectMaskLayers (ROK-1949 D1)', () => {
  const bm = (data: string): ValheimBitmapLike => ({
    width: 64,
    height: 64,
    data,
  });
  const at = new Date('2026-10-17T20:15:00Z');
  const map = {
    id: 9,
    serverId: 1,
    worldUid: 'w',
    textureSize: 64,
    pixelSizeMetres: 12,
    sha256: 'a'.repeat(64),
    shared: bm('M-shared'),
    capturedAt: at,
  };

  it("adds M.shared once when the viewer's own character is M itself", () => {
    const out = collectMaskLayers(map, [
      {
        mapId: 9,
        explored: bm('M-mine'),
        shared: bm('M-shared'),
        capturedAt: at,
      },
    ]);
    expect(out.bitmaps).toEqual([bm('M-shared'), bm('M-mine')]);
    expect(out.refs.map((r) => `${r.mapId}:${r.layer}`)).toEqual([
      '9:shared',
      '9:personal',
    ]);
  });

  it("keeps another own map's shared layer", () => {
    const out = collectMaskLayers(map, [
      {
        mapId: 4,
        explored: bm('B-mine'),
        shared: bm('B-shared'),
        capturedAt: at,
      },
    ]);
    expect(out.bitmaps).toEqual([bm('M-shared'), bm('B-mine'), bm('B-shared')]);
  });
});
