/** ROK-1789 AC4/AC6/AC7/AC8 — the guild Recruitment editor: switch, rows, validation, save body, clear, discard guard. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildRecruitmentView, PutGuildRecruitmentInput } from '@raid-ledger/contract';
import { WOW_FOREVER_GAME_SLUG } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    GUILD_RECRUITMENT_URL, buildRecruitment, buildRecruitmentView, guildRecruitmentGetHandler,
} from '../../../test/mocks/guild-recruitment-handlers';
import RecruitmentDialog from './recruitment-dialog';
import { APPLY_URL_ERROR } from './recruitment.helpers';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const SAVED = buildRecruitmentView(buildRecruitment(), true);

async function renderDialog(view: GuildRecruitmentView = SAVED) {
    server.use(guildRecruitmentGetHandler(view));
    const onClose = vi.fn();
    renderWithProviders(<RecruitmentDialog guildId={5} gameSlug={WOW_FOREVER_GAME_SLUG} onClose={onClose} />);
    await screen.findByTestId('recruitment-apply-url');
    return onClose;
}

function capturePut(): PutGuildRecruitmentInput[] {
    const bodies: PutGuildRecruitmentInput[] = [];
    server.use(http.put(GUILD_RECRUITMENT_URL, async ({ request }) => {
        const body = (await request.json()) as PutGuildRecruitmentInput;
        bodies.push(body);
        return HttpResponse.json(buildRecruitmentView(body, true));
    }));
    return bodies;
}

const change = (testId: string, value: string): void => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
};
const preview = (): HTMLElement => screen.getByTestId('recruitment-headline-preview');

beforeEach(() => { media.desktop = true; });

describe('RecruitmentDialog switch + headline preview (A-D3)', () => {
    it('unticking Recruiting turns the previewed headline Closed and keeps the rows', async () => {
        await renderDialog();
        expect(preview()).toHaveTextContent('Open');
        fireEvent.click(screen.getByRole('checkbox'));
        expect(preview()).toHaveTextContent('Closed');
        expect(screen.getAllByTestId(/^recruitment-row-\d+$/)).toHaveLength(4);
    });

    it('shows the all-closed hint when every row is Closed', async () => {
        await renderDialog();
        for (const i of [0, 1, 2, 3]) change(`recruitment-state-${i}`, 'closed');
        expect(screen.getByTestId('recruitment-all-closed')).toBeInTheDocument();
        expect(preview()).toHaveTextContent('Closed');
    });
});

describe('RecruitmentDialog wanted rows (AC4/AC6)', () => {
    it('adds a row that defaults to Open', async () => {
        await renderDialog();
        fireEvent.click(screen.getByTestId('recruitment-add-row'));
        expect(screen.getAllByTestId(/^recruitment-row-\d+$/)).toHaveLength(5);
        expect(screen.getByTestId('recruitment-state-4')).toHaveValue('open');
    });

    it('blocks a duplicate class + role with a row error and disables Save', async () => {
        await renderDialog();
        change('recruitment-class-1', 'Priest');
        change('recruitment-role-1', 'healer');
        expect(screen.getByTestId('recruitment-row-error-1')).toHaveTextContent('Priest Healer is already listed.');
        expect(screen.getByTestId('recruitment-save')).toBeDisabled();
    });

    it('hides Add class at the 12-row cap', async () => {
        await renderDialog(buildRecruitmentView(null, true));
        for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByTestId('recruitment-add-row'));
        expect(screen.getAllByTestId(/^recruitment-row-\d+$/)).toHaveLength(12);
        expect(screen.getByTestId('recruitment-add-row')).toBeDisabled();
    });

    it('shows an inline link error for a non-http(s) URL and disables Save', async () => {
        await renderDialog();
        change('recruitment-apply-url', 'ftp://x');
        expect(screen.getByText(APPLY_URL_ERROR)).toBeInTheDocument();
        expect(screen.getByTestId('recruitment-save')).toBeDisabled();
    });
});

describe('RecruitmentDialog save + clear (AC4/AC7)', () => {
    it('saves the whole object (blank notes dropped, blank link null) and closes', async () => {
        const bodies = capturePut();
        const onClose = await renderDialog();
        fireEvent.click(screen.getByTestId('recruitment-remove-1'));
        change('recruitment-note-0', '  ');
        change('recruitment-apply-url', '');
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByTestId('recruitment-save'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(bodies[0]).toEqual({
            recruiting: false,
            wanted: [
                { className: 'Priest', role: 'healer', state: 'open' },
                { className: 'Druid', role: 'tank', state: 'limited', note: 'Exceptional only' },
                { className: 'Warlock', role: 'dps', state: 'open' },
            ],
            applyUrl: null,
        });
    });

    it('Clear recruitment asks first, then sends DELETE and closes', async () => {
        let deletes = 0;
        server.use(http.delete(GUILD_RECRUITMENT_URL, () => { deletes += 1; return new HttpResponse(null, { status: 204 }); }));
        const onClose = await renderDialog();
        fireEvent.click(screen.getByTestId('recruitment-clear'));
        expect(await screen.findByTestId('discard-changes-confirm')).toHaveTextContent('Clear recruitment?');
        expect(deletes).toBe(0);
        fireEvent.click(screen.getByTestId('discard-changes-discard'));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(deletes).toBe(1);
    });

    it('offers no Clear when nothing is saved yet', async () => {
        await renderDialog(buildRecruitmentView(null, true));
        expect(screen.queryByTestId('recruitment-clear')).not.toBeInTheDocument();
    });
});

describe('RecruitmentDialog dirty close (AC8)', () => {
    it('asks before discarding a dirty draft, and closes a clean one at once', async () => {
        const onClose = await renderDialog();
        fireEvent.click(screen.getByTestId('recruitment-cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
        change('recruitment-note-0', 'Disc too');
        fireEvent.click(screen.getByTestId('recruitment-cancel'));
        expect(await screen.findByTestId('discard-changes-confirm')).toBeInTheDocument();
    });

    it('renders as a bottom sheet below 1024px', async () => {
        media.desktop = false;
        await renderDialog();
        expect(screen.getByTestId('recruitment-wanted-editor')).toBeInTheDocument();
    });
});
