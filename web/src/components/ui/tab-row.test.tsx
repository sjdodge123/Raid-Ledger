/**
 * ROK-1785 — TabRow + useHashTab (spec ROK-1781 D8): hash-synced underline
 * tab links, hidden tabs dropped, aria-current on the active one, and the
 * active tab revealed inside its scrolling row.
 */
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { TabRow, type TabRowTab } from './tab-row';
import { tabFromHash, tabPanelId, useHashTab } from './tab-row.helpers';

const TABS: TabRowTab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'roster', label: 'Roster' },
    { id: 'loot', label: 'Loot', hidden: true },
    { id: 'resources', label: 'Resources' },
];
const IDS = ['overview', 'roster', 'resources'];

function Harness(): JSX.Element {
    const [active] = useHashTab(IDS, 'overview');
    return <TabRow tabs={TABS} activeId={active} label="Guild page sections" />;
}

function setHash(hash: string): void {
    act(() => {
        window.history.replaceState(null, '', hash);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
}

function rect(left: number, right: number): DOMRect {
    return { left, right, top: 0, bottom: 44, width: right - left, height: 44, x: left, y: 0, toJSON: () => ({}) };
}

/** The row is 0–100px wide; the active tab sits at `activeLeft`, every other tab at 0–50. */
function mockGeometry(activeLeft: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'NAV') return rect(0, 100);
        return this.getAttribute('aria-current') === 'page' ? rect(activeLeft, activeLeft + 60) : rect(0, 50);
    });
}

type ScrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => void;
let scrollSpy: Mock<ScrollIntoView>;

beforeEach(() => {
    window.history.replaceState(null, '', '/');
    scrollSpy = vi.fn<ScrollIntoView>();
    Element.prototype.scrollIntoView = scrollSpy;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('TabRow — markup', () => {
    it('renders one hash link per visible tab inside a named nav, and drops hidden tabs', () => {
        render(<TabRow tabs={TABS} activeId="overview" label="Guild page sections" />);
        const nav = screen.getByRole('navigation', { name: 'Guild page sections' });
        const links = within(nav).getAllByRole('link');
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['#overview', '#roster', '#resources']);
        expect(screen.queryByRole('link', { name: 'Loot' })).toBeNull();
    });

    it('marks only the active tab with aria-current="page" and the success underline', () => {
        render(<TabRow tabs={TABS} activeId="roster" label="Sections" />);
        const roster = screen.getByRole('link', { name: 'Roster' });
        expect(roster).toHaveAttribute('aria-current', 'page');
        expect(roster.className).toContain('border-success');
        expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    });

    it('scrolls inside its own row with a thin scrollbar', () => {
        render(<TabRow tabs={TABS} activeId="overview" label="Sections" />);
        const nav = screen.getByRole('navigation');
        expect(nav.className).toContain('overflow-x-auto');
        // The tabs' -mb-px underline is 1px of vertical overflow: without this a vertical scrollbar shows on phones.
        expect(nav.className, 'the row must never scroll (or draw a scrollbar) vertically').toContain('overflow-y-hidden');
        expect(nav.className).toContain('[scrollbar-width:thin]');
    });
});

describe('useHashTab', () => {
    it('starts on the tab named by the hash', () => {
        window.history.replaceState(null, '', '#resources');
        render(<Harness />);
        expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('aria-current', 'page');
    });

    it('falls back to the default for no hash, an unknown hash, or a hidden tab', () => {
        expect(tabFromHash('', IDS, 'overview')).toBe('overview');
        expect(tabFromHash('#nope', IDS, 'overview')).toBe('overview');
        expect(tabFromHash('#loot', IDS, 'overview')).toBe('overview');
        expect(tabFromHash('#roster', IDS, 'overview')).toBe('roster');
    });

    it('follows the hashchange event', () => {
        render(<Harness />);
        expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
        setHash('#roster');
        expect(screen.getByRole('link', { name: 'Roster' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    });

    it('selectTab writes the hash, and the hook follows it', async () => {
        function Picker(): JSX.Element {
            const [active, selectTab] = useHashTab(IDS, 'overview');
            return <button type="button" onClick={() => selectTab('roster')}>{active}</button>;
        }
        render(<Picker />);
        act(() => screen.getByRole('button').click());
        expect(window.location.hash).toBe('#roster');
        expect(await screen.findByRole('button', { name: 'roster' })).toBeInTheDocument();
    });

    it('builds panel ids as <prefix>-tab-<id>, never the bare id', () => {
        expect(tabPanelId('guild', 'roster')).toBe('guild-tab-roster');
    });
});

describe('TabRow — reveals the active tab', () => {
    it('scrolls a clipped active tab into view on mount', () => {
        mockGeometry(200);
        render(<TabRow tabs={TABS} activeId="resources" label="Sections" />);
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
        expect(scrollSpy.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'Resources' }));
    });

    it('scrolls again when the active tab changes', () => {
        mockGeometry(200);
        render(<Harness />);
        scrollSpy.mockClear();
        setHash('#resources');
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'Resources' }));
    });

    it('leaves an unclipped active tab alone, so the page does not jump to the row', () => {
        mockGeometry(20);
        render(<TabRow tabs={TABS} activeId="roster" label="Sections" />);
        expect(scrollSpy).not.toHaveBeenCalled();
    });
});

/**
 * ROK-1830 r1 — the retired-hash rewrite. `#roster` settles on `#members`
 * only when Members is actually in `ids`; a hidden target falls through to the
 * default tab, and rewriting then would hand out a link to a tab that is not
 * there.
 */
describe('useHashTab — retired hash aliases', () => {
    const ALIASES = { roster: 'members' };

    function AliasHarness({ ids }: { ids: readonly string[] }): JSX.Element {
        const [active] = useHashTab(ids, 'overview', ALIASES);
        return <p data-testid="active">{active}</p>;
    }

    it('rewrites #roster to #members when Members is visible', async () => {
        window.history.replaceState(null, '', '#roster');
        render(<AliasHarness ids={['overview', 'members']} />);
        await waitFor(() => expect(window.location.hash).toBe('#members'));
        expect(screen.getByTestId('active')).toHaveTextContent('members');
    });

    it('leaves #roster alone when the Members tab is not visible', async () => {
        window.history.replaceState(null, '', '#roster');
        render(<AliasHarness ids={['overview']} />);
        await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('overview'));
        expect(window.location.hash, 'a hidden target must not be written into the address bar').toBe('#roster');
    });
});
