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

    // Settings — branding (public)
    http.get(`${API_BASE}/settings/branding`, () =>
        HttpResponse.json({
            communityName: 'Test Community',
            communityLogoPath: null,
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
];
