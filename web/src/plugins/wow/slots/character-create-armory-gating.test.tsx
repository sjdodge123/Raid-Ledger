/**
 * ROK-1636: Blizzard has no WoW Forever profile API yet, so both Armory entry
 * points must disable "Import from Armory" for wow_forever and keep Manual.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { CharacterCreateImportForm } from './character-create-import-form';
import { CharacterCreateInlineImport } from './character-create-inline-import';
import { ARMORY_UNAVAILABLE_NOTE } from '../lib/armory-import';

const API_BASE = 'http://localhost:3000';
const FOREVER = 'world-of-warcraft-forever';

function blizzardConfigured() {
    server.use(http.get(`${API_BASE}/system/status`, () => HttpResponse.json({ status: 'ok', blizzardConfigured: true })));
}

function Harness({ gameSlug, initial }: { gameSlug: string; initial: 'manual' | 'import' }) {
    const [tab, setTab] = useState(initial);
    return (
        <>
            <CharacterCreateImportForm onClose={() => {}} gameSlug={gameSlug} activeTab={tab} onTabChange={setTab} />
            <span data-testid="active-tab">{tab}</span>
        </>
    );
}

const importTab = () => screen.getByRole('button', { name: /import from armory/i });

describe('CharacterCreateImportForm — Armory gating (ROK-1636)', () => {
    it('disables the Armory tab for WoW Forever, shows the note, and falls back to Manual', async () => {
        blizzardConfigured();
        renderWithProviders(<Harness gameSlug={FOREVER} initial="import" />);
        await waitFor(() => expect(screen.getByTestId('active-tab').textContent).toBe('manual'));
        expect(importTab().getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeInTheDocument();
        expect(importTab().getAttribute('aria-describedby')).toBe(screen.getByText(ARMORY_UNAVAILABLE_NOTE).id);
        fireEvent.click(importTab());
        expect(screen.getByTestId('active-tab').textContent).toBe('manual');
    });

    it('keeps the Armory tab for Classic Anniversary without Forever in its Game Version picker', async () => {
        blizzardConfigured();
        renderWithProviders(<Harness gameSlug="world-of-warcraft-classic" initial="manual" />);
        await waitFor(() => expect(screen.getByTestId('active-tab').textContent).toBe('import'));
        expect(importTab().getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
        const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.value);
        expect(options).toEqual(['classic_anniversary', 'classic_era', 'classic']);
    });
});

describe('CharacterCreateInlineImport — Armory gating (ROK-1636)', () => {
    it('disables the Armory tab for WoW Forever and reports Manual mode', async () => {
        const onModeChange = vi.fn();
        renderWithProviders(<CharacterCreateInlineImport gameSlug={FOREVER} onModeChange={onModeChange} />);
        await waitFor(() => expect(onModeChange).toHaveBeenLastCalledWith('manual'));
        expect(importTab().getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /search armory/i })).not.toBeInTheDocument();
    });

    it('keeps the Armory import for Classic Anniversary', async () => {
        const onModeChange = vi.fn();
        renderWithProviders(<CharacterCreateInlineImport gameSlug="world-of-warcraft-burning-crusade-classic-anniversary-edition" onModeChange={onModeChange} />);
        await waitFor(() => expect(onModeChange).toHaveBeenLastCalledWith('import'));
        expect(importTab().getAttribute('aria-disabled')).not.toBe('true');
        expect(screen.getByRole('button', { name: /search armory/i })).toBeInTheDocument();
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
    });
});
