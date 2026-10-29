/**
 * ROK-1173 AC2 — the WoW Members filter controls render every group with its
 * label, and each control reports the next filter state through `onChange`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WowMemberFilterControls } from './wow-member-filters';
import {
    EMPTY_WOW_MEMBER_FILTERS, PROFESSION_FILTER_LABEL, type WowMemberFilterOptions, type WowMemberFilterState,
} from './wow-member-filters.helpers';

const OPTIONS: WowMemberFilterOptions = {
    classes: ['Mage', 'Warrior'],
    ranks: [{ key: '0', label: 'Guild Master' }, { key: '2', label: 'Raider' }],
    maxLevel: 60,
};

type Professions = Parameters<typeof WowMemberFilterControls>[0]['professions'];
const MINING: Professions = [{ name: 'Mining', count: 2 }];

// No default parameter: JS applies a default to an explicit `undefined`, which
// would hide the visitor/loading case behind the Mining fixture.
function renderControls(professions: Professions) {
    const onChange = vi.fn<(next: WowMemberFilterState) => void>();
    render(<WowMemberFilterControls state={EMPTY_WOW_MEMBER_FILTERS} options={OPTIONS} professions={professions} onChange={onChange} />);
    return onChange;
}

function lastState(onChange: ReturnType<typeof renderControls>): WowMemberFilterState {
    const call = onChange.mock.lastCall;
    if (!call) throw new Error('onChange was not called');
    return call[0];
}

describe('WowMemberFilterControls (ROK-1173 AC2)', () => {
    it('renders every AC2 control with its label', () => {
        renderControls(MINING);
        expect(within(screen.getByTestId('wow-filter-class')).getByText('Class')).toBeInTheDocument();
        expect(within(screen.getByTestId('wow-filter-role')).getByText('Role')).toBeInTheDocument();
        expect(within(screen.getByTestId('wow-filter-rank')).getByText('Rank')).toBeInTheDocument();
        expect(screen.getByLabelText('Min level')).toBeInTheDocument();
        expect(screen.getByLabelText('Max level')).toBeInTheDocument();
        expect(screen.getByTestId('wow-filter-linked')).toBeInTheDocument();
        expect(within(screen.getByTestId('wow-filter-profession')).getByText(PROFESSION_FILTER_LABEL)).toBeInTheDocument();
        for (const name of ['Mage', 'Warrior', 'Tank', 'Healer', 'DPS', 'Unknown', 'Guild Master', 'Raider', 'Mining']) {
            expect(screen.getByRole('button', { name }), `chip "${name}"`).toHaveAttribute('aria-pressed', 'false');
        }
    });

    it('reports a pressed Role chip and a pressed Rank chip as the next state', async () => {
        const onChange = renderControls(MINING);
        await userEvent.click(screen.getByRole('button', { name: 'Healer' }));
        expect(lastState(onChange).roles, 'the Role chip adds its value').toEqual(['healer']);
        await userEvent.click(screen.getByRole('button', { name: 'Raider' }));
        expect(lastState(onChange).ranks, 'the Rank chip adds its rank key').toEqual(['2']);
    });

    it('hides the Profession group when insights have no professions (visitor / loading / none)', () => {
        renderControls(undefined);
        expect(screen.queryByTestId('wow-filter-profession'), 'undefined professions hide the group').toBeNull();
    });

    it('hides the Profession group when the profession list is empty', () => {
        renderControls([]);
        expect(screen.queryByTestId('wow-filter-profession'), 'an empty list hides the group').toBeNull();
    });
});
