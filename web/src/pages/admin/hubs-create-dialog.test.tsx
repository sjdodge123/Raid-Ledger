/**
 * ROK-2095 — Create hub: the Game and Leader pickers carry VISIBLE labels (the
 * `Combobox` `label` prop is only an aria-label, so `getByLabelText` alone
 * passed while the operator saw two unlabelled boxes), and the leader is picked
 * from the shared member picker, not typed as free text. ROK-2096: the admin
 * may also pick the hub's first members.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { setAuthToken } from '../../hooks/use-auth';
import { adminHubsHandlers, makeAdminHubsStore, type AdminHubsStore } from '../../test/handlers/admin-hubs';
import { CreateHubDialog } from './hubs-create-dialog';

vi.mock('../../hooks/use-game-search', () => ({
    useGameSearch: () => ({ data: { data: [{ id: 77, name: 'World of Warcraft: Forever' }] }, isFetching: false }),
}));

const members = [
    { id: 9, username: 'hiphoptobop', avatar: 'https://cdn.example.test/hiphop.png', steamLinked: false },
    { id: 10, username: 'tav', avatar: null, steamLinked: false },
];

let store: AdminHubsStore;

beforeEach(() => {
    setAuthToken('test-token');
    store = makeAdminHubsStore();
    server.use(
        ...adminHubsHandlers(store),
        http.get('http://localhost:3000/users', () =>
            HttpResponse.json({ data: members, meta: { total: 2, page: 1, limit: 20, hasMore: false } })),
    );
});

async function fillGameNameBlurb(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<void> {
    await user.type(within(dialog).getByRole('combobox', { name: /^Game/ }), 'Wo');
    await user.click(await screen.findByRole('option', { name: 'World of Warcraft: Forever' }));
    await user.type(within(dialog).getByRole('textbox', { name: /Hub name/ }), 'Gamergoons');
    await user.type(within(dialog).getByRole('textbox', { name: /Blurb/ }), 'Forever raiders');
}

function open() {
    renderWithProviders(<CreateHubDialog onClose={() => undefined} />);
    return screen.getByRole('dialog');
}

describe('CreateHubDialog (ROK-2095)', () => {
    it('labels the Game and Leader pickers with visible <label>s, not only aria-labels', () => {
        const dialog = open();
        for (const name of ['Game', 'Leader']) {
            const input = within(dialog).getByRole('combobox', { name: new RegExp(`^${name}`) });
            expect(input).not.toHaveAttribute('aria-label');
            expect(input).toBeInstanceOf(HTMLInputElement);
            const labels = input instanceof HTMLInputElement ? input.labels : null;
            expect(labels?.[0]?.textContent).toMatch(new RegExp(`^${name}`));
        }
        expect(within(dialog).getByText(/join from the hub page once it is live/)).toBeInTheDocument();
    });

    it('picks the leader from member rows with avatars and posts leaderUserId', async () => {
        const user = userEvent.setup();
        const dialog = open();
        await fillGameNameBlurb(user, dialog);
        await user.type(within(dialog).getByRole('combobox', { name: /^Leader/ }), 'hip');
        const option = await screen.findByRole('option', { name: 'hiphoptobop' });
        expect(option.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.test/hiphop.png');
        await user.click(option);
        await user.click(within(dialog).getByRole('button', { name: 'Create' }));
        await waitFor(() => expect(store.requests).toContainEqual({
            method: 'POST', path: '/admin/hubs',
            body: { gameId: 77, leaderUserId: 9, name: 'Gamergoons', blurb: 'Forever raiders' },
        }));
    });

    it('editing the leader text after a pick clears it, so Create cannot send a stale leader', async () => {
        const user = userEvent.setup();
        const dialog = open();
        await fillGameNameBlurb(user, dialog);
        const leader = within(dialog).getByRole('combobox', { name: /^Leader/ });
        const create = within(dialog).getByRole('button', { name: 'Create' });
        await user.type(leader, 'hip');
        await user.click(await screen.findByRole('option', { name: 'hiphoptobop' }));
        expect(create).toBeEnabled();
        await user.type(leader, 'x');
        expect(create).toBeDisabled();
    });

    it('ROK-2096: posts the picked members as memberUserIds and hides the leader from the list', async () => {
        const user = userEvent.setup();
        const dialog = open();
        await fillGameNameBlurb(user, dialog);
        await user.type(within(dialog).getByRole('combobox', { name: /^Leader/ }), 'hip');
        await user.click(await screen.findByRole('option', { name: 'hiphoptobop' }));
        expect(within(dialog).getByText('Members (optional)')).toBeInTheDocument();
        await user.click(within(await within(dialog).findByTestId('invitee-option-10')).getByRole('checkbox'));
        expect(within(dialog).queryByTestId('invitee-option-9')).not.toBeInTheDocument();
        expect(within(dialog).getByText('1 member selected')).toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: 'Create' }));
        await waitFor(() => expect(store.requests).toContainEqual({
            method: 'POST', path: '/admin/hubs',
            body: { gameId: 77, leaderUserId: 9, name: 'Gamergoons', blurb: 'Forever raiders', memberUserIds: [10] },
        }));
    });
});
