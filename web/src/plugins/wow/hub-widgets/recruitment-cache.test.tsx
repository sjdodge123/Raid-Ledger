/**
 * ROK-1789 AC4/AC7 — the editor and the card share one query cache: a save
 * shows on the card without a reload (the PUT view is written to the cache),
 * and a clear flips the card to the editor empty state (the view is refetched).
 * The GET keeps answering the pre-save view, so only the cache update can pass.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { http, HttpResponse } from 'msw';
import type { GuildPage, GuildRecruitmentView, PutGuildRecruitmentInput } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    GUILD_RECRUITMENT_URL, buildRecruitment, buildRecruitmentView,
} from '../../../test/mocks/guild-recruitment-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import RecruitmentWidget, { RECRUITMENT_EMPTY_HINT } from './recruitment-widget';
import { RecruitmentAction } from './recruitment-action';
import { useRecruitmentDialog } from './recruitment-dialog-store';

function ctx(): HubWidgetCtx {
    // The card reads only `page.guild.id`; rights come from the recruitment view (guild-text test idiom).
    const page = { guild: { id: 5, kind: 'wow_guild', gameSlug: WOW_FOREVER_GAME_SLUG } } as GuildPage;
    return { page, gameSlug: WOW_FOREVER_GAME_SLUG } as HubWidgetCtx;
}

const Card = (): JSX.Element => <><RecruitmentAction {...ctx()} /><RecruitmentWidget {...ctx()} /></>;

/** GET answers whatever `state.view` holds right now. */
function serveLive(view: GuildRecruitmentView): { view: GuildRecruitmentView } {
    const state = { view };
    server.use(http.get(GUILD_RECRUITMENT_URL, () => HttpResponse.json(state.view)));
    return state;
}

async function openEditor(): Promise<void> {
    renderWithProviders(<Card />);
    fireEvent.click(await screen.findByTestId('recruitment-edit'));
    await screen.findByTestId('recruitment-apply-url');
}

beforeEach(() => { useRecruitmentDialog.setState({ guildId: null }); });

describe('Recruitment editor → card cache (AC4/AC7)', () => {
    it('a save shows on the card without a refetch', async () => {
        serveLive(buildRecruitmentView(buildRecruitment(), true));
        server.use(http.put(GUILD_RECRUITMENT_URL, async ({ request }) =>
            HttpResponse.json(buildRecruitmentView((await request.json()) as PutGuildRecruitmentInput, true))));
        await openEditor();
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByTestId('recruitment-save'));
        await waitFor(() => expect(screen.queryByTestId('recruitment-save')).toBeNull());
        const card = screen.getByTestId('recruitment-card');
        await waitFor(() => expect(within(card).getByTestId('recruitment-headline')).toHaveTextContent('Closed'));
        expect(within(card).queryAllByTestId('recruitment-row')).toHaveLength(0);
    });

    it('a clear flips the card to the editor empty state', async () => {
        const live = serveLive(buildRecruitmentView(buildRecruitment(), true));
        server.use(http.delete(GUILD_RECRUITMENT_URL, () => {
            live.view = buildRecruitmentView(null, true);
            return new HttpResponse(null, { status: 204 });
        }));
        await openEditor();
        fireEvent.click(screen.getByTestId('recruitment-clear'));
        fireEvent.click(await screen.findByTestId('discard-changes-discard'));
        await waitFor(() => expect(screen.queryByTestId('recruitment-save')).toBeNull());
        await waitFor(() => expect(screen.getByTestId('recruitment-card')).toHaveTextContent(RECRUITMENT_EMPTY_HINT));
        expect(screen.getByTestId('recruitment-set')).toBeInTheDocument();
        expect(screen.queryByTestId('recruitment-headline')).toBeNull();
    });
});
