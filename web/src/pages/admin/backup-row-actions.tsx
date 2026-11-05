import type { JSX } from 'react';
import { useId } from 'react';
import type { BackupFileDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';

/** Why Delete is disabled while the dump's uploads archive is still being written. */
export const DELETE_WAIT_HINT = 'Wait for the uploads archive to finish.';

/**
 * Restore + Delete for one backup row. While its uploads archive runs, Delete is
 * disabled and says why: a visible hint line joined by `aria-describedby` (the
 * Create button's idiom on this page) plus a `title` for hover.
 */
export function BackupRowActions({ backup, onRestore, onDelete }: {
    backup: BackupFileDto; onRestore: (b: BackupFileDto) => void; onDelete: (b: BackupFileDto) => void;
}): JSX.Element {
    const hintId = useId();
    const archiving = backup.uploadsArchive?.state === 'archiving';
    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="warning-soft" onClick={() => onRestore(backup)}>Restore</Button>
                <Button size="sm" variant="destructive-soft" disabled={archiving} onClick={() => onDelete(backup)}
                    title={archiving ? DELETE_WAIT_HINT : undefined} aria-describedby={archiving ? hintId : undefined}>Delete</Button>
            </div>
            {archiving && <p id={hintId} className="text-xs text-muted text-right whitespace-normal">{DELETE_WAIT_HINT}</p>}
        </div>
    );
}
