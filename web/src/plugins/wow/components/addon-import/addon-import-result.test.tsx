import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test/render-helpers';
import { AddonImportResult, AddonImportResultActions } from './addon-import-result';
import { charResult } from './addon-import.test-fixtures';

describe('AddonImportResult', () => {
    it('shows the success banner and the summary', () => {
        renderWithProviders(<AddonImportResult result={charResult({ status: 'applied' })} />);
        expect(screen.getByRole('status')).toHaveTextContent('Character data imported.');
        expect(screen.getByText('31 nodes')).toBeInTheDocument();
    });

    it('says when a re-paste changed nothing', () => {
        renderWithProviders(<AddonImportResult result={charResult({ status: 'noop' })} />);
        expect(screen.getByRole('status')).toHaveTextContent('already up to date');
    });

    it('wires Done and Import another', async () => {
        const onDone = vi.fn();
        const onImportAnother = vi.fn();
        renderWithProviders(<AddonImportResultActions onDone={onDone} onImportAnother={onImportAnother} />);
        await userEvent.click(screen.getByRole('button', { name: 'Import another' }));
        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onImportAnother).toHaveBeenCalledOnce();
        expect(onDone).toHaveBeenCalledOnce();
    });
});
