import { describe, it, expect } from 'vitest';
import type { BackupFileDto, BackupListResponseDto } from '@raid-ledger/contract';
import { ARCHIVING_POLL_MS, anyArchiving, backupErrorMessage, backupsRefetchInterval } from './backup-archive-poll';

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

describe('anyArchiving', () => {
    it('is true while any dump is archiving, false once none are', () => {
        expect(anyArchiving([dump('a.dump', { state: 'ready', sizeBytes: 1 }), dump('b.dump', { state: 'archiving' })])).toBe(true);
        expect(anyArchiving([dump('a.dump', { state: 'failed', error: 'x' }), dump('b.dump')])).toBe(false);
    });
});

describe('backupErrorMessage', () => {
    const fallback = 'Failed to create backup';
    it('a 409 surfaces the server message (archive still running)', async () => {
        const res = new Response(JSON.stringify({ statusCode: 409, message: 'An uploads archive is still running — try again when it finishes' }), { status: 409 });
        expect(await backupErrorMessage(res, fallback)).toBe('An uploads archive is still running — try again when it finishes');
    });
    it('any other failure keeps the generic message', async () => {
        const res = new Response(JSON.stringify({ message: 'internal detail' }), { status: 500 });
        expect(await backupErrorMessage(res, fallback)).toBe(fallback);
    });
    it('a 409 with an unparseable body keeps the generic message', async () => {
        expect(await backupErrorMessage(new Response('<html>', { status: 409 }), fallback)).toBe(fallback);
    });
});
