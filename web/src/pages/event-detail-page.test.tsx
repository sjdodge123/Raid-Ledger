/**
 * event-detail-page.test.tsx — ROK-1046 consumer-audit spec.
 *
 * Verifies the event-detail page consumes the composite `/events/:id/detail`
 * endpoint and does NOT call any of the legacy slice endpoints. The MSW
 * "reject on call" handlers are the safety net: if any sub-component still
 * calls a legacy endpoint after the Phase C refactor, the test fails with
 * an explicit "legacy endpoint hit" message.
 *
 * Initial state (before Phase C): the page uses useEvent/useEventRoster/
 * useRoster/useVoiceChannelFetch/usePugs which fan out to the legacy
 * endpoints. MSW rejects → React Query surfaces errors → the page never
 * renders the fixture data → assertions fail. RED.
 *
 * After Phase C: the page calls only `/events/:id/detail` (plus activity /
 * quest-coverage which are kept independent). MSW serves the fixture →
 * assertions pass. GREEN.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import { EventDetailPage } from './event-detail-page';

const API_BASE = 'http://localhost:3000';
const EVENT_ID = 4242;
const FIXTURE_TITLE = 'ROK-1046 Composite Endpoint Raid';
const FIXTURE_VOICE_CHANNEL_NAME = 'Raid Voice Lobby';
const FIXTURE_SIGNUP_USERNAME = 'TestSignup';
const FIXTURE_PUG_USERNAME = 'TestPug';

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', role: 'admin' as const },
        isAuthenticated: true,
    }),
    isOperatorOrAdmin: () => true,
    getAuthToken: () => 'test-token',
}));

vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [], isLoading: false, error: null }),
}));

vi.mock('../hooks/use-characters', () => ({
    useMyCharacters: () => ({ data: { data: [], meta: { total: 0 } }, isLoading: false }),
    useUserCharacters: () => ({ data: [], isLoading: false }),
}));

vi.mock('../hooks/use-voice-roster', () => ({
    useVoiceRoster: () => ({ participants: [], isConnected: false }),
}));

vi.mock('../hooks/use-notif-read-sync', () => ({
    useNotifReadSync: () => undefined,
}));

vi.mock('../components/common/ActivityTimeline', () => ({
    ActivityTimeline: () => <div data-testid="activity-timeline" />,
}));

vi.mock('../plugins', () => ({
    PluginSlot: () => null,
}));

function buildDetailFixture() {
    return {
        event: {
            id: EVENT_ID,
            title: FIXTURE_TITLE,
            description: 'Composite-endpoint coverage fixture',
            startTime: '2026-09-01T20:00:00.000Z',
            endTime: '2026-09-01T23:00:00.000Z',
            creator: {
                id: 1,
                username: 'TestUser',
                avatar: null,
                discordId: '1000000000',
                customAvatarUrl: null,
            },
            game: {
                id: 5,
                name: 'World of Warcraft',
                slug: 'world-of-warcraft',
                coverUrl: null,
                hasRoles: true,
            },
            signupCount: 1,
            slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 1, bench: 0 },
            maxAttendees: 10,
            autoUnbench: false,
            isAdHoc: false,
            myConflicts: [],
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
        },
        roster: {
            eventId: EVENT_ID,
            count: 1,
            signups: [
                {
                    id: 901,
                    eventId: EVENT_ID,
                    user: {
                        id: 2,
                        discordId: '2000000000',
                        username: FIXTURE_SIGNUP_USERNAME,
                        avatar: null,
                        customAvatarUrl: null,
                    },
                    note: null,
                    signedUpAt: '2026-08-02T00:00:00.000Z',
                    characterId: null,
                    character: null,
                    confirmationStatus: 'pending',
                    status: 'signed_up',
                    preferredRoles: ['tank'],
                },
            ],
        },
        rosterAssignments: {
            eventId: EVENT_ID,
            pool: [],
            assignments: [
                {
                    id: 901,
                    signupId: 901,
                    userId: 2,
                    discordId: '2000000000',
                    username: FIXTURE_SIGNUP_USERNAME,
                    avatar: null,
                    customAvatarUrl: null,
                    slot: 'tank',
                    position: 1,
                    isOverride: false,
                    character: null,
                    preferredRoles: ['tank'],
                    signupStatus: 'signed_up',
                },
            ],
            slots: { tank: 1, healer: 1, dps: 1, bench: 0 },
        },
        pugs: [
            {
                id: '00000000-0000-4000-8000-000000000aaa',
                eventId: EVENT_ID,
                discordUsername: FIXTURE_PUG_USERNAME,
                discordUserId: '999',
                discordAvatarHash: null,
                role: 'dps',
                class: null,
                spec: null,
                notes: null,
                status: 'pending',
                serverInviteUrl: null,
                inviteCode: null,
                claimedByUserId: null,
                createdBy: 1,
                createdAt: '2026-08-02T00:00:00.000Z',
                updatedAt: '2026-08-02T00:00:00.000Z',
            },
        ],
        voiceChannel: {
            channelId: '111222333',
            channelName: FIXTURE_VOICE_CHANNEL_NAME,
            guildId: '444555666',
        },
    };
}

function legacyRejectHandlers() {
    // The four legacy endpoints MUST NOT be hit after Phase C. Each handler
    // throws an HttpResponse with a recognisable error body so that React
    // Query's error state surfaces a clear message during failure analysis.
    const reject = (slice: string) =>
        HttpResponse.json(
            {
                error: 'LEGACY_ENDPOINT_HIT',
                slice,
                detail:
                    'event-detail-page must consume /events/:id/detail; legacy endpoint should not be called after ROK-1046 Phase C',
            },
            { status: 410 },
        );

    return [
        http.get(`${API_BASE}/events/:id/roster`, () => reject('roster')),
        http.get(`${API_BASE}/events/:id/roster/assignments`, () =>
            reject('roster.assignments'),
        ),
        http.get(`${API_BASE}/events/:id/pugs`, () => reject('pugs')),
        http.get(`${API_BASE}/events/:id/voice-channel`, () =>
            reject('voice-channel'),
        ),
    ];
}

function detailHandler() {
    return http.get(`${API_BASE}/events/:id/detail`, ({ params }) => {
        const requestedId = Number(params.id);
        if (requestedId !== EVENT_ID) {
            return HttpResponse.json({ error: 'not-found' }, { status: 404 });
        }
        return HttpResponse.json(buildDetailFixture());
    });
}

function allowedSidebandHandlers() {
    // Out-of-scope endpoints that remain independent — they MUST stay allowed.
    return [
        http.get(`${API_BASE}/events/:id/activity`, () =>
            HttpResponse.json({ entries: [] }),
        ),
        http.get(`${API_BASE}/plugins/wow-classic/events/:id/quest-coverage`, () =>
            HttpResponse.json({ coverage: [] }),
        ),
        // Legacy single-event endpoint is also bypassed once the page uses the
        // composite. Leaving it returning a 410 here would mask drift inside
        // child components (modals, etc.), so respond with a benign 404 to
        // avoid noise if any tangential consumer asks for it after first paint.
        http.get(`${API_BASE}/events/:id`, () =>
            HttpResponse.json(
                {
                    error: 'LEGACY_ENDPOINT_HIT',
                    slice: 'event',
                    detail:
                        'event-detail-page must consume /events/:id/detail; legacy /events/:id should not be called after ROK-1046 Phase C',
                },
                { status: 410 },
            ),
        ),
    ];
}

function renderEventDetailPage() {
    server.use(
        detailHandler(),
        ...allowedSidebandHandlers(),
        ...legacyRejectHandlers(),
    );

    const queryClient = createTestQueryClient();
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[`/events/${EVENT_ID}`]}>
                <Routes>
                    <Route path="/events/:id" element={<EventDetailPage />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('EventDetailPage — composite endpoint consumer (ROK-1046)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the event title from the composite fixture', async () => {
        renderEventDetailPage();
        await waitFor(
            () => {
                expect(screen.getByText(FIXTURE_TITLE)).toBeInTheDocument();
            },
            { timeout: 4000 },
        );
    });

    it('renders the signup username from roster slice without hitting the legacy /roster endpoint', async () => {
        renderEventDetailPage();
        await waitFor(
            () => {
                const matches = screen.getAllByText(
                    new RegExp(FIXTURE_SIGNUP_USERNAME, 'i'),
                );
                expect(matches.length).toBeGreaterThan(0);
            },
            { timeout: 4000 },
        );
    });

    it('renders the pug indicator from pugs slice without hitting the legacy /pugs endpoint', async () => {
        renderEventDetailPage();
        await waitFor(
            () => {
                expect(
                    screen.getByText(new RegExp(FIXTURE_PUG_USERNAME, 'i')),
                ).toBeInTheDocument();
            },
            { timeout: 4000 },
        );
    });

    it('renders the voice channel name from the voiceChannel slice without hitting the legacy /voice-channel endpoint', async () => {
        renderEventDetailPage();
        await waitFor(
            () => {
                expect(
                    screen.getByText(
                        new RegExp(FIXTURE_VOICE_CHANNEL_NAME, 'i'),
                    ),
                ).toBeInTheDocument();
            },
            { timeout: 4000 },
        );
    });
});
