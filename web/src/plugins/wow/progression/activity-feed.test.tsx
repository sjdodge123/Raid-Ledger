/** ROK-1789 Part B (B5–B8, LB7) — the guild Progression tab's activity feed. */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import {
    GUILD_ACTIVITY_PAGE,
    type WowGuildActivityDto,
    type WowGuildActivityEntryDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { ActivityFeed } from './activity-feed';
import { ACTIVITY_EMPTY_COPY, ACTIVITY_FOOTER_COPY, KIND_META, entryActor, entryText } from './activity.helpers';

const CHAR = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-10T12:00:00.000Z';

function feed(entries: WowGuildActivityEntryDto[]): WowGuildActivityDto {
    return { entries, windowDays: 30 };
}

function ding(i: number): WowGuildActivityEntryDto {
    return { kind: 'ding', id: `ding:${i}`, at: AT, characterName: `Toon${i}`, characterId: null, toLevel: 60 };
}

const MILESTONE_ONE: WowGuildActivityEntryDto = {
    kind: 'milestone', id: 'ms:7:1', at: AT, characterName: 'Grimtusk', characterId: CHAR,
    months: 1, count: 1, names: ['Grimtusk'],
};

describe('entryText / entryActor', () => {
    it('describes a first kill with its difficulty and instance', () => {
        const e: WowGuildActivityEntryDto = {
            kind: 'first_kill', id: 'kill:1:9', at: AT, bossName: 'Ragnaros', difficultyLabel: '40', instanceName: 'Molten Core',
        };
        expect(entryActor(e)).toBeNull();
        expect(entryText(e)).toBe('Defeated Ragnaros (40) in Molten Core');
    });

    it('omits a missing difficulty and instance on a first kill', () => {
        const e: WowGuildActivityEntryDto = {
            kind: 'first_kill', id: 'kill:2:9', at: AT, bossName: 'Lucifron', difficultyLabel: null, instanceName: null,
        };
        expect(entryText(e)).toBe('Defeated Lucifron');
    });

    it('describes a join, a ding and an event', () => {
        const join: WowGuildActivityEntryDto = {
            kind: 'new_member', id: 'join:3', at: AT, characterName: 'Lunaria', characterId: null, className: 'Mage',
        };
        const ev: WowGuildActivityEntryDto = { kind: 'event', id: 'event:4', at: AT, eventId: 4, title: 'Molten Core run' };
        expect(entryActor(join)).toEqual({ name: 'Lunaria', characterId: null });
        expect(entryText(join)).toBe(' joined the guild');
        expect(entryText(ding(1))).toBe(' reached level 60');
        expect(entryActor(ev)).toBeNull();
        expect(entryText(ev)).toBe('Molten Core run');
    });

    it('describes a roster import with its member count', () => {
        const e: WowGuildActivityEntryDto = {
            kind: 'roster_import', id: `import:${AT}`, at: AT, count: 12, names: ['A', 'B'],
        };
        expect(entryActor(e)).toBeNull();
        expect(entryText(e)).toBe('12 members added from a roster import');
    });

    it('labels single milestones by months: 1 month, 6 months, 1 year', () => {
        expect(entryText(MILESTONE_ONE)).toBe(': 1 month in Raid Ledger');
        expect(entryText({ ...MILESTONE_ONE, months: 6 })).toBe(': 6 months in Raid Ledger');
        expect(entryText({ ...MILESTONE_ONE, months: 12 })).toBe(': 1 year in Raid Ledger');
    });

    it('describes a grouped milestone as "<lead> and N others"', () => {
        const grouped: WowGuildActivityEntryDto = {
            ...MILESTONE_ONE, id: 'ms:2026-11-10:1', count: 49, names: ['Thalia', 'Bo'], characterName: 'Thalia',
        };
        expect(entryActor(grouped)).toEqual({ name: 'Thalia', characterId: CHAR });
        expect(entryText(grouped)).toBe(' and 48 others: 1 month in Raid Ledger');
        expect(entryText({ ...grouped, count: 2 })).toBe(' and 1 other: 1 month in Raid Ledger');
    });

    it('maps every kind to a chip tone and label', () => {
        expect(KIND_META.first_kill).toEqual({ tone: 'success', label: 'First kill' });
        expect(KIND_META.milestone).toEqual({ tone: 'success', label: 'Milestone' });
        expect(KIND_META.new_member).toEqual({ tone: 'neutral', label: 'New member' });
        expect(KIND_META.roster_import).toEqual({ tone: 'neutral', label: 'New members' });
        expect(KIND_META.event).toEqual({ tone: 'neutral', label: 'Event' });
        expect(KIND_META.ding).toEqual({ tone: 'neutral', label: 'Level up' });
    });
});

describe('ActivityFeed', () => {
    it('shows the empty copy and the footer when there are no entries', () => {
        renderWithProviders(<ActivityFeed activity={feed([])} />);
        expect(screen.getByTestId('guild-activity-empty')).toHaveTextContent(ACTIVITY_EMPTY_COPY);
        expect(screen.queryByTestId('guild-activity-list')).toBeNull();
        expect(screen.getByText(ACTIVITY_FOOTER_COPY)).toBeInTheDocument();
    });

    it('renders a kind chip, a <time> and the sentence per row', () => {
        renderWithProviders(<ActivityFeed activity={feed([MILESTONE_ONE])} />);
        const row = screen.getByTestId('guild-activity-row');
        expect(row).toHaveAttribute('data-kind', 'milestone');
        expect(within(row).getByTitle('Milestone')).toHaveAttribute('data-tone', 'success');
        expect(within(row).getByText('Milestone')).toBeInTheDocument();
        expect(row.querySelector('time')).toHaveAttribute('datetime', AT);
        expect(within(row).getByTestId('guild-activity-text')).toHaveTextContent('Grimtusk: 1 month in Raid Ledger');
    });

    it('links a linked character and leaves an unlinked one as plain text', () => {
        renderWithProviders(<ActivityFeed activity={feed([MILESTONE_ONE, ding(1)])} />);
        const [linked, plain] = screen.getAllByTestId('guild-activity-row');
        expect(linked && within(linked).getByRole('link', { name: 'Grimtusk' })).toHaveAttribute('href', `/characters/${CHAR}`);
        expect(plain && within(plain).queryByRole('link')).toBeNull();
        expect(plain && within(plain).getByTestId('guild-member-unlinked')).toHaveTextContent('Toon1');
    });

    it(`shows the first ${GUILD_ACTIVITY_PAGE} rows, then all of them behind "Show all N"`, () => {
        const entries = Array.from({ length: 30 }, (_, i) => ding(i));
        renderWithProviders(<ActivityFeed activity={feed(entries)} />);
        expect(screen.getAllByTestId('guild-activity-row')).toHaveLength(GUILD_ACTIVITY_PAGE);
        const toggle = screen.getByRole('button', { name: 'Show all 30' });
        expect(toggle).toHaveAttribute('aria-controls', screen.getByTestId('guild-activity-list').id);
        fireEvent.click(toggle);
        expect(screen.getAllByTestId('guild-activity-row')).toHaveLength(30);
        expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    });

    it(`has no toggle at exactly ${GUILD_ACTIVITY_PAGE} rows`, () => {
        const entries = Array.from({ length: GUILD_ACTIVITY_PAGE }, (_, i) => ding(i));
        renderWithProviders(<ActivityFeed activity={feed(entries)} />);
        expect(screen.getAllByTestId('guild-activity-row')).toHaveLength(GUILD_ACTIVITY_PAGE);
        expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
    });
});
