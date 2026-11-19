/** ROK-2263 — MSW routes for Admin → Backups clone access tokens (`/admin/backup-export-tokens`). */
import { http, HttpResponse } from 'msw';
import {
    MintBackupExportTokenRequestSchema,
    type BackupExportToken,
    type MintBackupExportTokenRequest,
} from '@raid-ledger/contract';

export const BACKUP_EXPORT_TOKENS_URL = 'http://localhost:3000/admin/backup-export-tokens';

/** A syntactically valid fake token (`rlbx_` + 43 base64url chars); never a real secret. */
export const FAKE_BACKUP_EXPORT_TOKEN = `rlbx_${'T'.repeat(39)}wxyz`;

/** One list row; live by default (not revoked, expires in the future). */
export function buildBackupExportToken(over: Partial<BackupExportToken> = {}): BackupExportToken {
    return {
        id: 1, label: 'Laptop clone script', tokenHint: 'ab12', createdBy: { id: 1, username: 'admin' },
        createdAt: '2026-11-01T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
        lastUsedAt: null, revokedAt: null, ...over,
    };
}

/** `GET` serves the given rows (`[]` = none yet). */
export function backupExportTokensListHandler(rows: BackupExportToken[]) {
    return http.get(BACKUP_EXPORT_TOKENS_URL, () => HttpResponse.json({ tokens: rows }));
}

export function backupExportTokensListErrorHandler() {
    return http.get(BACKUP_EXPORT_TOKENS_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 }));
}

/** `POST` mints `FAKE_BACKUP_EXPORT_TOKEN`; each request body is pushed onto `seen`. */
export function backupExportTokenMintHandler(seen: MintBackupExportTokenRequest[] = []) {
    return http.post(BACKUP_EXPORT_TOKENS_URL, async ({ request }) => {
        const body = MintBackupExportTokenRequestSchema.parse(await request.json());
        seen.push(body);
        const item = buildBackupExportToken({ id: 99, label: body.label, tokenHint: 'wxyz' });
        return HttpResponse.json({ token: FAKE_BACKUP_EXPORT_TOKEN, item }, { status: 201 });
    });
}

/** `POST` refused at the live cap (409 `backup_export_token_cap`). */
export function backupExportTokenMintCapHandler() {
    return http.post(BACKUP_EXPORT_TOKENS_URL, () =>
        HttpResponse.json({ code: 'backup_export_token_cap', message: 'Revoke one first' }, { status: 409 }));
}

/** `DELETE /:id` → 204; each revoked id is pushed onto `seen`. */
export function backupExportTokenRevokeHandler(seen: number[] = []) {
    return http.delete(`${BACKUP_EXPORT_TOKENS_URL}/:id`, ({ params }) => {
        seen.push(Number(params.id));
        return new HttpResponse(null, { status: 204 });
    });
}
