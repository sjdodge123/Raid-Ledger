/**
 * ROK-2172 — `RoleSummary` stays read-only unless a caller opts in: `hrefFor`
 * makes the pills links, `onToggle` makes them `aria-pressed` toggles.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CharacterRole } from '@raid-ledger/contract';
import { RoleSummary } from './role-bits';
import { filterStateFromHash, membersHashFor, roleFilterHref, roleFromHash } from './wow-role-filter.helpers';
import { EMPTY_WOW_MEMBER_FILTERS } from './wow-member-filters.helpers';

const COUNTS: Record<CharacterRole, number> = { tank: 2, healer: 4, dps: 12 };

describe('RoleSummary (ROK-2172)', () => {
    it('renders no button and no link when no interactivity is opted into', () => {
        render(<RoleSummary counts={COUNTS} />);
        expect(screen.getByTestId('guild-role-count-tank')).toHaveTextContent('2Tank');
        expect(screen.queryAllByRole('button'), 'a read-only summary has no buttons').toHaveLength(0);
        expect(screen.queryAllByRole('link'), 'a read-only summary has no links').toHaveLength(0);
    });

    it('hrefFor makes each pill a named link', () => {
        render(<RoleSummary counts={COUNTS} hrefFor={roleFilterHref} />);
        expect(screen.getByRole('link', { name: 'Show 2 Tank members' })).toHaveAttribute('href', '#members?role=tank');
        expect(screen.getByRole('link', { name: 'Show 12 DPS members' })).toHaveAttribute('href', '#members?role=dps');
    });

    it('onToggle makes each pill a toggle pressed while its role is selected', async () => {
        const onToggle = vi.fn<(role: CharacterRole) => void>();
        render(<RoleSummary counts={COUNTS} selected={['healer']} onToggle={onToggle} />);
        expect(screen.getByRole('button', { name: 'Show 4 Heal members' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Show 2 Tank members' })).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(screen.getByRole('button', { name: 'Show 2 Tank members' }));
        expect(onToggle).toHaveBeenCalledWith('tank');
    });
});

describe('role filter hash (ROK-2172)', () => {
    it('reads a known role from the Members hash only', () => {
        expect(roleFromHash('#members?role=healer')).toBe('healer');
        expect(roleFromHash('#members?role=unknown'), 'unknown is not a chip role').toBeNull();
        expect(roleFromHash('#raids?role=tank'), 'another tab ignores the parameter').toBeNull();
        expect(roleFromHash('#members')).toBeNull();
    });

    it('seeds exactly that role and writes it back only while it is the sole filter', () => {
        expect(filterStateFromHash('#members?role=dps')).toEqual({ ...EMPTY_WOW_MEMBER_FILTERS, roles: ['dps'] });
        expect(filterStateFromHash('#members')).toEqual(EMPTY_WOW_MEMBER_FILTERS);
        expect(membersHashFor({ ...EMPTY_WOW_MEMBER_FILTERS, roles: ['tank'] })).toBe('#members?role=tank');
        expect(membersHashFor({ ...EMPTY_WOW_MEMBER_FILTERS, roles: ['tank'], linkedOnly: true })).toBe('#members');
        expect(membersHashFor({ ...EMPTY_WOW_MEMBER_FILTERS, roles: ['tank', 'dps'] })).toBe('#members');
    });
});
