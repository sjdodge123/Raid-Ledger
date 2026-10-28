/**
 * ROK-1965 — fixtures for `hub-gallery-upload.smoke.spec.ts`.
 *
 * - `seedUploadHub`: the DEMO_MODE `POST /admin/test/community-hubs/seed {gameId}`
 *   ("Seed Crew": a Leader, an officer and four members) on a configured game no
 *   other hub spec seeds (index 12 + project slot; community-hubs takes 0–2,
 *   hubs-nav 3–5, hub-invite / calendar-hub 6–8, hub-rename 9–11), so parallel
 *   projects never reset each other's hub. Gallery on a community hub is itself
 *   the D14 widening under test (it used to be Valheim server hubs only).
 * - `uniquePng`: a valid 16×16 PNG with random pixels, so every run uploads NEW
 *   bytes — the same bytes twice answer 200 (already there) and bytes removed
 *   before answer 409 (`removed`), either of which would mask the 201 path.
 * - `uploadAs` / `listMedia`: the member's own routes, for seeding and for
 *   polling after every async write (never a sleep).
 */
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { TestInfo } from '@playwright/test';
import { HUB_MEDIA_PAGE_MAX } from '@raid-ledger/contract';
import { API_BASE, apiGet, getAdminToken, pollForCondition } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';

const GAME_INDEX_BASE = 12;
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

export interface UploadHub {
    hubId: number;
    leaderUserId: number;
    /** This project's own crew member (member-1 / -2 / -3): the uploader. */
    uploaderId: number;
    /** member-4: views, never uploads. */
    otherMemberId: number;
}

export interface MediaItem {
    id: number;
    kind: string;
    canRemove: boolean;
    source: { type: string; label: string | null };
}

/** Fail loudly on a missing element (strict flags: no `!`). */
export function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-gallery-upload] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hub-gallery-upload] GET /games/configured returned no games');
    return must(ids[(GAME_INDEX_BASE + slotOf(testInfo)) % ids.length], 'project game id');
}

/** "Seed Crew" on this project's game; `memberUserIds` = `[officer, m1, m2, m3, m4]`. */
export async function seedUploadHub(testInfo: TestInfo): Promise<UploadHub> {
    const token = await getAdminToken();
    const gameId = await projectGameId(token, testInfo);
    const body = (await seedCommunityHubs(token, testInfo, 'hub-gallery-upload', { gameId })) as {
        hubIds?: { crew?: number };
        leaderUserId?: number;
        memberUserIds?: number[];
    } | null;
    if (!body?.hubIds?.crew || typeof body.leaderUserId !== 'number' || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[hub-gallery-upload] seed: ${JSON.stringify(body)}`);
    }
    return {
        hubId: body.hubIds.crew,
        leaderUserId: body.leaderUserId,
        uploaderId: must(body.memberUserIds[1 + slotOf(testInfo)], 'uploader member id'),
        otherMemberId: must(body.memberUserIds[4], 'other member id'),
    };
}

// --- PNG -------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/** A valid 16×16 RGB PNG with random pixels — new bytes on every call. */
export function uniquePng(size = 16): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr.writeUInt8(8, 8); // bit depth
    ihdr.writeUInt8(2, 9); // colour type RGB
    const rows = Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), randomBytes(size * 3)]));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(Buffer.concat(rows))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// --- API -------------------------------------------------------------------

/** `POST /hubs/:id/media` as the member (field `file`); expects 201. */
export async function uploadAs(jwt: string, hubId: number, png: Buffer): Promise<MediaItem> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'smoke.png');
    const res = await fetch(`${API_BASE}/hubs/${hubId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
    });
    const text = await res.text();
    if (res.status !== 201) throw new Error(`[hub-gallery-upload] POST /hubs/${hubId}/media → ${res.status}: ${text}`);
    return JSON.parse(text) as MediaItem;
}

/**
 * The viewer's own first page (newest first — every picture these specs
 * look for is the newest on a freshly seeded hub). The `limit` must stay
 * within the contract's `HUB_MEDIA_PAGE_MAX`: above it the route 400s, and
 * `apiGet` turns that into `null` — so a null body throws instead of
 * reading as an empty Gallery.
 */
export async function listMedia(jwt: string, hubId: number): Promise<MediaItem[]> {
    const path = `/hubs/${hubId}/media?limit=${HUB_MEDIA_PAGE_MAX}`;
    const body = (await apiGet(jwt, path)) as { items?: MediaItem[] } | null;
    if (body === null) throw new Error(`[hub-gallery-upload] GET ${path} returned a non-2xx status`);
    return body.items ?? [];
}

/** Poll until `id` is (or is no longer) in the viewer's list. */
export async function pollListed(jwt: string, hubId: number, id: number, listed: boolean): Promise<void> {
    await pollForCondition(
        async () => ((await listMedia(jwt, hubId)).some((i) => i.id === id) === listed ? true : null),
        { description: `picture ${id} ${listed ? 'listed' : 'gone'}`, timeoutMs: 15_000 },
    );
}
