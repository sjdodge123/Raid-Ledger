import { LinkStartResponseSchema } from '@raid-ledger/contract';
import { API_BASE_URL } from '../config';
import { fetchWithAuth } from './fetch-api';

export type LinkProvider = 'discord' | 'steam';

/** POST /auth/{provider}/link/start did not hand back a usable nonce. */
export class LinkStartError extends Error {
    readonly status: number;
    constructor(status: number) {
        super(`Link start failed (HTTP ${status})`);
        Object.setPrototypeOf(this, LinkStartError.prototype);
        this.name = 'LinkStartError';
        this.status = status;
    }
}

/**
 * ROK-1630: mint a single-use, provider-bound nonce and return the GET hop URL
 * it unlocks. Authenticates ONLY through the Bearer header (`fetchWithAuth`,
 * which also refreshes once on a 401), so the session JWT never rides in a
 * URL. `returnTo` is Steam-only and allowlisted server-side.
 */
export async function startAccountLink(provider: LinkProvider, returnTo?: string): Promise<string> {
    const body = returnTo ? { returnTo } : {};
    const response = await fetchWithAuth(`/auth/${provider}/link/start`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new LinkStartError(response.status);
    const parsed = LinkStartResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new LinkStartError(response.status);
    return `${API_BASE_URL}/auth/${provider}/link?nonce=${encodeURIComponent(parsed.data.nonce)}`;
}
