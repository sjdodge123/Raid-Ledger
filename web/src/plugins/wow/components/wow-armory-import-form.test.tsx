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
import { renderWithProviders } from '../../../test/render-helpers';
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
