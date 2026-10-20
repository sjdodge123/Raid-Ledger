import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AddonImportResultDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { AddonImportPreview, AddonImportPreviewActions } from './addon-import-preview';
import { AddonImportRequestError, type AddonImportConfirm } from './use-addon-import';
import { charResult } from './addon-import.test-fixtures';

/** Preview + its footer sharing one confirm state, as the dialog wires them. */
function Harness({ result, onImport, error }: { result: AddonImportResultDto; onImport: (c: AddonImportConfirm) => void; error?: unknown }) {
    const [confirm, setConfirm] = useState<AddonImportConfirm>({});
    return (
        <>
            <AddonImportPreview result={result} confirm={confirm} onConfirmChange={setConfirm} error={error} />
            <AddonImportPreviewActions result={result} confirm={confirm} onBack={() => {}} onImport={() => onImport(confirm)} importing={false} />
        </>
    );
}

const importButton = () => screen.getByRole('button', { name: 'Import' });

describe('AddonImportPreview', () => {
    it('shows the summary, class/level diff and provenance', () => {
        renderWithProviders(<Harness result={charResult({ diff: { level: { from: 58, to: 60 } } })} onImport={vi.fn()} />);
        expect(screen.getByText('17 items · avg ilvl 61')).toBeInTheDocument();
        expect(screen.getByText('58 → 60')).toBeInTheDocument();
        expect(screen.getByTestId('addon-import-provenance')).toHaveTextContent('via addon · self-reported · 4 Oct 2026');
        expect(importButton()).toBeEnabled();
    });

    it('keeps Import disabled until the GUID confirmation is ticked', async () => {
        const onImport = vi.fn();
        renderWithProviders(<Harness result={charResult({ warnings: [{ code: 'GUID_CHANGED' }] })} onImport={onImport} />);
        expect(importButton()).toBeDisabled();
        await userEvent.click(importButton());
        expect(onImport).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('checkbox', { name: /different in-game character — link it instead/ }));
        expect(importButton()).toBeEnabled();
        await userEvent.click(importButton());
        expect(onImport).toHaveBeenCalledWith({ repinGuid: true });
    });

    it('maps the ruleset checkbox to confirm.updateRuleset without gating Import', async () => {
        const onImport = vi.fn();
        renderWithProviders(<Harness result={charResult({ warnings: [{ code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' }] })} onImport={onImport} />);
        const box = screen.getByRole('checkbox', { name: 'Update ruleset to PvP' });
        expect(box).not.toBeChecked();
        expect(screen.getByTestId('addon-import-warning')).toHaveTextContent('on a PvP realm, not Normal');
        await userEvent.click(box);
        await userEvent.click(importButton());
        expect(onImport).toHaveBeenCalledWith({ updateRuleset: true, updateRulesetTo: 'pvp' });
    });

    it('says a noop preview has nothing new and disables Import', () => {
        renderWithProviders(<Harness result={charResult({ status: 'noop' })} onImport={vi.fn()} />);
        expect(screen.getByTestId('addon-import-status-note')).toHaveTextContent('Already imported');
        expect(importButton()).toBeDisabled();
    });

    it('shows an apply error as a danger banner', () => {
        const error = new AddonImportRequestError(429, 'RATE_LIMITED', 'x');
        renderWithProviders(<Harness result={charResult()} onImport={vi.fn()} error={error} />);
        expect(screen.getByTestId('addon-import-error')).toHaveTextContent('Too many imports');
    });
});

describe('AddonImportPreview — realm-inferred RULESET_CHANGED (ROK-1739 §6.2)', () => {
    const warning = { code: 'RULESET_CHANGED', from: 'normal', to: 'pvp' } as const;

    it('names the realm and says the value was inferred from the admin realm list, keeping the opt-in checkbox', async () => {
        const onImport = vi.fn();
        const result = charResult({ warnings: [warning], rulesetInference: { ruleset: 'pvp', realmName: 'Bloodmoon', source: 'realm-map' } });
        renderWithProviders(<Harness result={result} onImport={onImport} />);
        const banner = screen.getByTestId('addon-import-warning');
        expect(banner).toHaveTextContent('Realm "Bloodmoon" is listed as PvP — this character is Normal here.');
        expect(banner).not.toHaveTextContent('The export says');
        expect(screen.getByTestId('addon-import-inference-source')).toHaveTextContent(
            'Inferred from the realm list your admin maintains — not from the export.',
        );
        await userEvent.click(screen.getByRole('checkbox', { name: 'Update ruleset to PvP' }));
        await userEvent.click(importButton());
        expect(onImport).toHaveBeenCalledWith({ updateRuleset: true, updateRulesetTo: 'pvp' });
    });

    it("credits Blizzard's realm data for a blizzard-sourced inference", () => {
        const result = charResult({ warnings: [warning], rulesetInference: { ruleset: 'pvp', realmName: 'Bloodmoon', source: 'blizzard' } });
        renderWithProviders(<Harness result={result} onImport={vi.fn()} />);
        expect(screen.getByTestId('addon-import-inference-source')).toHaveTextContent("Inferred from Blizzard's realm data.");
    });

    it('keeps the export copy and shows no source line without an inference', () => {
        renderWithProviders(<Harness result={charResult({ warnings: [warning] })} onImport={vi.fn()} />);
        expect(screen.getByTestId('addon-import-warning')).toHaveTextContent('The export says this character is on a PvP realm, not Normal.');
        expect(screen.queryByTestId('addon-import-inference-source')).toBeNull();
    });
});

describe('AddonImportPreviewActions while importing (Codex P2)', () => {
    it('disables Back so a late apply response cannot land on a step the user left', () => {
        const confirm: AddonImportConfirm = {};
        renderWithProviders(
            <AddonImportPreviewActions result={charResult()} confirm={confirm} onBack={vi.fn()} onImport={vi.fn()} importing />,
        );
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });
});
