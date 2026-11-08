/** ROK-2137 — the "Changed in game" notice inside the Forever "Guild message" card: editor-only, Adopt, Push, pending, errors. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { GuildIngameGameText, GuildIngameText, GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    buildGameReport, buildGuildIngameText, buildIngameField, guildIngameGameActionHandler, guildIngameTextGetHandler,
} from '../../../test/mocks/guild-ingame-text-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import GuildTextWidget from './guild-text-widget';
import { GAME_NOTICE_COPY } from './guild-text.helpers';
import { useGuildTextDialog } from './guild-text-dialog-store';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/toast', () => ({ toast: { error: toastError, success: vi.fn() } }));

const HUB_MOTD = 'Raid tonight 8pm';
const GAME_MOTD = 'Raid moved to 9pm\nBring flasks';

function ctx(): HubWidgetCtx {
    const page = { guild: { id: 5, kind: 'wow_guild', gameSlug: WOW_FOREVER_GAME_SLUG } } as GuildPage;
    return { page, gameSlug: WOW_FOREVER_GAME_SLUG } as HubWidgetCtx;
}

function text(game: GuildIngameGameText | undefined, motd: string | null = HUB_MOTD, canEdit = true): GuildIngameText {
    const base = buildGuildIngameText(motd === null ? null : buildIngameField({ text: motd }), buildIngameField({ text: 'Loot: EPGP' }), canEdit);
    return game === undefined ? base : { ...base, game };
}

const CHANGED = text({ motd: buildGameReport({ gameText: GAME_MOTD }), info: buildGameReport({ gameText: 'Loot: EPGP', changedInGame: false }) });
const ADOPTED = text({ motd: buildGameReport({ gameText: GAME_MOTD, changedInGame: false }), info: null }, GAME_MOTD);
const PUSHED = text({ motd: buildGameReport({ gameText: GAME_MOTD, changedInGame: false }), info: null });

async function renderCard(body: GuildIngameText): Promise<void> {
    server.use(guildIngameTextGetHandler(body));
    renderWithProviders(<GuildTextWidget {...ctx()} />);
    await screen.findByTestId('guild-text-motd');
}

const notice = (field: 'motd' | 'info') => screen.queryByTestId(`guild-text-${field}-game`);

beforeEach(() => {
    toastError.mockClear();
    useGuildTextDialog.setState({ guildId: null });
});

describe('Changed in game notice (ROK-2137)', () => {
    it('shows an editor the in-game text with both actions only on the changed field', async () => {
        await renderCard(CHANGED);
        const box = await screen.findByTestId('guild-text-motd-game');
        expect(box).toHaveTextContent(/Changed in game · /);
        expect(within(box).getByTestId('guild-text-motd-game-text').textContent).toBe(GAME_MOTD);
        expect(within(box).getByRole('button', { name: GAME_NOTICE_COPY.adopt })).toBeEnabled();
        expect(within(box).getByRole('button', { name: GAME_NOTICE_COPY.keep })).toBeEnabled();
        expect(notice('info'), 'an unchanged field has no notice').toBeNull();
    });

    it('shows nothing when no field changed in game', async () => {
        await renderCard(PUSHED);
        expect(notice('motd')).toBeNull();
        expect(notice('info')).toBeNull();
    });

    it('never shows a non-editor the notice (no game block)', async () => {
        await renderCard(text(undefined, HUB_MOTD, false));
        expect(notice('motd')).toBeNull();
        expect(screen.queryByText(/Changed in game/)).toBeNull();
    });

    it('shows the notice on an empty hub instead of only the Add hint', async () => {
        server.use(guildIngameTextGetHandler({ ...buildGuildIngameText(null, null, true), game: { motd: buildGameReport(), info: null } }));
        renderWithProviders(<GuildTextWidget {...ctx()} />);
        expect(await screen.findByTestId('guild-text-motd-game')).toBeInTheDocument();
    });

});

describe('Changed in game actions (ROK-2137)', () => {
    it('Use in-game text adopts it: the card shows the in-game text and the notice goes', async () => {
        server.use(guildIngameGameActionHandler('motd', 'adopt', ADOPTED));
        await renderCard(CHANGED);
        fireEvent.click(await screen.findByRole('button', { name: GAME_NOTICE_COPY.adopt }));
        await waitFor(() => expect(screen.getByTestId('guild-text-motd-text').textContent).toBe(GAME_MOTD));
        expect(notice('motd')).toBeNull();
    });

    it('Keep hub text pushes: the hub text stays, the notice goes and the Copy hint shows', async () => {
        server.use(guildIngameGameActionHandler('motd', 'push', PUSHED));
        await renderCard(CHANGED);
        fireEvent.click(await screen.findByRole('button', { name: GAME_NOTICE_COPY.keep }));
        expect(await screen.findByTestId('guild-text-motd-kept')).toHaveTextContent(GAME_NOTICE_COPY.keptHint);
        expect(notice('motd')).toBeNull();
        expect(screen.getByTestId('guild-text-motd-text').textContent).toBe(HUB_MOTD);
    });

    it('disables both actions while a request is pending', async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        server.use(guildIngameGameActionHandler('motd', 'push', PUSHED, gate));
        await renderCard(CHANGED);
        fireEvent.click(await screen.findByRole('button', { name: GAME_NOTICE_COPY.keep }));
        const box = screen.getByTestId('guild-text-motd-game');
        await waitFor(() => expect(within(box).getByRole('button', { name: GAME_NOTICE_COPY.adopt })).toBeDisabled());
        expect(within(box).getByTestId('guild-text-motd-keep')).toBeDisabled();
        release();
        await waitFor(() => expect(notice('motd')).toBeNull());
    });

    it('toasts an error and keeps the notice when the action fails', async () => {
        server.use(guildIngameGameActionHandler('motd', 'adopt', { status: 409 }));
        await renderCard(CHANGED);
        fireEvent.click(await screen.findByRole('button', { name: GAME_NOTICE_COPY.adopt }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith(GAME_NOTICE_COPY.adoptError));
        expect(notice('motd')).not.toBeNull();
    });

    it('clamps long in-game text behind Show all', async () => {
        const long = 'Line\n'.repeat(8) + 'end';
        await renderCard(text({ motd: buildGameReport({ gameText: long }), info: null }));
        const toggle = await screen.findByRole('button', { name: GAME_NOTICE_COPY.showAll });
        expect(screen.getByTestId('guild-text-motd-game-text')).toHaveClass('line-clamp-3');
        fireEvent.click(toggle);
        expect(screen.getByTestId('guild-text-motd-game-text')).not.toHaveClass('line-clamp-3');
        expect(screen.getByRole('button', { name: GAME_NOTICE_COPY.showLess })).toBeInTheDocument();
    });
});
