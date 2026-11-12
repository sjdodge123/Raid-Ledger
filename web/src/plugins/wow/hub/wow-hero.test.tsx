/**
 * ROK-1815 — the WoW guild hero's "Your role" chips (one case per viewer type)
 * and the faction pill (token tone per faction, neutral fallback, hidden on null).
 * ROK-1170: the neutral "Founded <Mon YYYY>" pill (full date in `title`, hidden on null).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { WowFactionPill, WowFoundedPill, WowViewerRolePills } from './wow-hero';
import { factionKey, heroRoleBadges } from './wow-hero.helpers';

type Viewer = GuildPage['viewer'];

function ctx(viewer: Viewer, faction: string | null = 'Alliance'): HubCtx {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction, memberCount: 3, lastSnapshotAt: null },
        importedBy: null,
        viewer,
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page } as HubCtx;
}

const PLAIN: Viewer = { role: 'member', canEdit: false, canManageEditors: false, notificationsMuted: false };
const GM: Viewer = { ...PLAIN, isGuildMaster: true };
const DELEGATED: Viewer = { role: 'officer', canEdit: true, canManageEditors: false, notificationsMuted: false };
const STAFF_NON_MEMBER: Viewer = { role: 'leader', canEdit: true, canManageEditors: true };
const GM_AND_EDITOR: Viewer = { ...DELEGATED, isGuildMaster: true };
const VISITOR: Viewer = { role: 'visitor', canEdit: false, canManageEditors: false };

describe('heroRoleBadges', () => {
    it.each([
        ['GM-rank member (no edit grant)', GM, ['Guild Master']],
        ['delegated editor', DELEGATED, ['Editor']],
        ['admin/operator who is not a member', STAFF_NON_MEMBER, ['Editor']],
        ['plain member', PLAIN, ['Member']],
        ['GM who also holds an editor grant', GM_AND_EDITOR, ['Guild Master', 'Editor']],
        ['visitor', VISITOR, []],
    ] as const)('%s → %o', (_label, viewer, expected) => {
        expect(heroRoleBadges(viewer)).toEqual(expected);
    });
});

describe('WowViewerRolePills', () => {
    it('labels each chip as the viewer\'s role, success for GM/Editor', () => {
        render(<WowViewerRolePills {...ctx(GM_AND_EDITOR)} />);
        const chips = screen.getAllByTitle('Your role in this guild');
        expect(chips.map((c) => c.textContent)).toEqual(['Your role: Guild Master', 'Your role: Editor']);
        expect(chips.map((c) => c.getAttribute('data-tone'))).toEqual(['success', 'success']);
    });

    it('shows the "Your role:" label visibly, not only to screen readers or on hover (phones)', () => {
        render(<WowViewerRolePills {...ctx(GM)} />);
        const label = screen.getByTestId('role-chip-label');
        expect(label).toHaveTextContent('Your role:');
        expect(label, 'the label must be visible on a phone, not sr-only').not.toHaveClass('sr-only');
        expect(label.className, 'no breakpoint may hide the label on narrow screens').not.toMatch(/(^|\s)(hidden|sr-only)(\s|$)/);
    });

    it('renders a neutral Member chip for a plain member', () => {
        render(<WowViewerRolePills {...ctx(PLAIN)} />);
        expect(screen.getByTitle('Your role in this guild')).toHaveAttribute('data-tone', 'neutral');
    });

    it('renders nothing for a visitor', () => {
        const { container } = render(<WowViewerRolePills {...ctx(VISITOR)} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('WowFactionPill', () => {
    it.each([
        ['Alliance', 'Alliance', 'faction-alliance'],
        ['alliance', 'Alliance', 'faction-alliance'],
        ['Horde', 'Horde', 'faction-horde'],
        ['horde', 'Horde', 'faction-horde'],
    ] as const)('%s → "%s" painted with the %s token classes', (raw, label, tone) => {
        render(<WowFactionPill {...ctx(PLAIN, raw)} />);
        const pill = screen.getByText(label);
        expect(pill).toHaveAttribute('data-tone', tone);
        expect(pill).toHaveClass(`text-${tone}`, `bg-${tone}/10`, `border-${tone}/30`);
    });

    it('keeps an unknown faction (Neutral) as a neutral pill with the raw text', () => {
        render(<WowFactionPill {...ctx(PLAIN, 'Neutral')} />);
        expect(screen.getByText('Neutral')).toHaveAttribute('data-tone', 'neutral');
    });

    it('renders nothing when the guild has no faction', () => {
        const { container } = render(<WowFactionPill {...ctx(PLAIN, null)} />);
        expect(container).toBeEmptyDOMElement();
        expect(factionKey(null)).toBeNull();
    });
});

describe('WowFoundedPill (ROK-1170)', () => {
    function founded(foundedAt: string | null, withSummary = true): HubCtx {
        const base = ctx(PLAIN);
        const blizzardGuild = withSummary ? { blizzardGuild: { foundedAt, state: 'ok' as const } } : {};
        return { ...base, page: { ...base.page, guild: { ...base.page.guild, ...blizzardGuild } } };
    }
    const AT = '2024-03-15T12:00:00.000Z';

    it('shows "Founded Mar 2024" as a neutral pill with the full date in its title', () => {
        render(<WowFoundedPill {...founded(AT)} />);
        const pill = screen.getByText('Founded Mar 2024');
        expect(pill).toHaveAttribute('data-tone', 'neutral');
        expect(pill).toHaveAttribute('title', new Date(AT).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }));
        expect(pill.getAttribute('title'), 'the title carries the day, not just month + year').toMatch(/15/);
    });

    it.each([
        ['a null founded date', founded(null)],
        ['no Blizzard summary on the page (Classic / older payload)', founded(null, false)],
    ])('renders nothing for %s', (_label, value) => {
        const { container } = render(<WowFoundedPill {...value} />);
        expect(container).toBeEmptyDOMElement();
    });
});
