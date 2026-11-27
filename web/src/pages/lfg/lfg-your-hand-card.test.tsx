/**
 * ROK-2352 §4.1 — the group view's "Your hand" card with "Also in: …".
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type { LfgGrouping, LfgGroupingContext, LfgMemberBadgesProps } from '../../plugins/lfg-grouping';
import { createMockLfgGroupDetail, createMockLfgIntent, createMockLfgMember } from '../../test/lfg-factories';
import { LfgYourHandCard } from './lfg-your-hand-card';
import { YOUR_HAND_COPY, lfgGroupHref, yourHandLabel } from './lfg-your-hand-copy';

const CONTEXT: LfgGroupingContext = { gameId: 7, gameSlug: 'world-of-warcraft-classic', groupKey: 'dungeon:36', hubId: null };

function Badges({ member }: LfgMemberBadgesProps) {
    return <span data-testid={`badges-${member.userId}`}>badges for {member.userId}</span>;
}

const GROUPING: LfgGrouping = {
    id: 'test-grouping',
    gameSlugs: [CONTEXT.gameSlug],
    MemberBadges: Badges,
    groupLabel: (ref) => (ref.groupKey === '' ? 'Any dungeon' : (ref.groupLabel ?? ref.groupKey)),
};

function renderCard(group: LfgGroupDetailDto, grouping: LfgGrouping | null = GROUPING, context = CONTEXT) {
    return render(
        <MemoryRouter>
            <LfgYourHandCard group={group} context={context} grouping={grouping} />
        </MemoryRouter>,
    );
}

/** A Deadmines group page where the viewer (user 2) holds a hand and two others. */
function heldGroup(over: Partial<LfgGroupDetailDto> = {}): LfgGroupDetailDto {
    return createMockLfgGroupDetail({
        groupKey: 'dungeon:36',
        groupLabel: 'Deadmines',
        members: [createMockLfgMember({ userId: 1 }), createMockLfgMember({ userId: 2 })],
        ownIntent: createMockLfgIntent({ userId: 2 }),
        ownOtherGroups: [
            { groupKey: 'raid:409', groupLabel: 'Molten Core' },
            { groupKey: '', groupLabel: null },
        ],
        ...over,
    });
}

describe('LfgYourHandCard', () => {
    it('renders nothing without a grouping (the api sends no ownOtherGroups)', () => {
        const { container } = renderCard(createMockLfgGroupDetail({ ownIntent: createMockLfgIntent() }), null);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the viewer holds no hand anywhere in the game', () => {
        const { container } = renderCard(heldGroup({ ownIntent: null, ownOtherGroups: [] }));
        expect(container).toBeEmptyDOMElement();
    });

    it("shows this group's hand with the plugin badges for the viewer's row only", () => {
        renderCard(heldGroup());
        const own = screen.getByTestId('lfg-your-hand-own');
        expect(within(own).getByTitle(YOUR_HAND_COPY.inThisGroup)).toHaveTextContent('Deadmines');
        expect(within(own).getByTestId('badges-2')).toBeInTheDocument();
        expect(screen.queryByTestId('badges-1')).toBeNull();
    });

    it('links every other live hand under "Also in:", keys encoded, labels from the plugin', () => {
        renderCard(heldGroup());
        const alsoIn = screen.getByTestId('lfg-your-hand-also-in');
        expect(alsoIn).toHaveTextContent(YOUR_HAND_COPY.alsoIn);
        expect(within(alsoIn).getByRole('link', { name: 'Molten Core' })).toHaveAttribute(
            'href', '/lfg/world-of-warcraft-classic/raid%3A409');
        expect(within(alsoIn).getByRole('link', { name: 'Any dungeon' })).toHaveAttribute(
            'href', '/lfg/world-of-warcraft-classic');
        expect(screen.getByText(YOUR_HAND_COPY.separateHands(3))).toBeInTheDocument();
    });

    it('keeps ?hub on the Also in links', () => {
        renderCard(heldGroup(), GROUPING, { ...CONTEXT, hubId: 12 });
        expect(screen.getByRole('link', { name: 'Molten Core' })).toHaveAttribute(
            'href', '/lfg/world-of-warcraft-classic/raid%3A409?hub=12');
    });

    it('says "Not in this group." but still lists the other hands when the viewer is out of this one', () => {
        renderCard(heldGroup({ ownIntent: null, ownOtherGroups: [{ groupKey: 'raid:409', groupLabel: 'Molten Core' }] }));
        expect(screen.getByText(YOUR_HAND_COPY.notInGroup)).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-your-hand-own')).toBeNull();
        expect(screen.getByRole('link', { name: 'Molten Core' })).toBeInTheDocument();
        // One hand only — no "separate hands" footnote.
        expect(screen.queryByText(/separate hands/)).toBeNull();
    });

    it('has no "Also in" row when this is the only hand', () => {
        renderCard(heldGroup({ ownOtherGroups: [] }));
        expect(screen.getByTestId('lfg-your-hand-own')).toBeInTheDocument();
        expect(screen.queryByTestId('lfg-your-hand-also-in')).toBeNull();
    });
});

describe('your-hand helpers', () => {
    it('lfgGroupHref: bare slug for the whole-game group, encoded key otherwise, ?hub appended', () => {
        expect(lfgGroupHref('wow', '', null)).toBe('/lfg/wow');
        expect(lfgGroupHref('wow', 'dungeon:36', null)).toBe('/lfg/wow/dungeon%3A36');
        expect(lfgGroupHref('wow', '', 4)).toBe('/lfg/wow?hub=4');
    });

    it('yourHandLabel: core fallback without a plugin label — adapter label, else "Any group" for ""', () => {
        const bare: LfgGrouping = { id: 'bare', gameSlugs: [] };
        expect(yourHandLabel(bare, { groupKey: 'dungeon:36', groupLabel: 'Deadmines' })).toBe('Deadmines');
        expect(yourHandLabel(null, { groupKey: '', groupLabel: null })).toBe(YOUR_HAND_COPY.anyGroup);
        expect(yourHandLabel(null, { groupKey: 'dungeon:36', groupLabel: null })).toBe('dungeon:36');
    });
});
