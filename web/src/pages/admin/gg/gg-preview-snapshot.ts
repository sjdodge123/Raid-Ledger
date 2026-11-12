/**
 * ROK-2187 L10d — adapts the admin preview payload (a raw `GgSnapshotV1`,
 * computed live, never stored) + the current community mascot into the owner
 * shape the player story reads. No slug exists, so share is off; no archive.
 */
import type { GgAdminPreviewDto, GgMascot, GgOwnerMascot } from '@raid-ledger/contract';
import { resolveGgAssetUrl, type GgOwnerSnapshot } from '../../../lib/api/gg-api';

/** The mascot's owner-view slice with API-absolute asset URLs. */
export function toGgMascotView(m: GgMascot | null | undefined): GgOwnerMascot | null {
    if (!m) return null;
    return {
        emojiName: m.emojiName,
        imageUrl: resolveGgAssetUrl(m.imageUrl),
        soundUrl: m.soundUrl === null ? null : resolveGgAssetUrl(m.soundUrl),
        volume: m.volume,
    };
}

/** The preview payload as an unshared, archive-less owner snapshot. */
export function toGgPreviewSnapshot(dto: GgAdminPreviewDto, mascot: GgMascot | null | undefined): GgOwnerSnapshot {
    return {
        year: dto.year,
        tier: dto.tier,
        computedAt: dto.computedAt,
        cards: dto.cards,
        share: { shared: false, slug: null, sharedAt: null },
        archiveYears: [],
        mascot: toGgMascotView(mascot),
    };
}
