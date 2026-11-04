import type { BackupListResponseDto } from '@raid-ledger/contract';

/** How often the backups list refetches while an uploads archive is still being written. */
export const ARCHIVING_POLL_MS = 5_000;

/**
 * TanStack `refetchInterval` for the admin backups list: poll every 5 s while
 * any daily dump's uploads archive is `archiving` (the manual Create backup
 * returns before the archive finishes), stop once none are.
 */
export function backupsRefetchInterval(data: BackupListResponseDto | undefined): number | false {
    const archiving = data?.backups.some((b) => b.uploadsArchive?.state === 'archiving') ?? false;
    return archiving ? ARCHIVING_POLL_MS : false;
}
