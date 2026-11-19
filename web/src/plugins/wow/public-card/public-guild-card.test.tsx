import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PublicGuildCard } from '@raid-ledger/contract';
import { createMockPublicGuildCard } from '../../../test/mocks/public-guild-card-handlers';
import { PublicGuildCardView } from './public-guild-card';
import { memberCountLabel, visibleApplyUrl } from './public-guild-card.helpers';

const renderCard = (card: PublicGuildCard) => render(<PublicGuildCardView card={card} />);
const withRecruitment = (r: Partial<NonNullable<PublicGuildCard['recruitment']>> | null): PublicGuildCard => {
    const base = createMockPublicGuildCard();
    return { ...base, recruitment: r === null || base.recruitment === null ? null : { ...base.recruitment, ...r } };
};

describe('PublicGuildCardView — identity', () => {
    it('shows name, region · realm · game · rounded size, and initials instead of a crest', () => {
        renderCard(createMockPublicGuildCard());
        expect(screen.getByRole('heading', { name: 'Iron Vanguard' })).toBeInTheDocument();
        expect(screen.getByTestId('public-guild-card-meta')).toHaveTextContent('US·Whitemane·WoW: Classic·~140 members');
        expect(screen.getByTestId('public-guild-card-initials')).toHaveTextContent('IV');
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('drops a null realm (Forever) and reads "Fewer than 10 members" for a null count', () => {
        renderCard(createMockPublicGuildCard({ realmName: null, approxMemberCount: null }));
        expect(screen.getByTestId('public-guild-card-meta')).toHaveTextContent('US·WoW: Classic·Fewer than 10 members');
        expect(memberCountLabel(140)).toBe('~140 members');
    });
});

describe('PublicGuildCardView — recruitment', () => {
    it.each([['open', 'Open'], ['limited', 'Limited']] as const)('%s headline lists open + limited rows and an Apply link', (state, label) => {
        renderCard(withRecruitment({ state }));
        expect(screen.getByTitle(`Recruitment: ${label}`)).toHaveTextContent(label);
        const rows = screen.getAllByTestId('public-guild-card-wanted');
        expect(rows.map((r) => r.textContent)).toEqual(['PriestHealer', 'WarriorTank']);
        const apply = screen.getByTestId('public-guild-card-apply');
        expect(apply).toHaveAttribute('href', 'https://example.com/apply');
        expect(apply).toHaveAttribute('target', '_blank');
        expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('omits a closed wanted row from "Looking for"', () => {
        renderCard(withRecruitment({ wanted: [{ className: 'Mage', role: 'dps', state: 'closed' }, { className: 'Druid', role: 'healer', state: 'open' }] }));
        const list = screen.getByRole('list', { name: 'Looking for' });
        expect(within(list).getAllByRole('listitem').map((r) => r.textContent)).toEqual(['DruidHealer']);
    });

    it('closed headline: "Not recruiting right now", no rows, no Apply (D7)', () => {
        renderCard(withRecruitment({ state: 'closed' }));
        expect(screen.getByTitle('Recruitment: Closed')).toBeInTheDocument();
        expect(screen.getByTestId('public-guild-card-closed')).toHaveTextContent('Not recruiting right now.');
        expect(screen.queryByTestId('public-guild-card-wanted')).not.toBeInTheDocument();
        expect(screen.queryByTestId('public-guild-card-apply')).not.toBeInTheDocument();
    });

    it('never-set recruitment reads as closed', () => {
        renderCard(withRecruitment(null));
        expect(screen.getByTestId('public-guild-card-closed')).toBeInTheDocument();
        expect(screen.queryByTestId('public-guild-card-apply')).not.toBeInTheDocument();
    });

    it('hides Apply with no link, and for a non-https link even if one slipped through', () => {
        renderCard(withRecruitment({ applyUrl: null }));
        expect(screen.queryByTestId('public-guild-card-apply')).not.toBeInTheDocument();
        expect(visibleApplyUrl(withRecruitment({ applyUrl: 'http://example.com/apply' }))).toBeNull();
        expect(visibleApplyUrl(withRecruitment({ applyUrl: 'javascript:alert(1)' }))).toBeNull();
        expect(visibleApplyUrl(withRecruitment({ applyUrl: 'https://example.com/a' }))).toBe('https://example.com/a');
    });
});
