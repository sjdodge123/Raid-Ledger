/**
 * MSW fixtures for the Valheim Link admin token routes (ROK-1833). Not in the
 * default handler list: specs install the routes they need with `server.use()`
 * so every request a spec makes is one it asked for.
 */
import type { ValheimLinkTokenIssued, ValheimLinkTokenStatus } from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
export const VALHEIM_LINK_TOKENS_URL = `${API_BASE}/admin/plugins/valheim/link-tokens`;
export const VALHEIM_LINK_TOKEN_URL = `${VALHEIM_LINK_TOKENS_URL}/:id`;
export const VALHEIM_LINK_TOKEN_ROTATE_URL = `${VALHEIM_LINK_TOKENS_URL}/:id/rotate`;

/** A Valheim-mapped server with no token yet. */
export const valheimTokenNone: ValheimLinkTokenStatus = {
    pelicanServerId: 7, serverId: '7', state: 'none', tokenHint: null,
    createdAt: null, rotatedAt: null, revokedAt: null, lastUsedAt: null,
};

/** The same server with a live token. */
export const valheimTokenActive: ValheimLinkTokenStatus = {
    ...valheimTokenNone, state: 'active', tokenHint: 'ab12', createdAt: '2026-10-01T12:00:00.000Z',
};

/** A real-shaped raw token (`rlvl_` + 43 base64url chars) — fixture only. */
export const VALHEIM_RAW_TOKEN = `rlvl_${'A'.repeat(39)}ab12`;

/** The issue / rotate response for {@link valheimTokenActive}. */
export const valheimTokenIssued: ValheimLinkTokenIssued = {
    token: VALHEIM_RAW_TOKEN, serverId: '7', status: valheimTokenActive,
};
