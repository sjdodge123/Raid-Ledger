/** ROK-1968 §8.4 T-W1–T-W3 — the "Before next session" card: probe, member/editor states, optimistic tick. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    NOTE_UPDATED_AT, SESSION_NOTE_ITEM_URL, buildSessionNote, buildSessionNoteResponse,
    sessionNoteGetHandler, sessionNoteTickHandler,
} from '../../../test/mocks/hub-session-note-handlers';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import HubSessionNoteWidget, { SESSION_NOTE_EMPTY_HINT } from './hub-session-note-widget';
import { HubSessionNoteAction } from './hub-session-note-action';
import { useSessionNoteVisible } from './use-session-note-visible';
import { ITEM_GONE_TOAST } from './use-hub-session-note';
import { sessionNoteKey, sessionNoteQuery } from './hub-session-note-query';
import { editedByLine, formatClearAfter } from './session-note.helpers';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/toast', () => ({ toast: { error: toastError, success: vi.fn() } }));

beforeEach(() => { toastError.mockClear(); });

function ctx(canEdit = false): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'game_community', gameSlug: 'valheim' },
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id` (register.test idiom); rights come from the note response.
    return { page, gameSlug: 'valheim' } as HubWidgetCtx;
}

const Card = (): JSX.Element => <><HubSessionNoteAction {...ctx()} /><HubSessionNoteWidget {...ctx()} /></>;
const item = (id: number): HTMLInputElement => screen.getByTestId(`session-note-item-${id}`) as HTMLInputElement;

function probe() {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return renderHook(() => useSessionNoteVisible(ctx()), { wrapper });
}

/** A PATCH that waits for `release()` before answering `status`, so the optimistic state is observable. */
function gatedTick(status: number) {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.patch(SESSION_NOTE_ITEM_URL, async () => {
        await gate;
        return HttpResponse.json({ statusCode: status, message: 'Checklist item not found' }, { status });
    }));
    return () => release();
}

describe('useSessionNoteVisible (T-W1)', () => {
    it('hides the card from a member when there is no note', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(null)));
        const { result } = probe();
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('keeps the card for an editor with no note, and shows a member the card once a note exists', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(null, { canEdit: true })));
        const editor = probe();
        await waitFor(() => expect(editor.result.current).toBe(true));
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote())));
        const member = probe();
        await waitFor(() => expect(member.result.current).toBe(true));
    });

    it('hides the card from a visitor (the route 404s)', async () => {
        server.use(sessionNoteGetHandler('not-found'));
        const client = createTestQueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
        const { result } = renderHook(() => ({ visible: useSessionNoteVisible(ctx()), query: useQuery(sessionNoteQuery(5)) }), { wrapper });
        await waitFor(() => expect(result.current.query.isError).toBe(true));
        expect(result.current.visible).toBe(false);
    });
});

describe('HubSessionNoteWidget — states (T-W1, T-W2)', () => {
    it('gives an editor with no note the one-line hint and "Add note"', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(null, { canEdit: true })));
        renderWithProviders(<Card />);
        const hint = await screen.findByTestId('session-note-hint');
        expect(hint.textContent).toContain(SESSION_NOTE_EMPTY_HINT);
        expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
        expect(screen.queryByTestId('session-note-edit')).toBeNull();
    });

    it('shows a member the Markdown body, tickable boxes and the edited-by line, with no Edit action', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote())));
        renderWithProviders(<Card />);
        const body = await screen.findByTestId('session-note-body');
        expect(body.querySelector('strong')?.textContent).toBe('20 potions');
        expect(item(1).disabled).toBe(false);
        expect(item(1).checked).toBe(false);
        expect(item(2).checked).toBe(true);
        expect(screen.getByText(/^Edited by Mira · /)).toBeTruthy();
        expect(screen.queryByTestId('session-note-edit')).toBeNull();
        expect(screen.queryByTestId('session-note-hint')).toBeNull();
    });

    it('gives an editor the header Edit action and names the pinned event', async () => {
        const clearAfter = { eventId: 3, title: 'Session 14', startTime: '2026-10-29T20:00:00Z', endTime: '2026-10-29T23:00:00Z' };
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote({ clearAfter }), { canEdit: true })));
        renderWithProviders(<Card />);
        expect(await screen.findByTestId('session-note-edit')).toBeTruthy();
        expect(screen.getByTestId('session-note-clear-after').textContent).toBe(`Clears after ${formatClearAfter(clearAfter)}`);
    });

    it('disables the boxes for a viewer without canTick', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote(), { canTick: false })));
        renderWithProviders(<Card />);
        await screen.findByTestId('session-note-body');
        expect(item(1).disabled).toBe(true);
    });
});

describe('HubSessionNoteWidget — ticking (T-W3)', () => {
    it('ticks optimistically and stores the server copy with updatedAt verbatim', async () => {
        const base = buildSessionNoteResponse(buildSessionNote());
        server.use(sessionNoteGetHandler(base), sessionNoteTickHandler(base));
        const queryClient = createTestQueryClient();
        renderWithProviders(<Card />, { queryClient });
        await screen.findByTestId('session-note-body');
        fireEvent.click(item(1));
        await waitFor(() => expect(item(1).checked).toBe(true));
        await waitFor(() => expect(queryClient.isMutating()).toBe(0));
        expect(item(1).checked).toBe(true);
        const cached = queryClient.getQueryData<typeof base>(sessionNoteKey(5));
        expect(cached?.note?.updatedAt).toBe(NOTE_UPDATED_AT);
    });

    it('rolls a tick back when the server fails (500), without the item-gone toast', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote())));
        const release = gatedTick(500);
        renderWithProviders(<Card />);
        await screen.findByTestId('session-note-body');
        fireEvent.click(item(1));
        // The PATCH is held at the gate, so a checked box here can only be the optimistic write.
        await waitFor(() => expect(item(1).checked).toBe(true));
        release();
        await waitFor(() => expect(item(1).checked).toBe(false));
        expect(toastError).not.toHaveBeenCalled();
    });

    it('rolls back and toasts when the item is gone (404)', async () => {
        server.use(sessionNoteGetHandler(buildSessionNoteResponse(buildSessionNote())));
        const release = gatedTick(404);
        renderWithProviders(<Card />);
        await screen.findByTestId('session-note-body');
        fireEvent.click(item(2));
        await waitFor(() => expect(item(2).checked).toBe(false));
        release();
        await waitFor(() => expect(toastError).toHaveBeenCalledWith(ITEM_GONE_TOAST));
        expect(item(2).checked).toBe(true);
    });
});

describe('session-note helpers', () => {
    it('editedByLine names the editor, or a former member once the account is gone', () => {
        const now = Date.parse('2026-10-27T12:00:00Z');
        expect(editedByLine(buildSessionNote(), now)).toBe('Edited by Mira · 1 h ago');
        expect(editedByLine(buildSessionNote({ updatedBy: null }), now)).toBe('Edited by A former member · 1 h ago');
    });

    it('formatClearAfter is "<title> · <weekday> <time> am|pm"', () => {
        const label = formatClearAfter({ eventId: 1, title: 'Session 14', startTime: '2026-10-29T20:00:00Z', endTime: '2026-10-29T23:00:00Z' });
        expect(label).toMatch(/^Session 14 · [A-Z][a-z]{2} \d{1,2}:\d{2} (am|pm)$/);
    });
});
