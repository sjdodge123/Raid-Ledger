import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { BackupRowActions, DELETE_WAIT_HINT } from './backup-row-actions';

const BACKUP: BackupFileDto = {
    filename: 'raid_ledger_2026-11-05_020010.dump', type: 'daily', sizeBytes: 2048, createdAt: '2026-11-05T02:00:10.000Z',
};
const RAW_HUE = /\b(?:bg|text|border)-(?:red|amber|yellow|green|emerald|slate|gray|blue)-\d/;

function renderActions(backup: BackupFileDto): ReturnType<typeof render> {
    return render(<table><tbody><tr><td><BackupRowActions backup={backup} onRestore={vi.fn()} onDelete={vi.fn()} /></td></tr></tbody></table>);
}

describe('BackupRowActions — Delete while the uploads archive runs (#1949 NIT 21)', () => {
    it('disabled Delete names its reason in a visible hint it is described by, and in its title', () => {
        const { container } = renderActions({ ...BACKUP, uploadsArchive: { state: 'archiving' } });
        const del = screen.getByRole('button', { name: 'Delete' });
        expect(del).toBeDisabled();
        expect(del).toHaveAccessibleDescription(DELETE_WAIT_HINT);
        expect(del).toHaveAttribute('title', DELETE_WAIT_HINT);
        expect(screen.getByText(DELETE_WAIT_HINT)).toBeVisible();
        expect(container.innerHTML).not.toMatch(RAW_HUE);
    });

    it('once the archive is ready Delete is enabled with no hint', () => {
        renderActions({ ...BACKUP, uploadsArchive: { state: 'ready', sizeBytes: 10 } });
        const del = screen.getByRole('button', { name: 'Delete' });
        expect(del).toBeEnabled();
        expect(del).not.toHaveAttribute('aria-describedby');
        expect(screen.queryByText(DELETE_WAIT_HINT)).toBeNull();
    });
});
