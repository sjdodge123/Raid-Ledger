/**
 * MSW request handlers for common API routes used in component tests.
 *
 * These provide sensible defaults so tests don't need to mock the api-client
 * module directly. Individual tests can override with server.use() for
 * specific scenarios.
 */
import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:3000';

export const handlers = [
    // Auth — profile
    http.get(`${API_BASE}/auth/profile`, () =>
        HttpResponse.json({
            id: 1,
            username: 'testuser',
            email: 'test@example.com',
            role: 'member',
            discordId: null,
            customAvatarUrl: null,
        }),
    ),

    // Events — list
    http.get(`${API_BASE}/events`, () =>
        HttpResponse.json({ data: [], meta: { total: 0, page: 1, limit: 25 } }),
    ),

    // Events — single
    http.get(`${API_BASE}/events/:id`, () =>
        HttpResponse.json({
            id: 1,
            title: 'Test Event',
            startTime: '2026-02-10T18:00:00.000Z',
            endTime: '2026-02-10T20:00:00.000Z',
            creatorId: 1,
        }),
    ),

    // Games — registry
    http.get(`${API_BASE}/games`, () => HttpResponse.json([])),

    // Users — preferences
    http.get(`${API_BASE}/users/me/preferences`, () =>
        HttpResponse.json({ theme: 'system', channelPrefs: {} }),
    ),

    // Users — characters
    http.get(`${API_BASE}/users/me/characters`, () =>
        HttpResponse.json({ data: [], meta: { total: 0 } }),
    ),

    // Notifications
    http.get(`${API_BASE}/notifications`, () =>
        HttpResponse.json({ data: [], meta: { total: 0, unreadCount: 0 } }),
    ),

    // Plugins
    http.get(`${API_BASE}/plugins`, () => HttpResponse.json([])),

    // Game time
    http.get(`${API_BASE}/users/me/game-time`, () =>
        HttpResponse.json({ slots: [], events: [], weekStart: null }),
    ),

    // System — branding (public, ROK-877)
    http.get(`${API_BASE}/system/branding`, () =>
        HttpResponse.json({
            communityName: 'Test Community',
            communityLogoUrl: null,
            communityAccentColor: null,
        }),
    ),

    // Games — interest batch
    http.get(`${API_BASE}/games/interest/batch`, () => HttpResponse.json({})),

    // Admin settings
    http.get(`${API_BASE}/admin/settings/discord-bot`, () =>
        HttpResponse.json({ configured: false }),
    ),
    http.get(`${API_BASE}/admin/settings/oauth`, () =>
        HttpResponse.json({ configured: false }),
    ),
    http.get(`${API_BASE}/admin/settings/igdb`, () =>
        HttpResponse.json({ configured: false }),
    ),
    http.get(`${API_BASE}/admin/settings/igdb/adult-filter`, () =>
        HttpResponse.json({ enabled: false }),
    ),
    http.get(`${API_BASE}/admin/settings/igdb/sync-status`, () =>
        HttpResponse.json({ lastSync: null }),
    ),
    http.get(`${API_BASE}/admin/settings/blizzard`, () =>
        HttpResponse.json({ configured: false }),
    ),
    http.get(`${API_BASE}/admin/settings/demo/status`, () =>
        HttpResponse.json({ enabled: false }),
    ),
    http.get(`${API_BASE}/admin/settings/timezone`, () =>
        HttpResponse.json({ timezone: 'UTC' }),
    ),
    http.get(`${API_BASE}/admin/plugins`, () => HttpResponse.json([])),

    // Auth — user management
    http.get(`${API_BASE}/auth/users`, () =>
        HttpResponse.json({ data: [], meta: { total: 0 } }),
    ),

    // System status
    http.get(`${API_BASE}/system/status`, () =>
        HttpResponse.json({ status: 'ok' }),
    ),

    // User profile — hearted games
    http.get(`${API_BASE}/users/:id/hearted-games`, () =>
        HttpResponse.json([]),
    ),

    // User profile — taste profile (ROK-949). Returns a neutral empty
    // profile so tests that incidentally render <TasteProfileSection>
    // don't hit an MSW miss. Tests asserting specific dimensions can
    // override with server.use().
    http.get(`${API_BASE}/users/:id/taste-profile`, ({ params }) => {
        const userId = Number(params.id);
        return HttpResponse.json({
            userId,
            dimensions: {
                co_op: 0, pvp: 0, battle_royale: 0, mmo: 0, moba: 0,
                fighting: 0, shooter: 0, racing: 0, sports: 0, rpg: 0,
                fantasy: 0, sci_fi: 0, adventure: 0, strategy: 0,
                survival: 0, crafting: 0, automation: 0, sandbox: 0,
                horror: 0, social: 0, roguelike: 0, puzzle: 0,
                platformer: 0, stealth: 0,
            },
            intensityMetrics: {
                intensity: 0, focus: 0, breadth: 0, consistency: 0,
            },
            archetype: 'Casual',
            coPlayPartners: [],
            computedAt: '2026-04-17T00:00:00.000Z',
        });
    }),

    // User profile — similar players (ROK-949 companion endpoint).
    http.get(`${API_BASE}/users/:id/similar-players`, () =>
        HttpResponse.json({ similar: [] }),
    ),

    // Lineups — active list (ROK-1065: array of summaries, empty by default).
    http.get(`${API_BASE}/lineups/active`, () => HttpResponse.json([])),

    // Lineups — banner (ROK-1065: visibility surfaces in banner response).
    http.get(`${API_BASE}/lineups/banner`, () => HttpResponse.json(null)),

    // Lineups — invitees add (ROK-1065). Returns refreshed detail.
    http.post(
        `${API_BASE}/lineups/:id/invitees`,
        async ({ request, params }) => {
            const lineupId = Number(params.id);
            const body = (await request.json()) as { userIds?: number[] };
            const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
            return HttpResponse.json({
                id: lineupId,
                title: 'Test Lineup',
                description: null,
                status: 'building',
                targetDate: null,
                decidedGameId: null,
                decidedGameName: null,
                linkedEventId: null,
                createdBy: { id: 1, displayName: 'Admin' },
                votingDeadline: null,
                maxVotesPerPlayer: 3,
                entries: [],
                totalVoters: 0,
                totalMembers: 0,
                createdAt: '2026-03-20T00:00:00Z',
                updatedAt: '2026-03-20T00:00:00Z',
                channelOverrideId: null,
                channelOverrideName: null,
                visibility: 'private',
                invitees: userIds.map((id) => ({
                    id,
                    displayName: `User ${id}`,
                    steamLinked: false,
                })),
            });
        },
    ),

    // Lineups — invitee remove (ROK-1065). 204 No Content.
    http.delete(
        `${API_BASE}/lineups/:id/invitees/:userId`,
        () => new HttpResponse(null, { status: 204 }),
    ),
];
