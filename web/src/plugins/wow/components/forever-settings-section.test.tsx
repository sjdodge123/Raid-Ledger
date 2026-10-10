/**
 * ROK-1717: the admin WoW Forever section in the Blizzard integration card —
 * namespace prefix (validated client-side) + the Armory-import switch.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import { ForeverSettingsSection } from './forever-settings-section';

const URL = 'http://localhost:3000/admin/plugins/blizzard/forever';
const DEFAULT_CONFIG = { namespacePrefix: 'classicforever', namespacePrefixIsDefault: true, armoryImportEnabled: false };

let puts: unknown[] = [];

beforeEach(() => {
    puts = [];
    server.use(
        http.get(URL, () => HttpResponse.json(DEFAULT_CONFIG)),
        http.get(`${URL}-probe`, () => HttpResponse.json({ result: null, extraCandidates: [], characterPath: null })),
        http.put(URL, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            puts.push(body);
            return HttpResponse.json({ ...DEFAULT_CONFIG, ...body, namespacePrefixIsDefault: false });
        }),
    );
});

const prefixInput = () => screen.findByRole('textbox', { name: /namespace prefix/i });

describe('ForeverSettingsSection (ROK-1717)', () => {
    it('saves the typed prefix with the current Armory flag', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const input = await prefixInput();
        expect(input).toHaveValue('classicforever');
        await user.clear(input);
        await user.type(input, 'classicfv2');
        await user.click(screen.getByRole('button', { name: /save forever settings/i }));
        await waitFor(() => expect(puts).toEqual([{ namespacePrefix: 'classicfv2', armoryImportEnabled: false }]));
    });

    it('blocks an invalid prefix with an inline error and sends nothing', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const input = await prefixInput();
        await user.clear(input);
        await user.type(input, 'profile-Forever-us');
        await user.click(screen.getByRole('button', { name: /save forever settings/i }));
        expect(await screen.findByText(/lowercase letters and digits only/i)).toBeInTheDocument();
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(puts).toEqual([]);
    });

    it('the Armory switch applies immediately with the saved prefix and refreshes the capabilities', async () => {
        const user = userEvent.setup();
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['blizzard', 'capabilities'], { armoryImport: { wow_forever: false } });
        renderWithProviders(<ForeverSettingsSection />, { queryClient });
        const toggle = await screen.findByRole('switch', { name: /armory import for wow forever/i });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await user.click(toggle);
        await waitFor(() => expect(puts).toEqual([{ namespacePrefix: 'classicforever', armoryImportEnabled: true }]));
        await waitFor(() => expect(queryClient.getQueryState(['blizzard', 'capabilities'])?.isInvalidated).toBe(true));
    });
});

describe('ForeverSettingsSection probe panel (ROK-1716)', () => {
    it('renders the namespace probe panel inside the section', async () => {
        renderWithProviders(<ForeverSettingsSection />);
        expect(await screen.findByRole('heading', { name: /namespace probe/i })).toBeInTheDocument();
    });
});

/** ROK-1727: the Wowhead item resolver kill switch (unset ⇒ ON, D2). */
describe('ForeverSettingsSection — Wowhead item lookup switch (ROK-1727)', () => {
    it('reads unset as ON and turning it off PUTs wowheadResolverEnabled false with the other settings', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        const toggle = await screen.findByRole('switch', { name: /wowhead item lookup/i });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        await user.click(toggle);
        await waitFor(() => expect(puts).toEqual([{ namespacePrefix: 'classicforever', armoryImportEnabled: false, wowheadResolverEnabled: false }]));
    });

    it('reads a saved false and keeps it when the Armory switch is flipped', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ ...DEFAULT_CONFIG, wowheadResolverEnabled: false })));
        const user = userEvent.setup();
        renderWithProviders(<ForeverSettingsSection />);
        expect(await screen.findByRole('switch', { name: /wowhead item lookup/i })).toHaveAttribute('aria-checked', 'false');
        await user.click(screen.getByRole('switch', { name: /armory import for wow forever/i }));
        await waitFor(() => expect(puts).toEqual([{ namespacePrefix: 'classicforever', armoryImportEnabled: true, wowheadResolverEnabled: false }]));
    });
});
