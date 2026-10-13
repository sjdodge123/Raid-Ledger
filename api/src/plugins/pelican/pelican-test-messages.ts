import type { PelicanTestCode } from '@raid-ledger/contract';

/** Facts a test-result message may quote — never a body or the key. */
export interface PelicanTestMessageContext {
  serverCount?: number;
  host?: string;
  status?: number;
  ipNotAllowed?: boolean;
}

const APPLICATION_KEY =
  'This is an application key (papp_). Pelican only accepts client keys here. ' +
  'Create a client key (pacc_) for a read-only subuser added to just the ' +
  'servers to show, with Allowed IPs set to this Raid Ledger host.';

const FIXED: Partial<Record<PelicanTestCode, string>> = {
  not_configured: 'Save a panel URL and client API key first.',
  application_key: APPLICATION_KEY,
  unauthorized:
    'Pelican rejected the key (HTTP 401). Check it is a client key (pacc_) and has not been deleted.',
  timeout:
    'The panel did not answer within 10 seconds. Check the URL and that this server can reach it.',
  redirect:
    "The panel URL redirected. Enter the panel's final address (usually https://…), not one that forwards.",
  bad_response:
    "Something answered at that URL, but not Pelican's client API. Check the URL is the panel's root.",
};

/** Admin-facing copy for one connection-test outcome (ROK-121 §3.4). */
export function pelicanTestMessage(
  code: PelicanTestCode,
  ctx: PelicanTestMessageContext = {},
): string {
  const fixed = FIXED[code];
  if (fixed !== undefined) return fixed;
  switch (code) {
    case 'ok':
      return `OK — ${ctx.serverCount ?? 0} server(s) visible to this key.`;
    case 'forbidden':
      return ctx.ipNotAllowed === true
        ? "Pelican refused the key (HTTP 403). Check the key's Allowed IPs include this Raid Ledger host."
        : 'Pelican refused the request (HTTP 403).';
    case 'network':
      return `Could not reach the panel at ${ctx.host ?? 'that URL'}.`;
    default:
      return `Pelican returned HTTP ${ctx.status ?? 'error'}.`;
  }
}
