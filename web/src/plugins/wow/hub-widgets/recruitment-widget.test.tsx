/** ROK-1789 AC1/AC3/AC7 — the Forever "Recruitment" card: probe, headline states, rows, Apply link, editor controls. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, GuildRecruitmentView } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import {
    buildRecruitment, buildRecruitmentView, guildRecruitmentGetHandler,
} from '../../../test/mocks/guild-recruitment-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { guildRecruitmentKey, useRecruitmentVisible } from '../hooks/use-guild-recruitment';
import RecruitmentWidget, { ANY_CLASS_COPY, APPLY_COPY, RECRUITMENT_EMPTY_HINT } from './recruitment-widget';
import { RecruitmentAction } from './recruitment-action';
import { useRecruitmentDialog } from './recruitment-dialog-store';
import { RECRUIT_STATE_META } from './recruitment.helpers';

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'wow_guild', gameSlug: WOW_FOREVER_GAME_SLUG },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id`; rights come from the recruitment view (guild-text test idiom).
    return { page, gameSlug: WOW_FOREVER_GAME_SLUG } as HubWidgetCtx;
}

const Card = (): JSX.Element => <><RecruitmentAction {...ctx()} /><RecruitmentWidget {...ctx()} /></>;

function serve(body: GuildRecruitmentView | 'forbidden'): void { server.use(guildRecruitmentGetHandler(body)); }

async function renderCard(view: GuildRecruitmentView): Promise<HTMLElement> {
    serve(view);
    renderWithProviders(<Card />);
    return screen.findByTestId('recruitment-card');
}

function probe() {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useRecruitmentVisible(ctx()), { wrapper });
    const settled = () => waitFor(() => expect(client.getQueryState(guildRecruitmentKey(5))?.status).not.toBe('pending'));
    return { ...hook, settled };
}

/** One rendered row by class; a missing row fails loudly. */
function row(card: HTMLElement, className: string): HTMLElement {
    const found = within(card).getAllByTestId('recruitment-row').find((r) => r.getAttribute('data-class') === className);
    if (found === undefined) throw new Error(`no ${className} row`);
    return found;
}

const rowNames = (card: HTMLElement): string[] =>
    within(card).getAllByTestId('recruitment-row').map((r) => r.getAttribute('data-class') ?? '');

beforeEach(() => { useRecruitmentDialog.setState({ guildId: null }); });

describe('useRecruitmentVisible (A-D6)', () => {
    it('hides the card from a member when nothing is set', async () => {
        serve(buildRecruitmentView(null));
        const { result, settled } = probe();
        await settled();
        expect(result.current).toBe(false);
    });

    it('shows it to an editor while unset, and to a member once set', async () => {
        serve(buildRecruitmentView(null, true));
        const editor = probe();
        await waitFor(() => expect(editor.result.current).toBe(true));
        serve(buildRecruitmentView(buildRecruitment()));
        const member = probe();
        await waitFor(() => expect(member.result.current).toBe(true));
    });

    it('stays hidden for a non-member (403)', async () => {
        serve('forbidden');
        const { result, settled } = probe();
        await settled();
        expect(result.current).toBe(false);
    });
});

describe('RecruitmentWidget headline + rows (AC1)', () => {
    it('shows the Open headline and sorts rows open → limited → closed, keeping editor order within a state', async () => {
        const card = await renderCard(buildRecruitmentView(buildRecruitment()));
        expect(within(card).getByTestId('recruitment-headline')).toHaveTextContent(RECRUIT_STATE_META.open.label);
        expect(within(card).getByText(RECRUIT_STATE_META.open.explainer)).toBeInTheDocument();
        expect(rowNames(card)).toEqual(['Priest', 'Warlock', 'Druid', 'Rogue']);
    });

    it('gives every row its own state chip, its note, and mutes closed rows', async () => {
        const card = await renderCard(buildRecruitmentView(buildRecruitment()));
        const priest = row(card, 'Priest');
        const rogue = row(card, 'Rogue');
        expect(priest).toHaveTextContent('Holy');
        expect(within(priest).getByTestId('recruitment-row-state')).toHaveTextContent('Open');
        expect(within(row(card, 'Druid')).getByTestId('recruitment-row-state')).toHaveTextContent('Limited');
        expect(within(rogue).getByTestId('recruitment-row-state')).toHaveTextContent('Closed');
        expect(within(rogue).getByTestId('recruitment-row-name')).toHaveClass('text-muted');
        expect(within(priest).getByTestId('recruitment-row-name')).toHaveClass('font-medium');
    });

    it('reads Limited when no row is open', async () => {
        const wanted = [{ className: 'Druid' as const, role: 'tank' as const, state: 'limited' as const }];
        const card = await renderCard(buildRecruitmentView(buildRecruitment({ wanted })));
        expect(within(card).getByTestId('recruitment-headline')).toHaveTextContent('Limited');
        expect(within(card).getByText(RECRUIT_STATE_META.limited.explainer)).toBeInTheDocument();
    });

    it('reads "Any class or role" when recruiting with an empty list', async () => {
        const card = await renderCard(buildRecruitmentView(buildRecruitment({ wanted: [] })));
        expect(within(card).getByText(ANY_CLASS_COPY)).toBeInTheDocument();
        expect(within(card).queryAllByTestId('recruitment-row')).toHaveLength(0);
    });

    it('renders Apply as an external link and the updated line', async () => {
        const card = await renderCard(buildRecruitmentView(buildRecruitment()));
        const apply = within(card).getByRole('link', { name: APPLY_COPY });
        expect(apply).toHaveAttribute('href', 'https://example.com/apply');
        expect(apply).toHaveAttribute('target', '_blank');
        expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
        expect(within(card).getByTestId('recruitment-updated')).toHaveTextContent(/^Updated .* by Thalia$/);
    });

    it('omits Apply when no URL is set', async () => {
        const card = await renderCard(buildRecruitmentView(buildRecruitment({ applyUrl: null })));
        expect(within(card).queryByRole('link', { name: APPLY_COPY })).toBeNull();
    });
});

describe('RecruitmentWidget closed (AC3 / ruling A4)', () => {
    it.each([
        ['the switch is off', buildRecruitment({ recruiting: false })],
        ['every row is closed', buildRecruitment({ wanted: [{ className: 'Rogue', role: 'dps', state: 'closed' }] })],
    ])('hides the list and Apply when %s', async (_label, recruitment) => {
        const card = await renderCard(buildRecruitmentView(recruitment));
        expect(within(card).getByTestId('recruitment-headline')).toHaveTextContent('Closed');
        expect(within(card).getByText(RECRUIT_STATE_META.closed.explainer)).toBeInTheDocument();
        expect(within(card).queryAllByTestId('recruitment-row')).toHaveLength(0);
        expect(within(card).queryByRole('link', { name: APPLY_COPY })).toBeNull();
    });
});

describe('RecruitmentWidget editor controls (AC4/AC5/AC7)', () => {
    it('shows no Edit and no empty state to a member', async () => {
        await renderCard(buildRecruitmentView(buildRecruitment()));
        expect(screen.queryByTestId('recruitment-edit')).toBeNull();
        expect(screen.queryByTestId('recruitment-set')).toBeNull();
    });

    it('renders nothing for a member while unset (cleared)', async () => {
        serve(buildRecruitmentView(null));
        const { container } = renderWithProviders(<RecruitmentWidget {...ctx()} />);
        await waitFor(() => expect(screen.queryByTestId('recruitment-card')).toBeNull());
        expect(container).toBeEmptyDOMElement();
    });

    it('gives an editor Edit once set, which opens the editor for this hub', async () => {
        await renderCard(buildRecruitmentView(buildRecruitment(), true));
        fireEvent.click(await screen.findByTestId('recruitment-edit'));
        expect(useRecruitmentDialog.getState().guildId).toBe(5);
    });

    it('gives an editor the empty state + "Set recruitment" while unset, and no header Edit', async () => {
        await renderCard(buildRecruitmentView(null, true));
        expect(screen.getByText(RECRUITMENT_EMPTY_HINT)).toBeInTheDocument();
        expect(screen.queryByTestId('recruitment-edit')).toBeNull();
        fireEvent.click(screen.getByTestId('recruitment-set'));
        expect(useRecruitmentDialog.getState().guildId).toBe(5);
    });
});
