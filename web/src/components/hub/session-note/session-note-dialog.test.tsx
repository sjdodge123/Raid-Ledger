/** ROK-1968 §8.4 T-W4–T-W7 — the "Before next session" editor dialog. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubSessionNote, HubSessionNoteResponse, PutHubSessionNoteInput } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    NOTE_UPDATED_AT, SESSION_NOTE_URL, buildSessionNote, buildSessionNoteResponse, sessionNoteGetHandler,
} from '../../../test/mocks/hub-session-note-handlers';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import HubSessionNoteWidget from './hub-session-note-widget';
import SessionNoteDialog, { CONFLICT_COPY } from './session-note-dialog';
import { useSessionNoteDialog } from './session-note-dialog-store';
import { NO_NEXT_EVENT_COPY } from './session-note-form';
import { formatClearAfter } from './session-note.helpers';
import { useTimezoneStore } from '../../../stores/timezone-store';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const EVENT = { eventId: 9, title: 'Session 14', startTime: '2026-10-29T20:00:00.000Z', endTime: '2026-10-29T23:00:00.000Z' };
const THEIRS = buildSessionNote({ updatedAt: '2026-10-27T12:30:00.654321Z', items: [{ id: 3, text: 'Their row', done: false, doneAt: null }] });

function editorResponse(note: HubSessionNote | null, over: Partial<HubSessionNoteResponse> = {}): HubSessionNoteResponse {
    return { ...buildSessionNoteResponse(note, { canEdit: true }), ...over };
}

/** PUT handler that records each body and answers 409 (with THEIRS) the first `conflicts` times. */
function capturePut(conflicts = 0) {
    const bodies: PutHubSessionNoteInput[] = [];
    server.use(http.put(SESSION_NOTE_URL, async ({ request }) => {
        bodies.push((await request.json()) as PutHubSessionNoteInput);
        if (bodies.length <= conflicts) {
            return HttpResponse.json({ statusCode: 409, message: 'Note changed', note: THEIRS }, { status: 409 });
        }
        return HttpResponse.json(editorResponse(buildSessionNote({ updatedAt: '2026-10-27T13:00:00.000001Z' })));
    }));
    return bodies;
}

async function renderDialog(response: HubSessionNoteResponse) {
    server.use(sessionNoteGetHandler(response));
    const onClose = vi.fn();
    renderWithProviders(<SessionNoteDialog guildId={5} onClose={onClose} />);
    await screen.findAllByTestId('session-note-form');
    return onClose;
}

const itemInput = (i: number): HTMLInputElement => screen.getByTestId(`session-note-item-input-${i}`) as HTMLInputElement;
const type = (i: number, text: string): void => { fireEvent.change(itemInput(i), { target: { value: text } }); };

beforeEach(() => { media.desktop = true; useSessionNoteDialog.setState({ guildId: null }); });

describe('SessionNoteDialog save (T-W4)', () => {
    it('sends baseUpdatedAt verbatim and the kept item ids, then closes', async () => {
        const bodies = capturePut();
        const onClose = await renderDialog(editorResponse(buildSessionNote()));
        type(0, 'Repair all gear');
        fireEvent.click(await screen.findByTestId('session-note-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(bodies[0]).toEqual({
            body: 'Bring **20 potions**.', clearAfterNextEvent: false, baseUpdatedAt: NOTE_UPDATED_AT,
            items: [{ id: 1, text: 'Repair all gear' }, { id: 2, text: 'Finish the quest' }],
        });
    });

    it('on a 409 keeps the draft, shows the warning banner, and never closes', async () => {
        capturePut(1);
        const onClose = await renderDialog(editorResponse(buildSessionNote()));
        type(0, 'My edit');
        fireEvent.click(await screen.findByTestId('session-note-save'));
        expect(await screen.findByTestId('session-note-conflict')).toHaveTextContent(CONFLICT_COPY);
        expect(itemInput(0).value).toBe('My edit');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('"Load their version" confirms, replaces the draft and rebases the next save on their updatedAt', async () => {
        const bodies = capturePut(1);
        await renderDialog(editorResponse(buildSessionNote()));
        type(0, 'My edit');
        fireEvent.click(await screen.findByTestId('session-note-save'));
        fireEvent.click(await screen.findByTestId('session-note-load-theirs'));
        fireEvent.click(await screen.findByTestId('discard-changes-discard'));
        await waitFor(() => expect(itemInput(0).value).toBe('Their row'));
        expect(screen.queryByTestId('session-note-conflict')).toBeNull();
        type(0, 'Their row, edited');
        fireEvent.click(screen.getByTestId('session-note-save'));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[1]?.baseUpdatedAt).toBe('2026-10-27T12:30:00.654321Z');
        expect(bodies[1]?.items).toEqual([{ id: 3, text: 'Their row, edited' }]);
    });
});

describe('SessionNoteDialog close + clear (T-W5)', () => {
    it('a dirty Cancel asks to discard instead of closing', async () => {
        const onClose = await renderDialog(editorResponse(buildSessionNote()));
        fireEvent.click(screen.getByTestId('session-note-add-item'));
        type(2, 'Extra');
        fireEvent.click(screen.getByTestId('session-note-cancel'));
        expect(await screen.findByTestId('discard-changes-confirm')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a clean Cancel closes at once (an added-then-removed row is not an edit)', async () => {
        const onClose = await renderDialog(editorResponse(buildSessionNote()));
        fireEvent.click(screen.getByTestId('session-note-add-item'));
        fireEvent.click(screen.getByTestId('session-note-remove-item-2'));
        fireEvent.click(screen.getByTestId('session-note-cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('discard-changes-confirm')).toBeNull();
    });

    it('"Clear note" confirms "Clear the note for everyone?" before the DELETE', async () => {
        const deletes = vi.fn();
        server.use(http.delete(SESSION_NOTE_URL, () => { deletes(); return new HttpResponse(null, { status: 204 }); }));
        const onClose = await renderDialog(editorResponse(buildSessionNote()));
        fireEvent.click(await screen.findByTestId('session-note-clear'));
        expect(await screen.findByText('Clear the note for everyone?')).toBeInTheDocument();
        expect(deletes).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(deletes).toHaveBeenCalledTimes(1);
    });
});

describe('SessionNoteDialog clear-after checkbox (T-W6)', () => {
    it('is disabled with "No upcoming event on this hub" when there is no next event', async () => {
        await renderDialog(editorResponse(null));
        expect(await screen.findByTestId('session-note-clear-after-checkbox')).toBeDisabled();
        expect(screen.getByTestId('session-note-clear-after-hint')).toHaveTextContent(NO_NEXT_EVENT_COPY);
    });

    it('names the next event and sends clearAfterNextEvent once ticked', async () => {
        const bodies = capturePut();
        await renderDialog(editorResponse(buildSessionNote(), { nextEvent: EVENT }));
        const toggle = await screen.findByTestId('session-note-clear-after-checkbox');
        expect(toggle).toBeEnabled();
        expect(screen.getByTestId('session-note-clear-after-hint')).toHaveTextContent(`Clears after ${formatClearAfter(EVENT, useTimezoneStore.getState().resolved)}`);
        fireEvent.click(toggle);
        fireEvent.click(screen.getByTestId('session-note-save'));
        await waitFor(() => expect(bodies[0]?.clearAfterNextEvent).toBe(true));
    });
});

describe('SessionNoteDialog frame (T-W7) + card mount', () => {
    it('is a Modal at >=1024px and a BottomSheet below', async () => {
        await renderDialog(editorResponse(buildSessionNote()));
        expect(await screen.findByTestId('modal-footer')).toBeInTheDocument();
        media.desktop = false;
        await renderDialog(editorResponse(buildSessionNote()));
        expect(await screen.findByTestId('bottom-sheet-footer')).toBeInTheDocument();
    });

    it('the editor hint\'s "Add note" opens the dialog from the card', async () => {
        server.use(sessionNoteGetHandler(editorResponse(null)));
        const page = { guild: { id: 5 } } as GuildPage;
        renderWithProviders(<HubSessionNoteWidget {...({ page, gameSlug: 'valheim' } as HubWidgetCtx)} />);
        expect(screen.queryByTestId('session-note-form')).toBeNull();
        fireEvent.click(await screen.findByTestId('session-note-add'));
        expect(await screen.findByTestId('session-note-form')).toBeInTheDocument();
    });
});
