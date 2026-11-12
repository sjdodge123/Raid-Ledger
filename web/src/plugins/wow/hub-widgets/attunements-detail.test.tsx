/**
 * ROK-1927 (W13) — the per-member Attunements detail (F6): opened from the
 * card through the store, a Modal table on desktop and a BottomSheet list on
 * phone, one pressed FilterChip tab, claimed names linking to the Quests
 * section (AC11), unclaimed rows unlinked (AC3), the "N more" disclosure, the
 * unverified empty sentence and the close seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuildPage, WowAttunementResultDto, WowRosterAttunementsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { createBareRosterInsights, rosterInsightsHandler } from '../../../test/handlers/forever-hub-widgets';
import { buildAttunementMember, buildAttunementsSection, sampleAttunementDefs } from '../../../test/factories/forever-attunements';
import AttunementsWidget from './attunements-widget';
import AttunementsDetail from './attunements-detail';
import { useAttunementsDetail } from './attunements-detail-store';
import { ATTUNEMENTS_UNVERIFIED_COPY } from './attunements.helpers';

const media = vi.hoisted(() => ({ width: 1280 }));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: (q: string) => media.width >= Number(/(\d+)px/.exec(q)?.[1] ?? '0'),
}));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const ONY_STEPS = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];
const CLAIMED = '00000000-0000-4000-8000-0000000000aa';

function res(key: string, overrides: Partial<WowAttunementResultDto> = {}): WowAttunementResultDto {
    return { key, state: 'not_started', noDataReason: null, stepsDone: 0, nextStep: 'Attunement to the Core', belowLevel: false, ...overrides };
}

function section(extra = 0): WowRosterAttunementsDto {
    const filler = Array.from({ length: extra }, (_, i) => buildAttunementMember({
        rowKey: `f${i}`, name: `Filler ${String(i).padStart(2, '0')}`, results: [res('mc-horde')],
    }));
    // Onyxia is a 7-step chain (mockup F6 "4/7").
    const attunements = sampleAttunementDefs().map((d) => (d.groupKey === 'onyxia' ? { ...d, steps: ONY_STEPS } : d));
    return buildAttunementsSection({
        attunements,
        members: [
            buildAttunementMember({ rowKey: 'z', name: 'Zinny', characterId: null, results: [res('mc-horde', { state: 'no_data', noDataReason: 'not_claimed', nextStep: null })] }),
            buildAttunementMember({ rowKey: 'b', name: 'Brakkor', characterId: CLAIMED, results: [res('mc-horde', { state: 'done', stepsDone: 1, nextStep: null }), res('ony-horde', { state: 'in_progress', stepsDone: 4, nextStep: 'What the Wind Carries' })] }),
            ...filler,
        ],
    });
}

function renderDetail(data: WowRosterAttunementsDto, onClose = vi.fn()) {
    server.use(rosterInsightsHandler({ all: createBareRosterInsights({ attunements: data }) }));
    renderWithProviders(<AttunementsDetail guildId={7} onClose={onClose} />);
    return onClose;
}

function names(): string[] {
    return screen.getAllByTestId('attunement-member').map((r) => r.querySelector('a, span')?.textContent ?? '');
}

beforeEach(() => { media.width = 1280; useAttunementsDetail.setState({ guildId: null }); });

describe('AttunementsDetail', () => {
    it('draws a desktop table with done rows first, linked claimed names and an unlinked unclaimed one', async () => {
        renderDetail(section());
        await screen.findByTestId('attunements-detail');
        expect(screen.getByRole('dialog', { name: 'Attunements' })).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Molten Core attunement by member' })).toBeInTheDocument();
        expect(names()).toEqual(['Brakkor', 'Zinny']);
        expect(screen.getByRole('link', { name: 'Brakkor' })).toHaveAttribute('href', `/characters/${CLAIMED}#quests`);
        expect(screen.queryByRole('link', { name: 'Zinny' })).toBeNull();
        const zinny = screen.getAllByTestId('attunement-member')[1];
        if (zinny === undefined) throw new Error('expected a Zinny row');
        expect(within(zinny).getByTitle('Not claimed by a member')).toHaveTextContent('No data');
        expect(zinny).toHaveTextContent('Not claimed');
    });

    it('keeps exactly one tab pressed and switches the rows to the picked attunement', async () => {
        renderDetail(section());
        const mc = await screen.findByTestId('attunement-tab-mc');
        const ony = screen.getByTestId('attunement-tab-onyxia');
        expect(mc).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('attunement-tab-naxx')).toBeNull();
        await userEvent.click(ony);
        expect(ony).toHaveAttribute('aria-pressed', 'true');
        expect(mc).toHaveAttribute('aria-pressed', 'false');
        expect(names()).toEqual(['Brakkor']);
        expect(screen.getByRole('row', { name: /Brakkor/ })).toHaveTextContent('4/7What the Wind Carries');
    });
});

describe('AttunementsDetail — chip group a11y', () => {
    it('names the chip group and ties every chip to the rows it filters (S3)', async () => {
        renderDetail(section());
        await screen.findByTestId('attunements-detail');
        expect(screen.getByRole('group', { name: 'Choose an attunement' })).toBeInTheDocument();
        const tableId = screen.getByRole('table', { name: 'Molten Core attunement by member' }).id;
        expect(tableId).not.toBe('');
        for (const chip of [screen.getByTestId('attunement-tab-mc'), screen.getByTestId('attunement-tab-onyxia')]) {
            expect(chip, 'each chip aria-controls the member table').toHaveAttribute('aria-controls', tableId);
        }
    });
});

describe('AttunementsDetail — rows', () => {
    it('lists rows on phone as name + chip, then "steps · next"', async () => {
        media.width = 375;
        renderDetail(section());
        const list = await screen.findByRole('list', { name: 'Molten Core attunement by member' });
        expect(screen.queryByRole('table')).toBeNull();
        expect(within(list).getAllByTestId('attunement-member')[0]).toHaveTextContent('BrakkorAttuned1/1 steps · —');
    });

    it('folds rows past ten behind "Show N more"', async () => {
        renderDetail(section(11));
        await screen.findByTestId('attunements-detail');
        expect(screen.getAllByTestId('attunement-member')).toHaveLength(10);
        await userEvent.click(screen.getByRole('button', { name: /Show 3 more/ }));
        expect(screen.getAllByTestId('attunement-member')).toHaveLength(13);
    });

    it('shows the unverified sentence when no attunement is tracked', async () => {
        renderDetail(buildAttunementsSection({ attunements: [], members: [] }));
        expect(await screen.findByTestId('attunements-detail-unverified')).toHaveTextContent(ATTUNEMENTS_UNVERIFIED_COPY);
    });

    it('calls onClose from the close button', async () => {
        const onClose = renderDetail(section());
        await screen.findByTestId('attunements-detail');
        await userEvent.click(screen.getByRole('button', { name: 'Close modal' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('AttunementsWidget → detail seam', () => {
    it('mounts the detail only while the store holds this hub, and close unmounts it', async () => {
        server.use(rosterInsightsHandler({ all: createBareRosterInsights({ attunements: section() }) }));
        const page: GuildPage = {
            guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
                memberCount: 30, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
            importedBy: null,
            viewer: { role: 'member', canEdit: false, canManageEditors: false },
            ranks: [],
            roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        };
        renderWithProviders(<AttunementsWidget page={page} />);
        await screen.findByTestId('attunements');
        expect(screen.queryByRole('dialog')).toBeNull();
        act(() => useAttunementsDetail.getState().open(8));
        expect(screen.queryByRole('dialog')).toBeNull();
        act(() => useAttunementsDetail.getState().open(7));
        expect(await screen.findByTestId('attunements-detail')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Close modal' }));
        expect(useAttunementsDetail.getState().guildId).toBeNull();
    });
});
