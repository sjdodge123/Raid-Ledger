/**
 * ROK-1813 Codex P2: the signed-out card read must be token-less, because its
 * key is exempt from `dropViewerPrivateCaches` — a viewer-scoped response under
 * an exempt key would outlive a logout.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { createMockPublicGuildCard, SEEDED_PUBLIC_GUILD_SLUG } from '../../../test/mocks/public-guild-card-handlers';
import { clearAccessToken, setAccessToken } from '../../../lib/api/access-token-store';
import { fetchPublicGuildCard } from './use-public-guild-card';

describe('fetchPublicGuildCard', () => {
    afterEach(() => clearAccessToken());

    it('sends neither the bearer nor credentials, even while a viewer is signed in', async () => {
        const seen: { auth: string | null; credentials: string }[] = [];
        server.use(http.get('*/plugins/wow/public-guild-cards/:slug', ({ request }) => {
            seen.push({ auth: request.headers.get('authorization'), credentials: request.credentials });
            return HttpResponse.json(createMockPublicGuildCard());
        }));
        setAccessToken('header.payload.sig');
        const card = await fetchPublicGuildCard(SEEDED_PUBLIC_GUILD_SLUG);
        expect(card.name).toBe(createMockPublicGuildCard().name);
        expect(seen).toEqual([{ auth: null, credentials: 'omit' }]);
    });

    it('rejects on a 404 so the page renders "not found"', async () => {
        server.use(http.get('*/plugins/wow/public-guild-cards/:slug', () => new HttpResponse(null, { status: 404 })));
        await expect(fetchPublicGuildCard(SEEDED_PUBLIC_GUILD_SLUG)).rejects.toThrow(/404/);
    });
});
