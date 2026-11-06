import type { BackupFileDto, BackupListResponseDto } from '@raid-ledger/contract';

/** How often the backups list refetches while an uploads archive is still being written. */
export const ARCHIVING_POLL_MS = 5_000;

/**
 * TanStack `refetchInterval` for the admin backups list: poll every 5 s while
 * any daily dump's uploads archive is `archiving` (the manual Create backup
 * returns before the archive finishes), stop once none are.
 */
export function backupsRefetchInterval(data: BackupListResponseDto | undefined): number | false {
    return anyArchiving(data?.backups ?? []) ? ARCHIVING_POLL_MS : false;
}

/** True while any listed dump's uploads archive is still being written (archives run one at a time). */
export function anyArchiving(backups: readonly BackupFileDto[]): boolean {
    return backups.some((b) => b.uploadsArchive?.state === 'archiving');
}

/**
 * Error text for a failed backups request: a 409 carries the server's own
 * "archive still running" copy (Create / Delete while archiving); anything
 * else keeps the generic `fallback`.
 */
export async function backupErrorMessage(response: Response, fallback: string): Promise<string> {
    if (response.status !== 409) return fallback;
    try {
        const body: unknown = await response.json();
        if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') return body.message;
    } catch {
        // Unparseable body: the generic message is still right.
    }
    return fallback;
}
