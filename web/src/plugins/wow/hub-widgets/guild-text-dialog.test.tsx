/** ROK-2136 AC15/AC16 — the "Guild message" editor: save body, caps + counters, warnings, 409, dirty close. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildIngameText, PutGuildIngameText } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    GUILD_INGAME_TEXT_URL, INFO_UPDATED_AT, MOTD_UPDATED_AT, buildGuildIngameText, buildIngameField,
    guildIngameTextGetHandler,
} from '../../../test/mocks/guild-ingame-text-handlers';
import GuildTextDialog, { CONFLICT_COPY, PASTE_HINT } from './guild-text-dialog';
import { CONTROL_CHAR_COPY, WARNING_COPY } from './guild-text.helpers';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const MINE = buildGuildIngameText(
    buildIngameField({ text: 'Raid tonight' }),
    buildIngameField({ text: 'Loot: EPGP', updatedAt: INFO_UPDATED_AT }),
    true,
);
const THEIRS = buildGuildIngameText(
    buildIngameField({ text: 'Their MOTD', updatedAt: '2026-11-08T11:00:00.000001Z', updatedBy: 'Brann' }),
    MINE.info,
    true,
);

/** PUT handler that records each body and answers 409 (with THEIRS) the first `conflicts` times. */
function capturePut(conflicts = 0) {
    const bodies: PutGuildIngameText[] = [];
    server.use(http.put(GUILD_INGAME_TEXT_URL, async ({ request }) => {
        bodies.push((await request.json()) as PutGuildIngameText);
        if (bodies.length <= conflicts) {
            return HttpResponse.json({ statusCode: 409, message: 'Guild text changed', ingameText: THEIRS }, { status: 409 });
        }
        return HttpResponse.json(MINE);
    }));
    return bodies;
}

async function renderDialog(response: GuildIngameText = MINE) {
    server.use(guildIngameTextGetHandler(response));
    const onClose = vi.fn();
    renderWithProviders(<GuildTextDialog guildId={5} onClose={onClose} />);
    await screen.findAllByTestId('guild-text-input-motd');
    return onClose;
}

const input = (field: 'motd' | 'info'): HTMLTextAreaElement => screen.getByTestId(`guild-text-input-${field}`) as HTMLTextAreaElement;
const type = (field: 'motd' | 'info', text: string): void => { fireEvent.change(input(field), { target: { value: text } }); };

beforeEach(() => { media.desktop = true; });

describe('GuildTextDialog save (AC15)', () => {
    it('sends both texts and each loaded updatedAt verbatim, then closes', async () => {
        const bodies = capturePut();
        const onClose = await renderDialog();
        type('motd', 'Raid moved to 9pm');
        fireEvent.click(screen.getByTestId('guild-text-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(bodies[0]).toEqual({
            motd: 'Raid moved to 9pm', info: 'Loot: EPGP',
            baseMotdUpdatedAt: MOTD_UPDATED_AT, baseInfoUpdatedAt: INFO_UPDATED_AT,
        });
    });

    it('sends null bases for unset fields', async () => {
        const bodies = capturePut();
        const onClose = await renderDialog(buildGuildIngameText(null, null, true));
        type('info', 'Recruiting healers');
        fireEvent.click(screen.getByTestId('guild-text-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(bodies[0]).toEqual({ motd: '', info: 'Recruiting healers', baseMotdUpdatedAt: null, baseInfoUpdatedAt: null });
    });

    it('caps each textarea at the in-game length with the shared counter, and shows the paste hint', async () => {
        await renderDialog();
        expect(input('motd').maxLength).toBe(255);
        expect(input('info').maxLength).toBe(499);
        expect(within(screen.getByTestId('guild-text-field-motd')).getByTestId('textarea-count')).toHaveTextContent(/12\s*\/\s*255/);
        expect(within(screen.getByTestId('guild-text-field-info')).getByTestId('textarea-count')).toHaveTextContent(/10\s*\/\s*499/);
        expect(screen.getByTestId('guild-text-paste-hint')).toHaveTextContent(PASTE_HINT);
    });
});

describe('GuildTextDialog warnings (AC16)', () => {
    it('warns on | and emoji under the field but still saves', async () => {
        const bodies = capturePut();
        const onClose = await renderDialog();
        type('info', 'Use |cffff0000red|r and 🐉');
        const warnings = await screen.findByTestId('guild-text-warnings-info');
        expect(warnings).toHaveTextContent(WARNING_COPY.pipe);
        expect(warnings).toHaveTextContent(WARNING_COPY.astral);
        expect(screen.queryByTestId('guild-text-warnings-motd')).toBeNull();
        fireEvent.click(screen.getByTestId('guild-text-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(bodies[0]?.info).toBe('Use |cffff0000red|r and 🐉');
    });

    it('warns on a line break in the MOTD only', async () => {
        await renderDialog();
        type('motd', 'Line one\nLine two');
        type('info', 'Line one\nLine two');
        expect(await screen.findByTestId('guild-text-warnings-motd')).toHaveTextContent(WARNING_COPY['newline-in-motd']);
        expect(screen.queryByTestId('guild-text-warnings-info')).toBeNull();
    });

    it('blocks Save on a control character the server rejects', async () => {
        await renderDialog();
        type('motd', 'Tab\there');
        expect(await screen.findByText(CONTROL_CHAR_COPY)).toBeInTheDocument();
        expect(screen.getByTestId('guild-text-save')).toBeDisabled();
    });
});

describe('GuildTextDialog conflict + close (AC15)', () => {
    it('on a 409 keeps the draft, shows the banner, and "Load their version" rebases the next save', async () => {
        const bodies = capturePut(1);
        const onClose = await renderDialog();
        type('motd', 'My edit');
        fireEvent.click(screen.getByTestId('guild-text-save'));
        expect(await screen.findByTestId('guild-text-conflict')).toHaveTextContent(CONFLICT_COPY);
        expect(input('motd').value).toBe('My edit');
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('guild-text-load-theirs'));
        fireEvent.click(await screen.findByTestId('discard-changes-discard'));
        await waitFor(() => expect(input('motd').value).toBe('Their MOTD'));
        type('motd', 'Their MOTD, edited');
        fireEvent.click(screen.getByTestId('guild-text-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(bodies[1]?.baseMotdUpdatedAt).toBe('2026-11-08T11:00:00.000001Z');
    });

    it('asks before discarding a dirty draft, and closes a clean one at once', async () => {
        const onClose = await renderDialog();
        type('info', 'Changed');
        fireEvent.click(screen.getByTestId('guild-text-cancel'));
        expect(await screen.findByTestId('discard-changes-confirm')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
});
