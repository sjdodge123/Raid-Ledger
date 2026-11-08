/** ROK-2136 AC12–AC14 — the Forever "Guild message" card: probe, member/editor states, copy fidelity. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildIngameText, GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    buildGuildIngameText, buildIngameField, guildIngameTextGetHandler,
} from '../../../test/mocks/guild-ingame-text-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { guildIngameTextKey, useGuildTextVisible } from '../hooks/use-guild-ingame-text';
import GuildTextWidget, { COPY_LABEL, GUILD_TEXT_EMPTY_HINT, NOT_SET_COPY } from './guild-text-widget';
import { GuildTextAction } from './guild-text-action';
import { useGuildTextDialog } from './guild-text-dialog-store';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/toast', () => ({ toast: { error: toastError, success: vi.fn() } }));

const MOTD = 'Raid tonight 8pm\nBring <b>flasks</b>';
const INFO = 'Loot: EPGP\nDiscord: see the hub';

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'wow_guild', gameSlug: WOW_FOREVER_GAME_SLUG },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id`; rights come from the text response (session-note test idiom).
    return { page, gameSlug: WOW_FOREVER_GAME_SLUG } as HubWidgetCtx;
}

const Card = (): JSX.Element => <><GuildTextAction {...ctx()} /><GuildTextWidget {...ctx()} /></>;

function serve(body: GuildIngameText | 'forbidden'): void { server.use(guildIngameTextGetHandler(body)); }

function probe() {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useGuildTextVisible(ctx()), { wrapper });
    // Settled = the GET answered (success or a refused 403), so a `false` is the final answer, not "still loading".
    const settled = () => waitFor(() => expect(client.getQueryState(guildIngameTextKey(5))?.status).not.toBe('pending'));
    return { ...hook, settled };
}

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
    toastError.mockClear();
    writeText.mockReset().mockResolvedValue(undefined);
    useGuildTextDialog.setState({ guildId: null });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

/** The globals these specs stub, captured once so `afterEach` puts back exactly what jsdom had. */
const ORIGINAL = {
    secure: Object.getOwnPropertyDescriptor(window, 'isSecureContext'),
    clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
    execCommand: Object.getOwnPropertyDescriptor(document, 'execCommand'),
};

function restore(target: object, key: string, original: PropertyDescriptor | undefined): void {
    if (original === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, original);
}

afterEach(() => {
    restore(window, 'isSecureContext', ORIGINAL.secure);
    restore(navigator, 'clipboard', ORIGINAL.clipboard);
    restore(document, 'execCommand', ORIGINAL.execCommand);
});

describe('useGuildTextVisible (AC12)', () => {
    it('hides the card from a member when nothing is set', async () => {
        serve(buildGuildIngameText(null, null));
        const { result, settled } = probe();
        await settled();
        expect(result.current).toBe(false);
    });

    it('shows the card to a member once either field is set', async () => {
        serve(buildGuildIngameText(null, buildIngameField({ text: INFO })));
        const { result } = probe();
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('shows the empty card to an editor', async () => {
        serve(buildGuildIngameText(null, null, true));
        const { result } = probe();
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('stays hidden when the route refuses (non-member 403)', async () => {
        serve('forbidden');
        const { result, settled } = probe();
        await settled();
        expect(result.current).toBe(false);
    });
});

describe('GuildTextWidget, member (AC13)', () => {
    it('renders each set field as plain text with its line breaks, the updated line, and no Edit', async () => {
        serve(buildGuildIngameText(buildIngameField({ text: MOTD }), buildIngameField({ text: INFO, updatedBy: null })));
        renderWithProviders(<Card />);
        const motd = await screen.findByTestId('guild-text-motd-text');
        expect(motd.textContent).toBe(MOTD);
        expect(motd.querySelector('b')).toBeNull();
        expect(screen.getByTestId('guild-text-info-text').textContent).toBe(INFO);
        expect(screen.getByTestId('guild-text-motd-updated')).toHaveTextContent(/^Updated .+ by Mira$/);
        expect(screen.getByTestId('guild-text-info-updated')).toHaveTextContent(/by a former member$/);
        expect(screen.queryByTestId('guild-text-edit')).toBeNull();
        expect(screen.getAllByRole('button', { name: COPY_LABEL })).toHaveLength(2);
    });

    it('omits an unset field for a member', async () => {
        serve(buildGuildIngameText(buildIngameField({ text: MOTD }), null));
        renderWithProviders(<Card />);
        await screen.findByTestId('guild-text-motd-text');
        expect(screen.queryByTestId('guild-text-info')).toBeNull();
    });
});

describe('GuildTextWidget, editor (AC12/AC15)', () => {
    it('shows the empty hint with "Add guild text", which opens the editor', async () => {
        serve(buildGuildIngameText(null, null, true));
        renderWithProviders(<Card />);
        expect(await screen.findByTestId('guild-text-hint')).toHaveTextContent(GUILD_TEXT_EMPTY_HINT);
        expect(screen.queryByTestId('guild-text-edit')).toBeNull();
        fireEvent.click(screen.getByTestId('guild-text-add'));
        expect(useGuildTextDialog.getState().guildId).toBe(5);
    });

    it('shows "Not set" for an empty field and the header Edit once text exists', async () => {
        serve(buildGuildIngameText(buildIngameField({ text: MOTD }), null, true));
        renderWithProviders(<Card />);
        expect(await screen.findByTestId('guild-text-info')).toHaveTextContent(NOT_SET_COPY);
        fireEvent.click(await screen.findByTestId('guild-text-edit'));
        expect(useGuildTextDialog.getState().guildId).toBe(5);
    });

    it('closes the open editor when the card unmounts (leaving the hub)', async () => {
        serve(buildGuildIngameText(null, null, true));
        const { unmount } = renderWithProviders(<Card />);
        fireEvent.click(await screen.findByTestId('guild-text-add'));
        expect(useGuildTextDialog.getState().guildId).toBe(5);
        unmount();
        expect(useGuildTextDialog.getState().guildId).toBeNull();
    });
});

describe('Copy for in-game (AC14)', () => {
    it('copies exactly the stored text, line breaks included, and confirms "Copied"', async () => {
        serve(buildGuildIngameText(buildIngameField({ text: MOTD }), buildIngameField({ text: INFO })));
        renderWithProviders(<Card />);
        const block = await screen.findByTestId('guild-text-motd');
        fireEvent.click(within(block).getByRole('button', { name: COPY_LABEL }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(writeText.mock.calls[0]?.[0]).toBe(MOTD);
        expect(await within(block).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('shows the copy error toast when the clipboard refuses', async () => {
        writeText.mockRejectedValue(new Error('denied'));
        Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
        serve(buildGuildIngameText(buildIngameField({ text: MOTD }), null));
        renderWithProviders(<Card />);
        const block = await screen.findByTestId('guild-text-motd');
        fireEvent.click(within(block).getByRole('button', { name: COPY_LABEL }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to copy'));
        expect(within(block).queryByRole('button', { name: 'Copied' })).toBeNull();
    });
});
