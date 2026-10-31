import { API_BASE_URL } from '../../../lib/config';

/** The Discord sign-in callback, from the address Raid Ledger was opened at (ROK-1703 D-6). */
export function buildCallbackUrl(): string {
    const apiPath = API_BASE_URL.startsWith('/') ? API_BASE_URL : '';
    if (apiPath) return `${window.location.origin}${apiPath}/auth/discord/callback`;
    return `${API_BASE_URL}/auth/discord/callback`;
}

/** The account-linking callback that sits next to the sign-in one. */
export function buildLinkCallbackUrl(callbackUrl: string = buildCallbackUrl()): string {
    return callbackUrl.replace('/callback', '/link/callback');
}
