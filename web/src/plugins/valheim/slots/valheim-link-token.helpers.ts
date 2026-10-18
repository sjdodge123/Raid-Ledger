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

/** The BepInEx config lines and endpoints the dialog shows, for this origin and server. */
export function modConfigLines(origin: string, serverId: string): { config: string[]; endpoints: string[] } {
    return {
        config: [
            `RaidLedger.BaseUrl = ${origin}`,
            `RaidLedger.ServerId = ${serverId}`,
            'RaidLedger.ServerToken = (the token above)',
        ],
        endpoints: [
            `POST ${origin}/api/plugins/valheim/link/messages/{kind}`,
            `PUT ${origin}/api/plugins/valheim/link/blobs/{sha256}`,
        ],
    };
}
