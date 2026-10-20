/** Pure helpers for the Valheim Link token control (ROK-1833). */
import { AdminFetchError } from '../../../hooks/admin/admin-fetch';

const STATUS_COPY: Record<number, string> = {
    400: 'This server is not mapped to Valheim, so it cannot have a mod token.',
    404: 'This server (or its token) no longer exists. Refresh the list.',
    409: 'This server already has an active token — rotate it instead.',
};

/** The inline banner copy for a failed token call: known statuses get plain words, the rest the server message. */
export function tokenErrorMessage(err: unknown): string {
    if (err instanceof AdminFetchError) return STATUS_COPY[err.status] ?? err.message;
    return err instanceof Error ? err.message : 'Something went wrong';
}

export const TOKEN_PLACEHOLDER = '<paste the token here>';

/** The mod's full operations runbook (opened in a new tab from the setup notes). */
export const VALHEIM_LINK_RUNBOOK_URL = 'https://github.com/Raid-Ledger-Plugins/rl-valheim-link/blob/main/docs/operations.md';

/**
 * The `[RaidLedger]` section of `RaidLedger.ValheimLink.cfg` and the ingest endpoints, for this origin and server.
 * `token` fills `ServerToken`; without it the line carries {@link TOKEN_PLACEHOLDER}.
 */
export function modConfigLines(origin: string, serverId: string, token?: string): { config: string[]; endpoints: string[] } {
    const base = origin.replace(/\/+$/, '');
    return {
        config: ['[RaidLedger]', `BaseUrl = ${base}`, `ServerId = ${serverId}`, `ServerToken = ${token ?? TOKEN_PLACEHOLDER}`],
        endpoints: [
            `POST ${base}/api/plugins/valheim/link/messages/{kind}`,
            `PUT ${base}/api/plugins/valheim/link/blobs/{sha256}`,
        ],
    };
}
