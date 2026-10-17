import { pelicanPanelUrlProblem } from '@raid-ledger/contract';

export type NormalisedPanelUrl =
  { ok: true; url: string } | { ok: false; reason: string };

/**
 * Validate an admin-supplied panel URL and normalise it to
 * `<origin><path>` with no trailing slash, so `${url}/api/client` keeps a
 * sub-path panel (`https://host/panel`) working.
 */
export function normalisePanelUrl(raw: string): NormalisedPanelUrl {
  const trimmed = raw.trim();
  const problem = pelicanPanelUrlProblem(trimmed);
  if (problem !== null) return { ok: false, reason: problem };
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${url.origin}${path}` };
}

export type PelicanKeyKind = 'application' | 'client' | 'unknown';

/**
 * Pelican prefixes account (client) keys `pacc_` and application keys
 * `papp_`; application keys are refused on client routes. Unknown prefixes
 * pass through (legacy keys carry none).
 */
export function classifyApiKey(key: string): PelicanKeyKind {
  const trimmed = key.trim();
  if (trimmed.startsWith('papp_')) return 'application';
  if (trimmed.startsWith('pacc_')) return 'client';
  return 'unknown';
}
