/**
 * ROK-2226 — default MSW handlers for the event discussion card: every event
 * has no discussion (`state: 'none'`), so pages that mount the card render
 * nothing extra. ROK-2272 S9: the same default for the scheduling-poll and
 * lineup cards. Tests override with `server.use(...)`.
 */
import { http, HttpResponse } from 'msw';
import type { EventDiscussion } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';

const NONE: EventDiscussion = { state: 'none' };

export const eventDiscussionHandlers = [
    http.get(`${API_BASE}/events/:id/discussion`, () =>
        HttpResponse.json(NONE),
    ),
    http.get(`${API_BASE}/scheduling-polls/:id/discussion`, () =>
        HttpResponse.json(NONE),
    ),
    http.get(`${API_BASE}/lineups/:id/discussion`, () =>
        HttpResponse.json(NONE),
    ),
];
