import type { JSX } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { StatusChip } from '../../components/ui/status-chip';
import { formatSize } from './backup-panel-utils';

type UploadsArchive = NonNullable<BackupFileDto['uploadsArchive']>;

/** Uploads-archive state under a daily dump's filename; renders nothing when the dump has no archive. */
export function UploadsArchiveStatus({ archive }: { archive: UploadsArchive | undefined }): JSX.Element | null {
    if (!archive) return null;
    if (archive.state === 'archiving') return <ArchivingChip />;
    if (archive.state === 'ready') return <ReadyChip sizeBytes={archive.sizeBytes} />;
    return <FailedLine error={archive.error} />;
}

function ArchivingChip(): JSX.Element {
    return (
        <span role="status" className="block mt-1">
            <StatusChip tone="neutral" title="The uploads archive is still being written">
                <span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                Archiving uploads…
            </StatusChip>
        </span>
    );
}

function ReadyChip({ sizeBytes }: { sizeBytes: number | undefined }): JSX.Element {
    const label = sizeBytes === undefined ? 'Uploads archived' : `Uploads ${formatSize(sizeBytes)}`;
    return (
        <span className="block mt-1">
            <StatusChip tone="success" title="Uploads archive ready">{label}</StatusChip>
        </span>
    );
}

function FailedLine({ error }: { error: string | undefined }): JSX.Element {
    return (
        <span className="block mt-1 font-sans text-xs text-warning whitespace-normal" title={error}>
            Uploads archive failed{error ? <span className="block text-muted">{error}</span> : null}
        </span>
    );
}
