/**
 * ROK-1636: Blizzard has no WoW Forever profile API yet, so both Armory entry
 * points must disable "Import from Armory" for wow_forever and keep Manual.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import { CharacterCreateImportForm } from './character-create-import-form';
import { CharacterCreateInlineImport } from './character-create-inline-import';
import { ARMORY_UNAVAILABLE_NOTE } from '../lib/armory-import';

const API_BASE = 'http://localhost:3000';
const FOREVER = 'world-of-warcraft-forever';

function blizzardConfigured() {
    server.use(http.get(`${API_BASE}/system/status`, () => HttpResponse.json({ status: 'ok', blizzardConfigured: true })));
}

/** ROK-1636 review: an event's context variant is its signups' dominant variant, so it can be Forever on the Classic game. */
/** Seeded so the context variant is present on first render — no pre-fetch default can mask the bug. */
function contextVariantClient(eventId: number, gameVariant: string) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['events', eventId, 'variant-context'], { gameVariant, region: 'us' });
    return queryClient;
}

function Harness({ gameSlug, initial, eventId }: { gameSlug: string; initial: 'manual' | 'import'; eventId?: number }) {
    const [tab, setTab] = useState(initial);
    return (
        <>
            <CharacterCreateImportForm onClose={() => {}} gameSlug={gameSlug} activeTab={tab} onTabChange={setTab} eventId={eventId} />
            <span data-testid="active-tab">{tab}</span>
        </>
    );
}

const importTab = () => screen.getByRole('button', { name: /import from armory/i });

describe('CharacterCreateImportForm — Armory gating (ROK-1636)', () => {
    it('disables the Armory tab for WoW Forever, shows the note, and falls back to Manual', async () => {
        const user = userEvent.setup();
        blizzardConfigured();
        renderWithProviders(<Harness gameSlug={FOREVER} initial="import" />);
        await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('manual'));
        expect(importTab()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeInTheDocument();
        expect(importTab()).toHaveAttribute('aria-describedby', screen.getByText(ARMORY_UNAVAILABLE_NOTE).id);
        await user.click(importTab());
        expect(screen.getByTestId('active-tab')).toHaveTextContent('manual');
    });

    it('keeps the Armory tab for Classic Anniversary without Forever in its Game Version picker', async () => {
        blizzardConfigured();
        renderWithProviders(<Harness gameSlug="world-of-warcraft-classic" initial="manual" />);
        await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('import'));
        expect(importTab()).not.toHaveAttribute('aria-disabled');
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
        const options = Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.value);
        expect(options).toEqual(['classic_anniversary', 'classic_era', 'classic']);
    });

    it('keeps the Armory tab and picker on the Classic game when the event context variant is Forever', async () => {
        blizzardConfigured();
        const queryClient = contextVariantClient(41, 'wow_forever');
        renderWithProviders(<Harness gameSlug="world-of-warcraft-classic" initial="manual" eventId={41} />, { queryClient });
        expect(importTab()).not.toHaveAttribute('aria-disabled');
        await waitFor(() => expect(screen.getByTestId('active-tab')).toHaveTextContent('import'));
        expect(screen.getByRole('combobox')).toHaveValue('classic_anniversary');
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
    });
});

describe('CharacterCreateInlineImport — Armory gating (ROK-1636)', () => {
    it('disables the Armory tab for WoW Forever and reports Manual mode', async () => {
        const onModeChange = vi.fn();
        renderWithProviders(<CharacterCreateInlineImport gameSlug={FOREVER} onModeChange={onModeChange} />);
        await waitFor(() => expect(onModeChange).toHaveBeenLastCalledWith('manual'));
        expect(importTab()).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /search armory/i })).not.toBeInTheDocument();
    });

    it('keeps the Armory import for Classic Anniversary', async () => {
        const onModeChange = vi.fn();
        renderWithProviders(<CharacterCreateInlineImport gameSlug="world-of-warcraft-burning-crusade-classic-anniversary-edition" onModeChange={onModeChange} />);
        await waitFor(() => expect(onModeChange).toHaveBeenLastCalledWith('import'));
        expect(importTab()).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('button', { name: /search armory/i })).toBeInTheDocument();
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
    });

    it('keeps the Armory import on the Classic game when the event context variant is Forever', () => {
        const queryClient = contextVariantClient(42, 'wow_forever');
        renderWithProviders(<CharacterCreateInlineImport gameSlug="world-of-warcraft-classic" eventId={42} />, { queryClient });
        expect(importTab()).not.toHaveAttribute('aria-disabled');
        expect(screen.getByRole('combobox')).toHaveValue('classic_anniversary');
        expect(screen.queryByText(ARMORY_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
    });
});
