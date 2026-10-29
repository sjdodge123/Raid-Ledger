import type { Bg3GalleryItem } from '../bg3-gallery.feed';
import {
  BG3_GALLERY_MAX_PER_RUN,
  galleryProvenanceKey,
  planGallerySync,
} from './bg3-gallery-sync.helpers';

const H = 3_600_000;
const NOW = new Date(Date.UTC(2026, 9, 20, 12));
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * H);

function item(
  saveId: number,
  hoursAgo: number,
  over: Partial<Bg3GalleryItem> = {},
): Bg3GalleryItem {
  return {
    saveId,
    uploaderUserId: 7,
    uploaderDisplayName: 'Ada',
    sha256: `sha${saveId}`,
    savedAt: at(hoursAgo),
    campaignId: 1,
    area: `Area ${saveId}`,
    provenanceKey: `k:${saveId}`,
    ...over,
  };
}

const ids = (items: Bg3GalleryItem[], known: string[] = [], max?: number) =>
  planGallerySync(items, new Set(known), NOW, max).map((p) => p.item.saveId);

describe('planGallerySync (ROK-1959 D-2 / D-4)', () => {
  it('copies the LAST save of a closed session, once, keyed by its sha', () => {
    const picks = planGallerySync(
      [item(1, 8), item(2, 7), item(3, 6)],
      new Set(),
      NOW,
    );
    expect(picks).toEqual([
      { item: item(3, 6), provenanceKey: 'bg3-save:sha256:sha3' },
    ]);
  });

  it('skips a session whose last save is under 4 h old', () => {
    expect(ids([item(1, 5), item(2, 3.9)])).toEqual([]);
  });

  it('copies one picture per closed session, oldest first', () => {
    expect(ids([item(1, 30), item(2, 29), item(3, 10), item(4, 1)])).toEqual([
      2, 3,
    ]);
  });

  it('clusters per campaign', () => {
    expect(ids([item(1, 10), item(2, 9, { campaignId: 2 })])).toEqual([1, 2]);
  });

  it('skips keys already in hub_media (live or tombstoned)', () => {
    expect(
      ids([item(1, 30), item(2, 10)], [galleryProvenanceKey('sha1')]),
    ).toEqual([2]);
  });

  it('copies one picture for a sha shared by two sessions', () => {
    expect(ids([item(1, 30), item(2, 10, { sha256: 'sha1' })])).toEqual([1]);
  });

  it(`stops at the per-run cap (${BG3_GALLERY_MAX_PER_RUN} by default)`, () => {
    const many = Array.from({ length: 30 }, (_, n) =>
      item(n + 1, 300 - n * 10),
    );
    expect(ids(many)).toHaveLength(BG3_GALLERY_MAX_PER_RUN);
    expect(ids(many, [], 2)).toEqual([1, 2]);
  });
});
