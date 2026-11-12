/**
 * "GG <year>" API client (ROK-2187). Paths:
 * `GET /gg/:year` (owner snapshot), `GET /gg/archive` (years with a snapshot),
 * `PUT /gg/:year/share` (opt-in public link), `GET /gg/public/:slug` (summary
 * only, anonymous) and the share image `GET /gg/public/:slug/card.png`.
 */
import type {
    GgArchiveDto, GgOwnerSnapshotDto, GgPublicSummaryDto, GgShareStateDto, GgShareToggleDto,
} from '@raid-ledger/contract';
import { API_BASE_URL } from '../config';
import { fetchApi } from './fetch-api';
import { encodePathSegment } from './path-segment';

/**
 * The community mascot on the intro card (spec "Community mascot intro"). Read
 * defensively: the owner DTO gains `mascot` in the contract lane; until then it
 * is absent and the plain intro renders.
 */
export interface GgMascotView {
    emojiName: string;
    imageUrl: string;
    soundUrl: string | null;
    volume: number;
}

/** The owner snapshot plus the optional mascot block. */
export type GgOwnerSnapshot = GgOwnerSnapshotDto & { mascot?: GgMascotView | null };

/** The viewer's own frozen snapshot for `year`. */
export async function getGgYear(year: number): Promise<GgOwnerSnapshot> {
    return fetchApi(`/gg/${year}`);
}

/** Every year the viewer has a GG for (R5). */
export async function getGgArchive(): Promise<GgArchiveDto> {
    return fetchApi('/gg/archive');
}

/** Turn the public link for `year` on or off (off by default, Q5). */
export async function setGgShare(year: number, body: GgShareToggleDto): Promise<GgShareStateDto> {
    return fetchApi(`/gg/${year}/share`, { method: 'PUT', body: JSON.stringify(body) });
}

/** The public summary behind `/w/:slug` — no names, ids or email (Q4). */
export async function getGgPublic(slug: string): Promise<GgPublicSummaryDto> {
    return fetchApi(`/gg/public/${encodePathSegment(slug)}`);
}

/** The server-rendered share card image for a public slug. */
export function ggShareImageUrl(slug: string): string {
    return `${API_BASE_URL}/gg/public/${encodePathSegment(slug)}/card.png`;
}

/** The page a shared link opens. */
export function ggPublicPageUrl(slug: string): string {
    return `${window.location.origin}/w/${encodePathSegment(slug)}`;
}
