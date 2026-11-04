import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { UploadsArchiveStatus } from './backup-uploads-archive';
import { createdBackupMessage } from './backup-panel-utils';

const BACKUP: BackupFileDto = {
    filename: 'raid-ledger-2026-11-04.dump', type: 'daily', sizeBytes: 2048, createdAt: '2026-11-04T00:00:00.000Z',
};
/** Tokens only: a raw Tailwind hue would be wrong in fourteen of the fifteen themes. */
const RAW_HUE = /\b(?:bg|text|border)-(?:red|amber|yellow|green|emerald|slate|gray|blue)-\d/;

describe('UploadsArchiveStatus', () => {
    it('archiving: a neutral live-status chip reading "Archiving uploads…"', () => {
        const { container } = render(<UploadsArchiveStatus archive={{ state: 'archiving' }} />);
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Archiving uploads…');
        expect(status.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
        expect(container.innerHTML).not.toMatch(RAW_HUE);
    });

    it('ready: a success chip with the archive size from the shared formatter', () => {
        const { container } = render(<UploadsArchiveStatus archive={{ state: 'ready', sizeBytes: 3 * 1024 * 1024 }} />);
        const chip = screen.getByText('Uploads 3.00 MB');
        expect(chip).toHaveAttribute('data-tone', 'success');
        expect(container.innerHTML).not.toMatch(RAW_HUE);
    });

    it('ready without a size still says the uploads are archived', () => {
        render(<UploadsArchiveStatus archive={{ state: 'ready' }} />);
        expect(screen.getByText('Uploads archived')).toHaveAttribute('data-tone', 'success');
    });

    it('failed: a warning line carrying the server error', () => {
        const error = 'uploads archive failed (tar-failed: exit 2)';
        const { container } = render(<UploadsArchiveStatus archive={{ state: 'failed', error }} />);
        const line = screen.getByText('Uploads archive failed', { exact: false });
        expect(line).toHaveClass('text-warning');
        expect(line).toHaveAttribute('title', error);
        expect(screen.getByText(error)).toHaveClass('text-muted');
        expect(container.innerHTML).not.toMatch(RAW_HUE);
    });

    it('absent: renders nothing extra', () => {
        const { container } = render(<UploadsArchiveStatus archive={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('createdBackupMessage', () => {
    it('does not claim the uploads are archived while the archive still runs', () => {
        const backup: BackupFileDto = { ...BACKUP, uploadsArchive: { state: 'archiving' } };
        expect(createdBackupMessage({ message: `Backup created: ${BACKUP.filename}`, backup }))
            .toBe('Backup created — archiving uploads in the background');
    });

    it('keeps the server message when there is no running archive', () => {
        expect(createdBackupMessage({ message: `Backup created: ${BACKUP.filename}`, backup: BACKUP }))
            .toBe(`Backup created: ${BACKUP.filename}`);
    });
});
