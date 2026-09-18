/**
 * ROK-1621 regression — generating a guest invite link must NOT materialise a
 * roster occupant.
 *
 * Before the fix, "Generate Invite Link" POSTed to /events/:id/pugs with no
 * discordUsername, writing an anonymous `pending` pug_slots row that rendered
 * forever as "Awaiting player · Pending" and that no cleanup path could match.
 * The link now comes from the event itself; a pug row is only materialised when
 * someone actually claims it.
 *
 * MUTATION: revert `generateInviteLink()` in invite-modal.tsx to call
 * `createPug.mutateAsync({ role })` — `pugPostCount` becomes 1 and the guest
 * list assertion fails.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { InviteModal } from './invite-modal';

const API_BASE = 'http://localhost:3000';
const EVENT_ID = 42;

let pugPostCount = 0;
let pugRows: unknown[] = [];

beforeEach(() => {
    pugPostCount = 0;
    pugRows = [];
    Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    server.use(
        http.get(`${API_BASE}/discord/members`, () => HttpResponse.json([])),
        http.get(`${API_BASE}/events/${EVENT_ID}/pugs`, () =>
            HttpResponse.json({ pugs: pugRows }),
        ),
        http.post(`${API_BASE}/events/${EVENT_ID}/pugs`, () => {
            pugPostCount += 1;
            return HttpResponse.json({ id: 'x', eventId: EVENT_ID }, { status: 201 });
        }),
        http.post(`${API_BASE}/events/${EVENT_ID}/invite-link`, () =>
            HttpResponse.json({ inviteCode: 'abcd2345' }),
        ),
    );
});

describe('InviteModal — generate invite link (ROK-1621)', () => {
    it('does not create a guest roster occupant when a link is generated', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <InviteModal isOpen onClose={() => {}} eventId={EVENT_ID} />,
        );

        await user.click(
            await screen.findByRole('button', { name: /generate invite link/i }),
        );

        // Nothing was added to the event's guest list...
        await waitFor(() => expect(pugPostCount).toBe(0));
        expect(pugRows).toHaveLength(0);
        // ...but the link is still shown to the organiser.
        expect(await screen.findByDisplayValue(/\/i\/abcd2345$/)).toBeInTheDocument();
    });
});
