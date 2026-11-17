/**
 * ROK-2212 W8–W9 — the planner tab's "Suggested groups" section: the dungeon
 * filter narrows the list, never more than 10 groups per dungeon, §4.5 empty,
 * Open in planner hands the group to the planner instead of navigating.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_SUGGESTED_GROUPS_PER_DUNGEON, SuggestedGroupsSchema, type SuggestedGroupsDto } from '@raid-ledger/contract';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { group, SUGGESTED_GROUPS_FIXTURE, suggestedGroupsHandler, unclaimed } from '../suggested-groups/suggested-groups.fixtures';
import { PAGE } from './dungeon-planner-tab.fixtures';
import { SuggestedGroupsSection } from './suggested-groups-section';

vi.mock('../../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    useViewerCacheScope: () => 'user:1:member',
}));

function renderSection(body: SuggestedGroupsDto = SUGGESTED_GROUPS_FIXTURE, onOpen = vi.fn()): void {
    server.use(suggestedGroupsHandler(body));
    renderWithProviders(<SuggestedGroupsSection page={PAGE} onOpenInPlanner={onOpen} />);
}

/** `n` distinct groups in one dungeon (the 5th member varies so each is its own lineup). */
function manyIn(id: number, name: string, n: number): SuggestedGroupsDto {
    const groups = Array.from({ length: n }, (_, i) => {
        const base = group(id, name);
        return { ...base, members: [...base.members.slice(0, 4), unclaimed(500 + i, `Alt${i}`, 'dps', 22)] };
    });
    return SuggestedGroupsSchema.parse({ ...SUGGESTED_GROUPS_FIXTURE, groups: [...groups, group(102, 'Blackfathom Deeps')] });
}

describe('SuggestedGroupsSection', () => {
    it('W8: the dungeon filter narrows the list to that dungeon', async () => {
        renderSection();
        expect(await screen.findAllByTestId('suggested-group-card')).toHaveLength(3);
        await userEvent.selectOptions(screen.getByLabelText('Show groups for'), 'Blackfathom Deeps');
        const cards = screen.getAllByTestId('suggested-group-card');
        expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Blackfathom Deeps group']);
        await userEvent.selectOptions(screen.getByLabelText('Show groups for'), 'All dungeons');
        expect(screen.getAllByTestId('suggested-group-card')).toHaveLength(3);
    });

    it('W9: shows at most 10 groups per dungeon', async () => {
        renderSection(manyIn(101, 'Shadowfang Keep', 12));
        await screen.findAllByTestId('suggested-group-card');
        const sfk = screen.getAllByRole('article', { name: /^Shadowfang Keep group \d+ of 10$/ });
        expect(sfk, '12 Shadowfang Keep groups come back, 10 render').toHaveLength(MAX_SUGGESTED_GROUPS_PER_DUNGEON);
        expect(screen.getAllByRole('article', { name: 'Blackfathom Deeps group' })).toHaveLength(1);
    });

    it('gives same-dungeon cards distinct accessible names (group N of M on the card and every action)', async () => {
        renderSection(manyIn(101, 'Shadowfang Keep', 3));
        const second = await screen.findByRole('article', { name: 'Shadowfang Keep group 2 of 3' });
        expect(within(second).getByRole('button', { name: 'Open in planner: Shadowfang Keep group 2 of 3' })).toBeInTheDocument();
        expect(within(second).getByRole('button', { name: 'Poll Shadowfang Keep group 2 of 3' })).toBeInTheDocument();
        expect(within(second).getByRole('link', { name: /^Schedule Shadowfang Keep group 2 of 3/ })).toBeInTheDocument();
        const names = screen.getAllByRole('button', { name: /^Open in planner:/ }).map((b) => b.getAttribute('aria-label'));
        expect(new Set(names).size, `every Open in planner name is unique: ${names.join(' | ')}`).toBe(names.length);
    });

    it('shows the quiet empty line when no group fits', async () => {
        renderSection(SuggestedGroupsSchema.parse({ ...SUGGESTED_GROUPS_FIXTURE, groups: [] }));
        expect(await screen.findByTestId('suggested-groups-section-empty')).toHaveTextContent(/No group of five fits yet/);
        expect(screen.queryByLabelText('Show groups for')).toBeNull();
    });

    it('Open in planner hands the group to the planner (a button, not a link)', async () => {
        const onOpen = vi.fn();
        renderSection(SUGGESTED_GROUPS_FIXTURE, onOpen);
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).queryByTestId('suggested-group-planner')).toBeNull();
        await userEvent.click(within(sfk).getByRole('button', { name: 'Open in planner: Shadowfang Keep group' }));
        expect(onOpen).toHaveBeenCalledWith(SUGGESTED_GROUPS_FIXTURE.groups[0]);
    });
});
