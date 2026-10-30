/**
 * ROK-1870 verify lane 2 (FAIL 12) — the community blurb renders in the hub
 * hero under the name, and nothing renders when the hub has none.
 */
import type { JSX } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { buildCommunityPage } from '../../test/factories/community-hub';
import { renderWithProviders } from '../../test/render-helpers';
import { HubHero } from './hub-hero';
import { HubSettingsTrigger } from './settings/settings-trigger';

function Hero({ page, action }: { page: GuildPage; action?: JSX.Element }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <HubHero ctx={{ page, raids }} module={undefined} nextRaid={null} action={action ?? null} />;
}

describe('HubHero — community blurb', () => {
    it('shows the blurb under the hub name', () => {
        renderWithProviders(<Hero page={buildCommunityPage()} />);
        expect(screen.getByTestId('hub-hero-blurb')).toHaveTextContent('Honour mode runs');
    });

    it('renders no blurb line when the hub has none', () => {
        const page = buildCommunityPage();
        const community = page.community;
        if (community === undefined) throw new Error('factory page has no community block');
        renderWithProviders(<Hero page={{ ...page, community: { ...community, blurb: null } }} />);
        expect(screen.queryByTestId('hub-hero-blurb')).toBeNull();
    });
});

/**
 * ROK-1884 — below `lg` the chips get their own row under a one-line title
 * that shares the first row with the actions; `lg` keeps the old flex row.
 */
describe('HubHero — header layout (ROK-1884)', () => {
    function renderWithAction(): void {
        renderWithProviders(<Hero page={buildCommunityPage()} action={<button type="button">Settings</button>} />);
    }

    it('below lg: a 3-column grid with crest | title | actions on row 1', () => {
        renderWithAction();
        expect(screen.getByTestId('guild-hero')).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)_auto]');
        const title = screen.getByRole('heading', { level: 1 });
        expect(title).toHaveClass('col-start-2', 'row-start-1', 'truncate', 'min-w-0');
        const actions = screen.getByTestId('hub-hero-actions');
        expect(actions).toHaveClass('col-start-3', 'row-start-1');
        expect(actions).toContainElement(screen.getByRole('button', { name: 'Settings' }));
    });

    it('below lg: the chip row spans the full width under the title', () => {
        renderWithAction();
        const chips = screen.getByTestId('hub-hero-chips');
        expect(chips).toHaveClass('col-span-full', 'flex', 'flex-wrap');
        expect(chips).toContainElement(screen.getByTestId('guild-member-count'));
        // The wrappers dissolve so title, chips and actions are grid items of the header.
        expect(screen.getByTestId('hub-hero-identity')).toHaveClass('contents');
        expect(screen.getByTestId('hub-hero-side')).toHaveClass('contents');
    });

    it('at lg: the original flex row, wrapping title and right-aligned side column come back', () => {
        renderWithAction();
        expect(screen.getByTestId('guild-hero')).toHaveClass('lg:flex', 'lg:flex-row', 'lg:justify-between', 'items-center', 'lg:gap-4');
        expect(screen.getByRole('heading', { level: 1 })).toHaveClass('lg:mb-2', 'lg:overflow-visible', 'lg:whitespace-normal', 'lg:break-words');
        expect(screen.getByTestId('hub-hero-identity')).toHaveClass('lg:flex', 'lg:min-w-0', 'lg:items-center', 'lg:gap-4');
        expect(screen.getByTestId('hub-hero-side')).toHaveClass('lg:flex', 'lg:flex-col', 'lg:items-end', 'lg:gap-2');
        expect(screen.getByTestId('hub-hero-actions')).toHaveClass('lg:contents');
    });

    it('renders no actions cell when the viewer has no action', () => {
        renderWithProviders(<Hero page={buildCommunityPage()} />);
        expect(screen.queryByTestId('hub-hero-actions')).toBeNull();
    });

    it('with no action: a 2-column grid, so no empty third track steals a gap from the title', () => {
        renderWithProviders(<Hero page={buildCommunityPage()} />);
        const hero = screen.getByTestId('guild-hero');
        expect(hero).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)]');
        expect(hero).not.toHaveClass('grid-cols-[auto_minmax(0,1fr)_auto]');
    });
});

describe('HubSettingsTrigger — icon-only below sm (ROK-1884)', () => {
    it('hides the label visually below sm but keeps it as the accessible name, with a 44px target', () => {
        renderWithProviders(<HubSettingsTrigger onOpen={() => undefined} label="Server settings" />);
        const button = screen.getByRole('button', { name: 'Server settings' });
        expect(button).toHaveClass('min-h-[44px]', 'min-w-[44px]');
        expect(screen.getByTestId('guild-settings-trigger-label')).toHaveClass('hidden', 'sm:inline');
        expect(screen.getByTestId('guild-settings-trigger-label')).not.toHaveClass('sr-only');
    });
});

/** ROK-1814 — the hero renders the hub's crest in today's 64/80px box; no crest keeps the initials. */
describe('HubHero — crest (ROK-1814)', () => {
    function withCrest(crest: GuildPage['guild']['crest']): GuildPage {
        const page = buildCommunityPage();
        return { ...page, guild: { ...page.guild, crest } };
    }

    it('no crest → the initials box exactly as before, in the grid\'s first cell', () => {
        renderWithProviders(<Hero page={withCrest(null)} />);
        const crest = within(screen.getByTestId('guild-hero')).getByTestId('hub-crest');
        expect(crest).toHaveAttribute('data-crest', 'initials');
        expect(crest).toHaveClass('col-start-1', 'row-start-1', 'h-16', 'w-16', 'sm:h-20', 'sm:w-20');
    });

    it('a preset crest replaces the initials', () => {
        renderWithProviders(<Hero page={withCrest({ source: 'preset', emblemId: 'crown', fg: 'or', bg: 'sable' })} />);
        const crest = screen.getByTestId('hub-crest');
        expect(crest).toHaveAttribute('data-crest', 'preset');
        expect(crest).toHaveClass('col-start-1', 'row-start-1', 'h-16', 'sm:h-20');
    });

    /** Operator ruling 2026-10-30 — the in-game GM edits the crest without being a hub editor. */
    function withViewer(viewer: Partial<GuildPage['viewer']>): GuildPage {
        const page = withCrest(null);
        return { ...page, viewer: { ...page.viewer, ...viewer } };
    }

    it('a GM with canEditCrest (but not canEdit) gets the "Change crest" editor', () => {
        renderWithProviders(<Hero page={withViewer({ canEdit: false, canEditCrest: true })} />);
        expect(screen.getByRole('button', { name: 'Change crest' })).toBeInTheDocument();
    });

    it('canEditCrest false wins over canEdit; an older payload without it falls back to canEdit', () => {
        const { unmount } = renderWithProviders(<Hero page={withViewer({ canEdit: true, canEditCrest: false })} />);
        expect(screen.queryByTestId('hub-crest-edit')).toBeNull();
        unmount();
        const page = withViewer({ canEdit: true });
        const legacyViewer = { ...page.viewer };
        delete legacyViewer.canEditCrest;
        renderWithProviders(<Hero page={{ ...page, viewer: legacyViewer }} />);
        expect(screen.getByTestId('hub-crest-edit')).toBeInTheDocument();
    });

    it('an upload shows the large image; a load error falls back to initials', () => {
        renderWithProviders(<Hero page={withCrest({ source: 'upload', urlSm: '/u/a.sm.webp', urlLg: '/u/a.lg.webp' })} />);
        const img = screen.getByTestId('hub-crest-img');
        expect(img.getAttribute('src')).toMatch(/\/u\/a\.lg\.webp$/);
        fireEvent.error(img);
        expect(screen.getByTestId('hub-crest')).toHaveAttribute('data-crest', 'initials');
    });
});
