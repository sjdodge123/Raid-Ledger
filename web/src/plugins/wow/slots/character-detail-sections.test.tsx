/**
 * ROK-1726 (AC5, D6): the sections slot resolves the effective WoW variant
 * once — including a manual WoW: Forever character (`gameVariant: null` + a
 * ruleset, read from the page's cached character query) — and drives the
 * empty states and Wowhead links from it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterEquipmentDto, CharacterLockoutsDto } from '@raid-ledger/contract';
import { CharacterDetailSections } from './character-detail-sections';
import { FOREVER_ADDON_HINT_EQUIPMENT, FOREVER_ADDON_HINT_TALENTS } from '../lib/wow-variant-config';

vi.mock('../hooks/use-wowhead-tooltips', () => ({ useWowheadTooltips: vi.fn() }));
const panelProps = vi.hoisted(() => vi.fn());
vi.mock('../components/CharacterProfessionsPanel', () => ({
    CharacterProfessionsPanel: (props: unknown) => { panelProps(props); return <h2>Professions</h2>; },
}));
const addonsCard = vi.hoisted(() => ({ show: true }));
vi.mock('./character-addons-card', () => ({
    CharacterAddonsCard: () => (addonsCard.show ? <h2>Guild recommends</h2> : null),
}));

const ARMORY_EQUIPMENT = 'Equipment data is only available for characters imported from the Blizzard Armory.';
const ARMORY_TALENTS = 'Talent data is only available for characters imported from the Blizzard Armory.';
const REFRESH_EQUIPMENT = 'Equipment data may not be available for this character. Try refreshing.';
const EQUIPMENT: CharacterEquipmentDto = {
    equippedItemLevel: 60,
    syncedAt: '2026-10-01T00:00:00.000Z',
    items: [{ slot: 'HEAD', name: 'Test Helm', itemId: 19019, quality: 'EPIC', itemLevel: 60, itemSubclass: 'Plate' }],
};

interface Case {
    gameVariant: string | null; ruleset?: string | null; isArmoryImported?: boolean;
    equipment?: CharacterEquipmentDto | null; gameSlug?: string; registryPending?: boolean;
    lockouts?: CharacterLockoutsDto;
    /** Extra fields on the cached character (race / gender / class / name). */
    character?: Record<string, string | null>; renderUrl?: string | null;
}

/** Seeds the character + game registry caches; `registryPending` leaves the registry to load over the network. */
function renderSections({ gameVariant, ruleset = null, isArmoryImported = false, equipment = null, gameSlug, registryPending, lockouts, character = {}, renderUrl = null }: Case) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(['characters', 'char-1'], { id: 'char-1', gameId: 1, gameVariant, ruleset, ...character, ...(lockouts ? { lockouts } : {}) });
    if (!registryPending) client.setQueryData(['game-registry'], { data: gameSlug ? [{ id: 1, slug: gameSlug, name: 'WoW' }] : [] });
    const { container } = render(
        <QueryClientProvider client={client}>
            <CharacterDetailSections equipment={equipment} talents={null} professions={null} gameVariant={gameVariant}
                renderUrl={renderUrl} isArmoryImported={isArmoryImported} characterClass="Mage" isOwner={false}
                characterId="char-1" gameId={1} />
        </QueryClientProvider>,
    );
    return container;
}

const hintUnder = (title: string) => screen.getByText(title).nextElementSibling?.textContent;

describe('CharacterDetailSections — empty-state copy (AC5)', () => {
    it.each<[string, Case]>([
        ['gameVariant wow_forever', { gameVariant: 'wow_forever' }],
        ['manual Forever: gameVariant null + ruleset', { gameVariant: null, ruleset: 'pvp' }],
    ])('%s → addon hints, not the Armory copy', (_label, c) => {
        renderSections(c);
        expect(hintUnder('No equipment data')).toBe(FOREVER_ADDON_HINT_EQUIPMENT);
        expect(hintUnder('No talent data')).toBe(FOREVER_ADDON_HINT_TALENTS);
    });

    it.each(['classic_era', 'retail', null])('%j without a ruleset keeps the Armory copy verbatim', (gameVariant) => {
        renderSections({ gameVariant });
        expect(hintUnder('No equipment data')).toBe(ARMORY_EQUIPMENT);
        expect(hintUnder('No talent data')).toBe(ARMORY_TALENTS);
    });

    it('an Armory-imported character with an empty item list keeps the refresh copy', () => {
        renderSections({ gameVariant: 'classic_era', isArmoryImported: true, equipment: { ...EQUIPMENT, items: [] } });
        expect(hintUnder('No equipment data')).toBe(REFRESH_EQUIPMENT);
    });
});

describe('CharacterDetailSections — Wowhead item links use the resolved variant (D6)', () => {
    it.each<[string, Case, string]>([
        ['manual Forever (null variant + ruleset)', { gameVariant: null, ruleset: 'pvp' }, 'https://www.wowhead.com/forever/item=19019'],
        ['Classic Era', { gameVariant: 'classic_era' }, 'https://www.wowhead.com/classic/item=19019'],
        ['retail', { gameVariant: 'retail' }, 'https://www.wowhead.com/item=19019'],
    ])('%s', (_label, c, href) => {
        const container = renderSections({ ...c, isArmoryImported: true, equipment: EQUIPMENT });
        expect(container.querySelector('a[href*="wowhead.com"]')?.getAttribute('href')).toBe(href);
    });
});

/** ROK-1727 (Q4): addon equipment shows its source + snapshot date; Armory shows nothing new. */
describe('CharacterDetailSections — via-addon source line', () => {
    it('source addon → "via addon · <date>" in muted text under the heading', () => {
        renderSections({ gameVariant: 'wow_forever', equipment: { ...EQUIPMENT, source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z' } });
        const line = screen.getByText('via addon · 1 Oct 2026');
        expect(line).toHaveClass('text-xs', 'text-muted');
    });

    it.each<[string, CharacterEquipmentDto]>([
        ['source armory', { ...EQUIPMENT, source: 'armory' }],
        ['source absent', EQUIPMENT],
    ])('%s → no via-addon line', (_label, equipment) => {
        renderSections({ gameVariant: 'classic_era', isArmoryImported: true, equipment });
        expect(screen.queryByText(/via addon/)).toBeNull();
    });
});

/** ROK-1751: LedgerLink exports carry `ruleset: null`; the character's game slug resolves Forever. */
describe('CharacterDetailSections — Forever resolved from the game slug', () => {
    const QUESTS = {
        source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z', inProgress: [], completedKnown: [],
        counts: { completedKnown: 0, knownTotal: 3, completedTotal: 5, inProgress: 0 },
    };

    it('Forever game + null variant + null ruleset → addon hints and the Quests section', async () => {
        let questsRequested = false;
        server.use(http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => {
            questsRequested = true;
            return HttpResponse.json({ quests: QUESTS });
        }));
        renderSections({ gameVariant: null, ruleset: null, gameSlug: 'world-of-warcraft-forever' });
        expect(hintUnder('No equipment data')).toBe(FOREVER_ADDON_HINT_EQUIPMENT);
        expect(await screen.findByRole('heading', { name: 'Quests' })).toBeInTheDocument();
        expect(questsRequested).toBe(true);
    });

    it('Classic game + null ruleset → Armory copy, no Quests section', () => {
        renderSections({ gameVariant: null, ruleset: null, gameSlug: 'world-of-warcraft-classic' });
        expect(hintUnder('No equipment data')).toBe(ARMORY_EQUIPMENT);
        expect(screen.queryByRole('heading', { name: 'Quests' })).toBeNull();
    });
});

/** ROK-1751 review MINOR 1: no Armory copy -> addon hint flip while the registry is still loading. */
describe('CharacterDetailSections — game registry still loading', () => {
    it('null variant + null ruleset while the registry is pending → neither the Armory copy nor the addon hint', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let questsRequested = false;
        server.use(
            http.get('http://localhost:3000/games/configured', async () => {
                await gate;
                return HttpResponse.json({ data: [{ id: 1, slug: 'world-of-warcraft-forever', name: 'WoW' }] });
            }),
            http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => {
                questsRequested = true;
                return HttpResponse.json({ quests: null });
            }),
        );
        renderSections({ gameVariant: null, ruleset: null, registryPending: true });
        expect(screen.queryByText(ARMORY_EQUIPMENT)).toBeNull();
        expect(screen.queryByText(ARMORY_TALENTS)).toBeNull();
        expect(screen.queryByText(FOREVER_ADDON_HINT_EQUIPMENT)).toBeNull();
        expect(questsRequested).toBe(false);
        release();
        expect(await screen.findByText(FOREVER_ADDON_HINT_EQUIPMENT)).toBeInTheDocument();
        expect(screen.queryByText(ARMORY_EQUIPMENT)).toBeNull();
        await waitFor(() => expect(questsRequested).toBe(true));
    });
});

/** ROK-1743: the Saved instances card reads `lockouts` from the page's cached character query. */
describe('CharacterDetailSections — Forever saved instances', () => {
    const LOCKOUTS: CharacterLockoutsDto = {
        source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z',
        instances: [{
            name: 'Molten Core', instanceId: 409, difficultyId: 9, difficulty: '40 Player',
            resetAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), killed: 4, total: 10,
        }],
    };

    it('character with lockouts → "Saved instances" card with its rows', () => {
        const container = renderSections({ gameVariant: 'wow_forever', lockouts: LOCKOUTS });
        expect(screen.getByRole('heading', { name: 'Saved instances' })).toBeInTheDocument();
        expect(container.querySelectorAll('[data-lockout-row]')).toHaveLength(1);
    });

    it('character without lockouts → no "Saved instances" card', () => {
        const container = renderSections({ gameVariant: 'wow_forever' });
        expect(screen.queryByText('Saved instances')).toBeNull();
        expect(container.querySelector('[data-lockout-row]')).toBeNull();
    });
});

/** ROK-1747: the render slot's portrait is built from the cached character, with renderUrl standing in for the avatar. */
describe('CharacterDetailSections — Forever portrait in the equipment render slot', () => {
    const FOREVER_CHAR = { race: 'Night Elf', gender: 'female', class: 'Druid', name: 'Fernwhisper' };
    const forever = { gameVariant: null, ruleset: null, gameSlug: 'world-of-warcraft-forever', equipment: EQUIPMENT, character: FOREVER_CHAR };
    const quietQuests = () => server.use(http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => HttpResponse.json({ quests: null })));

    it('race + gender and no render → the race portrait fills the slot', () => {
        quietQuests();
        renderSections(forever);
        const tiles = screen.getAllByTestId('equipment-portrait');
        expect(tiles[0]?.querySelector('[data-testid="forever-portrait"]')?.getAttribute('data-portrait'), 'gender from the cached character reaches the slot portrait').toBe('race');
    });

    it('a Blizzard render wins over the portrait', () => {
        quietQuests();
        renderSections({ ...forever, renderUrl: 'https://render.example/main-raw.png' });
        expect(screen.queryByTestId('equipment-portrait')).toBeNull();
    });
});

describe('CharacterDetailSections — professions source (ROK-2107 AC8)', () => {
    const lastSource = () => (panelProps.mock.lastCall?.[0] as { source?: unknown } | undefined)?.source;

    it.each([
        ['wow_forever', 'blizzard'], ['wow_forever', 'manual'], ['retail', 'blizzard'], ['retail', 'manual'],
    ])('%s character with professionsSource %s → the panel gets that source', (gameVariant, source) => {
        renderSections({ gameVariant, character: { professionsSource: source } });
        expect(lastSource(), `panel source for ${gameVariant}`).toBe(source);
    });

    it.each([
        ['classic_era', 'manual'], ['classic', 'manual'], ['classic_anniversary', 'manual'],
    ])('%s character with professionsSource %s → the panel gets null (no pill on Classic)', (gameVariant, source) => {
        renderSections({ gameVariant, character: { professionsSource: source } });
        expect(lastSource(), `panel source for ${gameVariant}`).toBeNull();
    });

    it('a Classic character whose row really is Blizzard-sourced still gets the Armory source', () => {
        renderSections({ gameVariant: 'classic_era', character: { professionsSource: 'blizzard' } });
        expect(lastSource()).toBe('blizzard');
    });

    it('a character without professionsSource → the panel gets null (no pill)', () => {
        renderSections({ gameVariant: 'retail' });
        expect(lastSource()).toBeNull();
    });
});

/** ROK-2146 ruling 3 (layout A): main + 320px sidebar at >= lg, one stack below it — one tree, CSS only. */
const LAYOUT_QUESTS = {
    source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z', inProgress: [], completedKnown: [],
    counts: { completedKnown: 0, knownTotal: 3, completedTotal: 5, inProgress: 0 },
};
const LAYOUT_LOCKOUTS: CharacterLockoutsDto = {
    source: 'addon', syncedAt: '2026-10-01T12:00:00.000Z',
    instances: [{
        name: 'Molten Core', instanceId: 409, difficultyId: 9, difficulty: '40 Player',
        resetAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), killed: 4, total: 10,
    }],
};
/** A matchMedia whose lg answer can flip, firing its change listeners like a resize/rotate. */
function setViewport(desktop: boolean): (next: boolean) => void {
    let matches = desktop;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn((query: string) => ({
            get matches() { return query === '(min-width: 1024px)' ? matches : false; }, media: query, onchange: null,
            addListener: (cb: () => void) => listeners.add(cb), removeListener: (cb: () => void) => listeners.delete(cb),
            addEventListener: (_: string, cb: () => void) => listeners.add(cb), removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
            dispatchEvent: () => false,
        })),
    });
    return (next) => { matches = next; act(() => { listeners.forEach((cb) => cb()); }); };
}
async function renderForever(lockouts: CharacterLockoutsDto | null = LAYOUT_LOCKOUTS) {
    server.use(http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => HttpResponse.json({ quests: LAYOUT_QUESTS })));
    const container = renderSections({ gameVariant: 'wow_forever', equipment: EQUIPMENT, ...(lockouts ? { lockouts } : {}) });
    await screen.findByRole('heading', { name: 'Quests' });
    await screen.findByRole('heading', { name: 'Guild recommends' });
    return container;
}
function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing: ${label}`);
    return value;
}
const headings = (el: Element) => Array.from(el.querySelectorAll('h2')).map((h) => h.textContent);
/** The order below lg: `display: contents` columns flatten, then `max-lg:order-N` sorts (stable). */
function stackOrder(layout: Element): (string | null)[] {
    const items = Array.from(layout.children).flatMap((c) => (c.classList.contains('contents') ? Array.from(c.children) : [c]));
    const order = (el: Element) => Number(/(?:^|\s)max-lg:order-(\d+)/.exec(el.className)?.[1] ?? 0);
    return items.map((el, i) => ({ el, i })).sort((a, b) => order(a.el) - order(b.el) || a.i - b.i).flatMap(({ el }) => (el.tagName === 'H2' ? [el.textContent] : headings(el)));
}

describe('CharacterDetailSections — layout A', () => {
    const originalMatchMedia = window.matchMedia;
    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
        addonsCard.show = true;
    });
    it('>= lg: main column holds Equipment, Talents, Quests; the sidebar Professions, Saved instances, Guild recommends', async () => {
        setViewport(true);
        const container = await renderForever();
        const main = must(container.querySelector('[data-sections-column="main"]'), 'main column');
        const sidebar = must(container.querySelector('[data-sections-column="sidebar"]'), 'sidebar');
        expect(sidebar.tagName, 'sidebar is an <aside>').toBe('ASIDE');
        expect(headings(main)).toEqual(['Equipment', 'Talents', 'Quests']);
        expect(headings(sidebar)).toEqual(['Professions', 'Saved instances', 'Guild recommends']);
        expect(main.className.split(' '), 'main is a column only at lg').toEqual(expect.arrayContaining(['contents', 'lg:flex', 'lg:flex-1']));
        expect(sidebar.className.split(' '), 'sidebar is 320px only at lg').toEqual(expect.arrayContaining(['contents', 'lg:flex', 'lg:w-80']));
    });

    it('below lg: one stack — Equipment, Talents, Professions, Saved instances, Quests, Guild recommends', async () => {
        setViewport(false);
        const container = await renderForever();
        const layout = must(container.querySelector('[data-sections-layout]'), 'layout');
        expect(layout.className.split(' '), 'a column stack, a row at lg').toEqual(expect.arrayContaining(['flex', 'flex-col', 'lg:flex-row']));
        expect(stackOrder(layout)).toEqual(['Equipment', 'Talents', 'Professions', 'Saved instances', 'Quests', 'Guild recommends']);
    });

    it('crossing lg (resize, tablet rotate) keeps every panel mounted — no tree swap', async () => {
        const flip = setViewport(true);
        const container = await renderForever();
        const professions = screen.getByRole('heading', { name: 'Professions' });
        const layout = container.querySelector('[data-sections-layout]');
        flip(false);
        expect(professions.isConnected, 'Professions panel survives lg → below lg').toBe(true);
        expect(screen.getByRole('heading', { name: 'Professions' }), 'same DOM node, not a remount').toBe(professions);
        expect(container.querySelector('[data-sections-layout]'), 'same layout node').toBe(layout);
    });

    it('a panel that renders null leaves no empty wrapper behind', async () => {
        setViewport(true);
        const container = await renderForever(null);
        const sidebar = must(container.querySelector('[data-sections-column="sidebar"]'), 'sidebar');
        expect(Array.from(sidebar.children).map((c) => c.textContent)).toEqual(['Professions', 'Guild recommends']);
    });

    it('a wrapper whose panel renders null is hidden (empty:hidden), so it leaves no gap', async () => {
        setViewport(true);
        addonsCard.show = false;
        server.use(http.get('http://localhost:3000/plugins/wow/characters/char-1/quests', () => HttpResponse.json({ quests: LAYOUT_QUESTS })));
        const container = renderSections({ gameVariant: 'wow_forever', equipment: EQUIPMENT, lockouts: LAYOUT_LOCKOUTS });
        await screen.findByRole('heading', { name: 'Quests' });
        const addons = must(container.querySelector('[data-sections-slot="addons"]'), 'addons wrapper');
        expect(addons.childElementCount, 'Guild recommends rendered nothing').toBe(0);
        expect(addons.className.split(' ')).toContain('empty:hidden');
    });
});
