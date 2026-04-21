/**
 * ROK-1063 — failing TDD tests for the StartLineupModal.
 *
 * Validates the new title + description fields on the "Start Community
 * Lineup" modal:
 *   - Title input is rendered, required, and pre-filled with
 *     `Lineup — <current month year>` (no zero padding).
 *   - Description textarea is rendered with a character counter that
 *     updates as the user types and caps at 500.
 *   - Submission without a title is blocked (mutation not called,
 *     inline error shown).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { StartLineupModal } from './start-lineup-modal';

vi.mock('../../hooks/use-lineups', () => ({
    useCreateLineup: vi.fn(),
}));

vi.mock('../../hooks/admin/use-lineup-settings', () => ({
    useLineupSettings: vi.fn(),
}));

vi.mock('../../hooks/use-postable-discord-channels', () => ({
    usePostableDiscordChannels: vi.fn(),
}));

vi.mock('../../lib/api-client', () => ({
    getPlayers: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>(
        'react-router-dom',
    );
    return { ...actual, useNavigate: () => vi.fn() };
});

import { useCreateLineup } from '../../hooks/use-lineups';
import { useLineupSettings } from '../../hooks/admin/use-lineup-settings';
import { usePostableDiscordChannels } from '../../hooks/use-postable-discord-channels';
import { getPlayers } from '../../lib/api-client';

const mutateAsync = vi.fn();

function currentMonthYear(): string {
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'long' });
    return `${month} ${now.getFullYear()}`;
}

function mockChannels(
    channels: { id: string; name: string }[],
    overrides: Partial<ReturnType<typeof usePostableDiscordChannels>> = {},
): void {
    vi.mocked(usePostableDiscordChannels).mockReturnValue({
        data: { data: channels },
        isLoading: false,
        isError: false,
        error: null,
        ...overrides,
    } as unknown as ReturnType<typeof usePostableDiscordChannels>);
}

beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync.mockResolvedValue({ id: 42 });
    vi.mocked(useCreateLineup).mockReturnValue({
        mutateAsync,
        isPending: false,
        isError: false,
        error: null,
    } as unknown as ReturnType<typeof useCreateLineup>);
    vi.mocked(useLineupSettings).mockReturnValue({
        lineupDefaults: {
            data: {
                buildingDurationHours: 48,
                votingDurationHours: 24,
                decidedDurationHours: 168,
            },
            isLoading: false,
        },
        updateDefaults: {},
    } as unknown as ReturnType<typeof useLineupSettings>);
    mockChannels([
        { id: '100000000000000001', name: 'general' },
        { id: '100000000000000002', name: 'events' },
    ]);
    vi.mocked(getPlayers).mockResolvedValue({
        data: [
            { id: 10, username: 'alice', avatar: null, discordId: 'd-10' },
            { id: 11, username: 'bob', avatar: null, discordId: null },
        ],
        meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
    } as unknown as Awaited<ReturnType<typeof getPlayers>>);
});

describe('StartLineupModal — title field', () => {
    it('renders a title input prefilled with "Lineup — <Month YYYY>"', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
        expect(titleInput).toBeInTheDocument();
        expect(titleInput.value).toBe(`Lineup — ${currentMonthYear()}`);
    });

    it('marks the title input as required', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
        expect(titleInput).toBeRequired();
    });

    it('blocks submission when title is cleared', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement;
        await user.clear(titleInput);

        const createBtn = screen.getByRole('button', { name: /create lineup/i });
        await user.click(createBtn);

        expect(mutateAsync).not.toHaveBeenCalled();
    });
});

describe('StartLineupModal — description field', () => {
    it('renders a description textarea', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    });

    it('shows a 500-character counter that updates as the user types', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        // Initial counter: 0 / 500
        expect(screen.getByText(/0\s*\/\s*500/)).toBeInTheDocument();

        const textarea = screen.getByLabelText(/description/i);
        await user.type(textarea, 'Hello world');

        // After typing 11 chars, counter reflects "11 / 500"
        expect(screen.getByText(/11\s*\/\s*500/)).toBeInTheDocument();
    });
});

describe('StartLineupModal — submits title + description', () => {
    it('passes title and description to useCreateLineup.mutateAsync', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );

        const titleInput = screen.getByLabelText(/title/i);
        await user.clear(titleInput);
        await user.type(titleInput, 'Co-op Night');

        const textarea = screen.getByLabelText(/description/i);
        await user.type(textarea, 'Casual co-op picks');

        await user.click(
            screen.getByRole('button', { name: /create lineup/i }),
        );

        expect(mutateAsync).toHaveBeenCalledTimes(1);
        expect(mutateAsync.mock.calls[0][0]).toMatchObject({
            title: 'Co-op Night',
            description: 'Casual co-op picks',
        });
    });
});

describe('StartLineupModal — channel override picker (ROK-1064)', () => {
    it('renders the "Post embeds to" picker with community default option', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const label = screen.getByLabelText(/post embeds to/i);
        expect(label).toBeInTheDocument();
        expect(
            screen.getByRole('option', { name: /use community default/i }),
        ).toBeInTheDocument();
    });

    it('renders an option per postable channel returned by the hook', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        expect(screen.getByRole('option', { name: /#general/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /#events/ })).toBeInTheDocument();
    });

    it('omits channelOverrideId from submit when "Use community default" is selected', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(
            screen.getByRole('button', { name: /create lineup/i }),
        );
        expect(mutateAsync).toHaveBeenCalledTimes(1);
        expect(
            'channelOverrideId' in mutateAsync.mock.calls[0][0],
        ).toBe(false);
    });

    it('includes channelOverrideId on submit when a channel is selected', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const select = screen.getByLabelText(/post embeds to/i);
        await user.selectOptions(select, '100000000000000002');
        await user.click(
            screen.getByRole('button', { name: /create lineup/i }),
        );
        expect(mutateAsync.mock.calls[0][0]).toMatchObject({
            channelOverrideId: '100000000000000002',
        });
    });

    it('hides the picker when the channels query errors', () => {
        mockChannels([], { isError: true, isLoading: false });
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        expect(screen.queryByLabelText(/post embeds to/i)).toBeNull();
    });
});

describe('StartLineupModal — visibility toggle + invitees (ROK-1065)', () => {
    it('renders a visibility toggle that defaults to public', () => {
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        const publicBtn = screen.getByTestId('visibility-public');
        const privateBtn = screen.getByTestId('visibility-private');
        expect(publicBtn).toHaveAttribute('aria-checked', 'true');
        expect(privateBtn).toHaveAttribute('aria-checked', 'false');
        // The invitee picker is hidden on public.
        expect(screen.queryByTestId('invitee-multi-select')).toBeNull();
    });

    it('reveals the invitee picker when switched to private', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(screen.getByTestId('visibility-private'));
        expect(
            await screen.findByTestId('invitee-multi-select'),
        ).toBeInTheDocument();
    });

    it('disables Create while private is selected and no invitees picked', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(screen.getByTestId('visibility-private'));
        const createBtn = screen.getByRole('button', { name: /create lineup/i });
        expect(createBtn).toBeDisabled();
    });

    it('enables Create once at least one invitee is picked on private', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(screen.getByTestId('visibility-private'));
        const row = await screen.findByTestId('invitee-option-10');
        await user.click(row);
        const createBtn = screen.getByRole('button', { name: /create lineup/i });
        expect(createBtn).not.toBeDisabled();
    });

    it('submits visibility + inviteeUserIds when a private lineup is created', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(screen.getByTestId('visibility-private'));
        const row = await screen.findByTestId('invitee-option-10');
        await user.click(row);
        await user.click(
            screen.getByRole('button', { name: /create lineup/i }),
        );
        expect(mutateAsync).toHaveBeenCalledTimes(1);
        expect(mutateAsync.mock.calls[0][0]).toMatchObject({
            visibility: 'private',
            inviteeUserIds: [10],
        });
    });

    it('omits visibility + inviteeUserIds from submit when public (default)', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <StartLineupModal isOpen={true} onClose={vi.fn()} />,
        );
        await user.click(
            screen.getByRole('button', { name: /create lineup/i }),
        );
        const body = mutateAsync.mock.calls[0][0];
        expect('visibility' in body).toBe(false);
        expect('inviteeUserIds' in body).toBe(false);
    });
});
