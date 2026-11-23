/**
 * ROK-1813 — MSW handlers for the signed-out guild card read
 * (`GET /plugins/wow/public-guild-cards/:slug`). Not in the default handler
 * set — specs opt in with `server.use(...)`.
 */
import { http, HttpResponse } from 'msw';
import type { GuildPublicCardSettings, PublicGuildCard } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

export const PUBLIC_GUILD_CARD_URL = `${API_BASE}/plugins/wow/public-guild-cards/:slug`;
export const SEEDED_PUBLIC_GUILD_SLUG = 'Xk3pQ9aL2mWv7RtB';

export function createMockPublicGuildCard(overrides: Partial<PublicGuildCard> = {}): PublicGuildCard {
    return {
        name: 'Iron Vanguard',
        region: 'US',
        realmName: 'Whitemane',
        gameName: 'WoW: Classic',
        approxMemberCount: 140,
        recruitment: {
            state: 'open',
            wanted: [
                { className: 'Priest', role: 'healer', state: 'open' },
                { className: 'Warrior', role: 'tank', state: 'limited' },
            ],
            applyUrl: 'https://example.com/apply',
        },
        ...overrides,
    };
}

/** Serves `card` for the seeded slug and the server's single not-found body for anything else. */
export function publicGuildCardHandler(card: PublicGuildCard, calls: string[] = []) {
    return http.get(PUBLIC_GUILD_CARD_URL, ({ params }) => {
        const slug = String(params.slug);
        calls.push(slug);
        if (slug !== SEEDED_PUBLIC_GUILD_SLUG) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
        return HttpResponse.json(card);
    });
}

export const GUILD_PUBLIC_CARD_SETTINGS_URL = `${API_BASE}/plugins/wow/guilds/:id/public-card`;

/** Records what the editor section sent: `"<METHOD> <path>"` lines and PATCH bodies. */
export interface PublicCardSettingsLog {
    calls: string[];
    bodies: unknown[];
}

/** GET + PATCH `/plugins/wow/guilds/:id/public-card` over one in-memory `{enabled, slug}`; PATCH keeps the slug. */
export function guildPublicCardSettingsHandlers(initial: GuildPublicCardSettings, log: PublicCardSettingsLog) {
    let state = { ...initial };
    return [
        http.get(GUILD_PUBLIC_CARD_SETTINGS_URL, ({ params }) => {
            log.calls.push(`GET /plugins/wow/guilds/${String(params.id)}/public-card`);
            return HttpResponse.json(state);
        }),
        http.patch(GUILD_PUBLIC_CARD_SETTINGS_URL, async ({ params, request }) => {
            const body = (await request.json()) as { enabled: boolean };
            log.calls.push(`PATCH /plugins/wow/guilds/${String(params.id)}/public-card`);
            log.bodies.push(body);
            state = { enabled: body.enabled, slug: state.slug ?? SEEDED_PUBLIC_GUILD_SLUG };
            return HttpResponse.json(state);
        }),
    ];
}
