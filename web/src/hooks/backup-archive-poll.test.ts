import { describe, it, expect } from 'vitest';
import type { BackupFileDto, BackupListResponseDto } from '@raid-ledger/contract';
import { ARCHIVING_POLL_MS, backupsRefetchInterval } from './backup-archive-poll';

function dump(filename: string, uploadsArchive?: BackupFileDto['uploadsArchive']): BackupFileDto {
    const base: BackupFileDto = { filename, type: 'daily', sizeBytes: 2048, createdAt: '2026-11-04T00:00:00.000Z' };
    return uploadsArchive ? { ...base, uploadsArchive } : base;
}

function list(...backups: BackupFileDto[]): BackupListResponseDto {
    return { backups, total: backups.length };
}

describe('backupsRefetchInterval', () => {
    it('polls every 5 s while any dump is still archiving its uploads', () => {
        const data = list(dump('a.dump', { state: 'ready', sizeBytes: 10 }), dump('b.dump', { state: 'archiving' }));
        expect(backupsRefetchInterval(data)).toBe(ARCHIVING_POLL_MS);
        expect(ARCHIVING_POLL_MS).toBe(5_000);
    });

    it('stops once no dump is archiving (ready, failed, or no archive)', () => {
        const data = list(
            dump('a.dump', { state: 'ready', sizeBytes: 10 }),
            dump('b.dump', { state: 'failed', error: 'uploads archive failed (tar-failed: exit 2)' }),
            dump('c.dump'),
        );
        expect(backupsRefetchInterval(data)).toBe(false);
    });

    it('does not poll before the first response or for an empty list', () => {
        expect(backupsRefetchInterval(undefined)).toBe(false);
        expect(backupsRefetchInterval(list())).toBe(false);
    });
});
