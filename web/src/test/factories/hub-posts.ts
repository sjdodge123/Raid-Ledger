/** ROK-1868 — hub post fixtures. The default body uses bold + a list (§3.5). */
import type { HubPost, HubPostComposer } from '@raid-ledger/contract';

/** A fresh (never edited, not relayed) post on guild 7 by user 1. */
export function buildHubPost(overrides: Partial<HubPost> = {}): HubPost {
    return {
        id: 1,
        guildId: 7,
        body: '**Raid night** is Thursday.\n\n- Bring flasks\n- Repair first',
        author: { userId: 1, displayName: 'Grimtusk', avatarUrl: null },
        createdAt: '2026-10-03T12:00:00.000Z',
        updatedAt: '2026-10-03T12:00:00.000Z',
        editedBy: null,
        relay: null,
        ...overrides,
    };
}

/** Composer state with a usable `#news` channel and the relay default on. */
export function buildHubPostComposer(overrides: Partial<HubPostComposer> = {}): HubPostComposer {
    return { relayDefault: true, channel: { state: 'ok', channelId: '900', channelName: 'news' }, ...overrides };
}
