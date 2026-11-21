/**
 * ROK-2283: read the display claims of a `/signin-link` token WITHOUT verifying
 * it. Both link kinds land on the same URL, so the page reads the payload to
 * pick the redeem endpoint and to say who the link signs in. The server is the
 * authority: a forged payload only changes the label and the endpoint, and the
 * redeem rejects any token it did not sign.
 *
 * - `signin: true`    → a first-time member's link (`POST /auth/redeem-discord-link`)
 * - `magicLink: true` → an existing member's link (`POST /auth/redeem-magic-link`)
 */

export type SigninLinkKind = 'signin' | 'magic';

export interface SigninLinkClaims {
    kind: SigninLinkKind;
    /**
     * The name the link signs in as: a first-time link's Discord `username`,
     * a `/login` magic link's `name` claim (ROK-2283 MAJOR-1). Null when absent.
     */
    displayName: string | null;
}

/** The redeem endpoint (path under API_BASE_URL) for each link kind. */
export const SIGNIN_LINK_REDEEM_PATH: Readonly<Record<SigninLinkKind, string>> = {
    signin: '/auth/redeem-discord-link',
    magic: '/auth/redeem-magic-link',
};

function decodeSegment(segment: string): unknown {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
}

function readPayload(token: string): Record<string, unknown> | null {
    const segment = token.split('.')[1];
    if (!segment) return null;
    try {
        const payload = decodeSegment(segment);
        return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function nameOf(raw: unknown): string | null {
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** The link's kind and display name, or null when it is not a sign-in link. */
export function readSigninLinkClaims(token: string): SigninLinkClaims | null {
    const payload = readPayload(token);
    if (!payload) return null;
    if (payload.signin === true) return { kind: 'signin', displayName: nameOf(payload.username) };
    if (payload.magicLink === true) return { kind: 'magic', displayName: nameOf(payload.name) };
    return null;
}
