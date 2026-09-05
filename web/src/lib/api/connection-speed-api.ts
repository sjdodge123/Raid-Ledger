/**
 * Connection speed API client (ROK-1374).
 *
 * The viewer's own downstream figure — private, never returned for another
 * user, never in an embed or a DM (D8/D9).
 */
import type {
    ConnectionSpeedDto,
    SetConnectionSpeedDto,
    SetDownloadEtaSharingDto,
    SetSpeedTestConsentDto,
} from '@raid-ledger/contract';
import { fetchApi } from './fetch-api';

/** Fetch the viewer's stored speed. All-null when they have never measured. */
export async function getConnectionSpeed(): Promise<ConnectionSpeedDto> {
    return fetchApi('/users/me/connection-speed');
}

/** Persist a measured or hand-entered downstream figure. */
export async function setConnectionSpeed(
    body: SetConnectionSpeedDto,
): Promise<ConnectionSpeedDto> {
    return fetchApi('/users/me/connection-speed', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

/** Grant or revoke speed-test consent. Revoking also deletes the figure (E19). */
export async function setSpeedTestConsent(
    body: SetSpeedTestConsentDto,
): Promise<ConnectionSpeedDto> {
    return fetchApi('/users/me/speed-test-consent', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

/**
 * Turn roster ETA sharing on or off. A SEPARATE consent from the speed test:
 * it shares minutes on a lineup readiness card, never the Mbps figure (AC20).
 */
export async function setDownloadEtaSharing(
    body: SetDownloadEtaSharingDto,
): Promise<ConnectionSpeedDto> {
    return fetchApi('/users/me/download-eta-sharing', {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}
