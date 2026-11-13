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
import { PutGuildRecruitmentSchema, type GuildPage, type GuildRecruitmentView } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    GUILD_RECRUITMENT_URL, buildRecruitment, buildRecruitmentView,
} from '../../../test/mocks/guild-recruitment-handlers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import type { HubCtx } from '../../hub-module';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import RecruitmentWidget, { RECRUITMENT_EMPTY_HINT } from './recruitment-widget';
import { RecruitmentAction } from './recruitment-action';
import { useRecruitmentDialog } from './recruitment-dialog-store';
import { guildRecruitmentKey } from '../hooks/use-guild-recruitment';

/** Never read by the card — spelled out rather than cast (server-hours-widget.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(): HubWidgetCtx {
    // The card reads only `page.guild.id`; rights come from the recruitment view (guild-text test idiom).
    const base = buildCommunityPage();
    const page: GuildPage = { ...base, guild: { ...base.guild, id: 5, kind: 'wow_guild' } };
    return { page, raids: IDLE_RAIDS, gameSlug: WOW_FOREVER_GAME_SLUG };
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
            HttpResponse.json(buildRecruitmentView(PutGuildRecruitmentSchema.parse(await request.json()), true))));
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

/**
 * The first GET (the card) answers at once; every later one (the editor's
 * refetch-on-mount) waits for `release()` and then answers the pre-save view.
 * `served` settles once that late response has been sent.
 */
function serveHeldRefetch(view: GuildRecruitmentView): { release: () => void; calls: () => number; served: Promise<void> } {
    let calls = 0;
    let release = (): void => undefined;
    let markServed = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const served = new Promise<void>((resolve) => { markServed = resolve; });
    server.use(http.get(GUILD_RECRUITMENT_URL, async () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json(view);
        await gate;
        markServed();
        return HttpResponse.json(view);
    }));
    return { release: () => release(), calls: () => calls, served };
}

describe('Recruitment save vs an in-flight GET (Codex P2)', () => {
    it('a GET that resolves after the save does not revert the card', async () => {
        const held = serveHeldRefetch(buildRecruitmentView(buildRecruitment(), true));
        const saved: { view: GuildRecruitmentView | undefined } = { view: undefined };
        server.use(http.put(GUILD_RECRUITMENT_URL, async ({ request }) => {
            saved.view = buildRecruitmentView(PutGuildRecruitmentSchema.parse(await request.json()), true);
            return HttpResponse.json(saved.view);
        }));
        const { queryClient } = renderWithProviders(<Card />);
        fireEvent.click(await screen.findByTestId('recruitment-edit'));
        await screen.findByTestId('recruitment-apply-url');
        await waitFor(() => expect(held.calls()).toBe(2));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByTestId('recruitment-save'));
        await waitFor(() => expect(screen.queryByTestId('recruitment-save')).toBeNull());
        held.release();
        await held.served;
        await waitFor(() => expect(queryClient.isFetching({ queryKey: guildRecruitmentKey(5) })).toBe(0));
        expect(saved.view).toBeDefined();
        expect(queryClient.getQueryData<GuildRecruitmentView>(guildRecruitmentKey(5))).toEqual(saved.view);
        const card = screen.getByTestId('recruitment-card');
        await waitFor(() => expect(within(card).getByTestId('recruitment-headline')).toHaveTextContent('Closed'));
    });
});
