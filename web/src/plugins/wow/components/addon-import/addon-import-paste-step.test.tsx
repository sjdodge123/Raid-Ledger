import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ADDON_IMPORT_MAX_BYTES } from '@raid-ledger/contract';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { AddonImportPasteActions, AddonImportPasteStep } from './addon-import-paste-step';
import { useAddonImportPreview } from './use-addon-import';
import { CHARACTER_ID, CHAR_STRING, IMPORT_URL, charResult } from './addon-import.test-fixtures';

/** The paste step wired to the real preview mutation, as the dialog wires it. */
function Harness() {
    const [value, setValue] = useState('');
    const preview = useAddonImportPreview(CHARACTER_ID);
    const check = (importString: string) => preview.mutate({ importString });
    return (
        <>
            <AddonImportPasteStep value={value} onChange={setValue} onCheck={check} error={preview.error} gameId={7} />
            <AddonImportPasteActions value={value} onCheck={check} onCancel={() => {}} checking={preview.isPending} />
            {preview.data && <p>previewed {preview.data.section}</p>}
        </>
    );
}

function AddCharacterProbe() {
    const state = useLocation().state as { addCharacter?: { name: string; gameId: number } } | null;
    return <p>prefill {state?.addCharacter?.name} game {state?.addCharacter?.gameId}</p>;
}

function renderHarness() {
    return renderWithProviders(
        <Routes>
            <Route path="/" element={<Harness />} />
            <Route path="/profile/gaming/characters" element={<AddCharacterProbe />} />
        </Routes>,
    );
}

function countRequests(status = 200, reply: unknown = charResult()) {
    const bodies: unknown[] = [];
    server.use(http.post(IMPORT_URL, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(reply, { status });
    }));
    return bodies;
}

const textbox = () => screen.getByRole('textbox', { name: 'Export string' });

describe('AddonImportPasteStep', () => {
    it('previews (dryRun:true) as soon as a string is pasted', async () => {
        const bodies = countRequests();
        renderHarness();
        await userEvent.click(textbox());
        await userEvent.paste(CHAR_STRING);
        expect(await screen.findByText('previewed char')).toBeInTheDocument();
        expect(bodies).toEqual([{ importString: CHAR_STRING, dryRun: true }]);
        expect(screen.getByTestId('addon-import-header')).toHaveTextContent('Character · RL1');
        expect(screen.getByTestId('addon-import-size')).toHaveTextContent('0 KB of 256 KB');
    });

    it('does not check while typing, only on "Check string"', async () => {
        const bodies = countRequests();
        renderHarness();
        await userEvent.type(textbox(), '!RL1!char!QUJD');
        expect(bodies).toHaveLength(0);
        await userEvent.click(screen.getByRole('button', { name: 'Check string' }));
        await waitFor(() => expect(bodies).toEqual([{ importString: '!RL1!char!QUJD', dryRun: true }]));
    });

    it('shows the inline size error over 256 KB and sends nothing', async () => {
        const bodies = countRequests();
        renderHarness();
        await userEvent.click(textbox());
        await userEvent.paste(`!RL1!char!${'A'.repeat(ADDON_IMPORT_MAX_BYTES)}`);
        expect(await screen.findByText(/over the 256 KB limit/)).toBeInTheDocument();
        expect(textbox()).toHaveAttribute('aria-invalid', 'true');
        const check = screen.getByRole('button', { name: 'Check string' });
        expect(check).toBeDisabled();
        await userEvent.click(check);
        expect(bodies).toEqual([]);
    });

    it('renders the error copy for a failed preview', async () => {
        countRequests(422, { code: 'CUT_OFF', message: 'server text' });
        renderHarness();
        await userEvent.click(textbox());
        await userEvent.paste(CHAR_STRING);
        const banner = await screen.findByTestId('addon-import-error');
        expect(banner).toHaveTextContent('String looks cut off');
        expect(banner).not.toHaveTextContent('server text');
    });

    it('links a name mismatch to Add Character with the prefill in router state', async () => {
        const addCharacter = { firstName: 'Ana', secondName: 'Forever', region: 'us', ruleset: 'pvp', class: 'Paladin' };
        countRequests(422, { code: 'NAME_MISMATCH', message: 'x', addCharacter });
        renderHarness();
        await userEvent.click(textbox());
        await userEvent.paste(CHAR_STRING);
        await userEvent.click(await screen.findByRole('link', { name: 'Add this character' }));
        expect(await screen.findByText('prefill Ana Forever game 7')).toBeInTheDocument();
    });
});
