/**
 * ROK-1654 (AC1): the Armory import form sits on the shared form primitives —
 * Region is a segmented RadioGroup with no blue paint, Realm and Character Name
 * are required Fields that carry their own errors (ruling 8), API errors stay in
 * a role=alert banner, and Search Armory is a loading Button.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import { ARMORY_UNAVAILABLE_NOTE } from '../lib/armory-import';
import { WowArmoryImportForm } from './wow-armory-import-form';

const REALMS_URL = 'http://localhost:3000/blizzard/realms';
const PREVIEW_URL = 'http://localhost:3000/blizzard/character-preview';
const REALMS = [{ id: 1, name: 'Whitemane', slug: 'whitemane' }];

/** Serves the realm list and records the region of every realms request. */
function realmsLoad(): string[] {
    const regions: string[] = [];
    server.use(http.get(REALMS_URL, ({ request }) => {
        regions.push(new URL(request.url).searchParams.get('region') ?? '');
        return HttpResponse.json({ data: REALMS });
    }));
    return regions;
}

let releasePreview: (() => void) | null = null;
afterEach(() => { releasePreview?.(); releasePreview = null; });

/** A preview request that stays pending until the test releases it, then 404s. */
function deferredPreview() {
    const gate = new Promise<void>((resolve) => { releasePreview = resolve; });
    server.use(http.get(PREVIEW_URL, async () => {
        await gate;
        return HttpResponse.json({ statusCode: 404, message: 'Character not found' }, { status: 404 });
    }));
}

const nameInput = () => screen.getByPlaceholderText('e.g. Arthas');
const searchButton = () => screen.getByRole('button', { name: 'Search Armory' });

async function fillAndSearch(user: ReturnType<typeof userEvent.setup>) {
    await user.type(nameInput(), 'Arthas');
    await user.type(screen.getByRole('combobox'), 'Whitemane');
    await user.click(searchButton());
}

describe('WowArmoryImportForm — Region (ROK-1654 AC1)', () => {
    it('is a Region radiogroup of four segments with US checked by default', () => {
        realmsLoad();
        renderWithProviders(<WowArmoryImportForm />);
        expect(screen.queryAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['us', 'eu', 'kr', 'tw']);
        const group = screen.getByRole('radiogroup', { name: 'Region' });
        expect(within(group).getByRole('radio', { name: 'US' })).toBeChecked();
    });

    it('checks the defaultRegion', () => {
        realmsLoad();
        renderWithProviders(<WowArmoryImportForm defaultRegion="eu" />);
        expect(screen.queryAllByRole('radio', { checked: true }).map((r) => r.getAttribute('value'))).toEqual(['eu']);
    });

    it('re-queries realms for the region picked on the EU radio', async () => {
        const regions = realmsLoad();
        const user = userEvent.setup();
        renderWithProviders(<WowArmoryImportForm />);
        await user.click(screen.getByRole('radio', { name: 'EU' }));
        await screen.findByRole('radio', { name: 'EU', checked: true });
        await waitFor(() => expect(regions).toContain('eu'));
    });

    it('paints no blue anywhere in the form', () => {
        realmsLoad();
        const { container } = renderWithProviders(<WowArmoryImportForm />);
        const blue = Array.from(container.querySelectorAll('[class*="blue-"]')).map((el) => el.className);
        expect(blue).toEqual([]);
    });
});

describe('WowArmoryImportForm — required Fields (ROK-1654, ruling 8)', () => {
    it('names Character Name and Realm and marks both required', () => {
        realmsLoad();
        renderWithProviders(<WowArmoryImportForm />);
        expect(nameInput()).toHaveAccessibleName('Character Name');
        expect(nameInput()).toHaveAttribute('aria-required', 'true');
        const realm = screen.getByRole('combobox');
        expect(realm).toHaveAccessibleName('Realm');
        expect(realm).toHaveAttribute('aria-required', 'true');
    });

    it('shows a missing name as the Character Name field error', async () => {
        realmsLoad();
        const user = userEvent.setup();
        renderWithProviders(<WowArmoryImportForm />);
        await user.click(searchButton());
        expect(await screen.findByText('Character name is required')).toBeInTheDocument();
        expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
        expect(nameInput()).toHaveAccessibleDescription('Character name is required');
    });

    it('shows a missing realm as the Realm field error', async () => {
        realmsLoad();
        const user = userEvent.setup();
        renderWithProviders(<WowArmoryImportForm />);
        await user.type(nameInput(), 'Arthas');
        await user.click(searchButton());
        expect(await screen.findByText('Realm is required')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
        expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
    });
});

describe('WowArmoryImportForm — search (ROK-1654)', () => {
    it('marks Search Armory busy while the preview is pending', async () => {
        realmsLoad();
        deferredPreview();
        const user = userEvent.setup();
        renderWithProviders(<WowArmoryImportForm />);
        await fillAndSearch(user);
        const busy = screen.getByRole('button', { name: /search(ing)? armory/i });
        expect(busy).toHaveAttribute('aria-busy', 'true');
        releasePreview?.();
        await screen.findByText('Character not found');
    });

    it('keeps an API error in a role=alert banner, not on a field', async () => {
        realmsLoad();
        deferredPreview();
        const user = userEvent.setup();
        renderWithProviders(<WowArmoryImportForm />);
        await fillAndSearch(user);
        releasePreview?.();
        const message = await screen.findByText('Character not found');
        expect(message.closest('[role="alert"]')).not.toBeNull();
        expect(nameInput()).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-invalid', 'true');
    });
});

const IMPORT_URL = 'http://localhost:3000/users/me/characters/import/wow';
const FOREVER_PREVIEW = {
    name: 'Ana Forever', realm: null, class: 'Mage', spec: 'Frost', role: 'dps', level: 12, race: 'Human',
    faction: 'alliance', itemLevel: null, avatarUrl: null, profileUrl: null,
};

/** Serves the Forever preview and records every preview query string. */
function foreverPreviewLoad(): URLSearchParams[] {
    const calls: URLSearchParams[] = [];
    server.use(http.get(PREVIEW_URL, ({ request }) => {
        calls.push(new URL(request.url).searchParams);
        return HttpResponse.json(FOREVER_PREVIEW);
    }));
    return calls;
}

/** Records every import body; answers 400 so the test needs no full CharacterDto. */
function importLoad(): unknown[] {
    const bodies: unknown[] = [];
    server.use(http.post(IMPORT_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ statusCode: 400, message: 'stop' }, { status: 400 });
    }));
    return bodies;
}

/** Renders the Forever form with the runtime capability seeded, so the first render already knows it. */
function renderForever(enabled = true) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['blizzard', 'capabilities'], { armoryImport: { wow_forever: enabled } });
    return renderWithProviders(<WowArmoryImportForm gameVariant="wow_forever" />, { queryClient });
}

const firstName = () => screen.getByRole('textbox', { name: 'First name' });
const secondName = () => screen.getByRole('textbox', { name: 'Second name' });

describe('WowArmoryImportForm — WoW: Forever is realmless (ROK-1722)', () => {
    it('renders the Forever identity fields and no realm or single-name input', () => {
        renderForever();
        expect(screen.getByTestId('forever-identity-fields')).toBeInTheDocument();
        expect(screen.getByRole('radiogroup', { name: 'Ruleset' })).toBeInTheDocument();
        expect(firstName()).toBeInTheDocument();
        expect(secondName()).toBeInTheDocument();
        expect(screen.queryByLabelText('Realm')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('e.g. Arthas')).not.toBeInTheDocument();
    });

    it('previews with no realm and the joined two-part name, shows the ruleset, and imports with realm null + the ruleset', async () => {
        const previews = foreverPreviewLoad();
        const imports = importLoad();
        const user = userEvent.setup();
        renderForever();
        await user.click(screen.getByRole('radio', { name: /^PvP$/ }));
        await user.type(firstName(), 'Ana');
        await user.type(secondName(), 'Forever');
        await user.click(searchButton());
        expect(await screen.findByTestId('preview-location')).toHaveTextContent(/^PvP \(US\)$/);
        expect(previews).toHaveLength(1);
        const params = previews[0];
        expect(params?.has('realm')).toBe(false);
        expect(params?.get('name')).toBe('Ana Forever');
        expect(params?.get('region')).toBe('us');
        expect(params?.get('gameVariant')).toBe('wow_forever');
        await user.click(screen.getByRole('button', { name: 'Save character' }));
        await waitFor(() => expect(imports).toHaveLength(1));
        expect(imports[0]).toEqual({ name: 'Ana Forever', realm: null, region: 'us', gameVariant: 'wow_forever', isMain: false, ruleset: 'pvp' });
    });

    it('sends the picked EU region in the preview query and the import body', async () => {
        const previews = foreverPreviewLoad();
        const imports = importLoad();
        const user = userEvent.setup();
        renderForever();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Region' }), 'eu');
        await user.type(firstName(), 'Ana');
        await user.type(secondName(), 'Forever');
        await user.click(searchButton());
        await screen.findByTestId('preview-location');
        expect(previews).toHaveLength(1);
        expect(previews[0]?.get('region')).toBe('eu');
        await user.click(screen.getByRole('button', { name: 'Save character' }));
        await waitFor(() => expect(imports).toHaveLength(1));
        expect(imports[0]).toEqual({ name: 'Ana Forever', realm: null, region: 'eu', gameVariant: 'wow_forever', isMain: false, ruleset: 'normal' });
    });

    it('shows a one-word name as an inline error and sends no request', async () => {
        const previews = foreverPreviewLoad();
        const user = userEvent.setup();
        renderForever();
        await user.type(firstName(), 'Ana');
        await user.click(searchButton());
        expect(await screen.findByRole('alert')).toHaveTextContent('Enter a first and second name');
        expect(previews).toHaveLength(0);
    });

    it('owns the kill switch: capability off shows the unavailable note and no search fields', () => {
        renderForever(false);
        expect(screen.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeInTheDocument();
        expect(screen.queryByTestId('forever-identity-fields')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /search armory/i })).not.toBeInTheDocument();
    });
});
