import { z } from 'zod';

/**
 * Pelican game-server panel plugin — admin connection settings (ROK-121).
 * `GET/PUT /admin/plugins/pelican/config`, `POST /admin/plugins/pelican/test`.
 *
 * The client API key travels one way only: the read shape carries
 * `apiKeySet`, never the value, and is `.strict()` so a server that leaked
 * an `apiKey` field would fail its own response parse.
 */

/** Longest panel URL accepted (stored in `app_settings`). */
export const PELICAN_PANEL_URL_MAX = 2048;
/** Longest client API key accepted. */
export const PELICAN_API_KEY_MAX = 512;

/**
 * Why a panel URL is unacceptable, or `null` when it is fine.
 * http(s) only, no `user:pass@`, no query string or fragment. LAN hosts are
 * allowed on purpose — self-hosted panels live there (ROK-121 Q2).
 */
export function pelicanPanelUrlProblem(raw: string): string | null {
  if (raw.length > PELICAN_PANEL_URL_MAX) return 'Panel URL is too long';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Panel URL must be a full URL, e.g. https://panel.example.com';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Panel URL must start with http:// or https://';
  }
  if (url.username !== '' || url.password !== '') {
    return 'Panel URL must not contain a username or password';
  }
  if (url.search !== '' || url.hash !== '') {
    return 'Panel URL must not contain a query string or fragment';
  }
  return null;
}

/** `true` when `tz` is an IANA zone this runtime knows. */
export function isValidIanaTimezone(tz: string): boolean {
  if (tz === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const PelicanConfigSchema = z
  .object({
    panelUrl: z.string().nullable(),
    apiKeySet: z.boolean(),
    defaultTimezone: z.string(),
    /** True when no Pelican tz is stored and the community default applies. */
    timezoneInherited: z.boolean(),
  })
  .strict();
export type PelicanConfig = z.infer<typeof PelicanConfigSchema>;

/**
 * Every field is optional: omitted = unchanged, `''` = clear.
 */
export const PelicanConfigUpdateSchema = z
  .object({
    panelUrl: z
      .string()
      .trim()
      .max(PELICAN_PANEL_URL_MAX)
      .refine((v) => v === '' || pelicanPanelUrlProblem(v) === null, {
        message:
          'Panel URL must be an http(s) URL with no credentials, query or fragment',
      })
      .optional(),
    apiKey: z.string().trim().max(PELICAN_API_KEY_MAX).optional(),
    defaultTimezone: z
      .string()
      .trim()
      .max(64)
      .refine((v) => v === '' || isValidIanaTimezone(v), {
        message: 'Default timezone must be a valid IANA timezone',
      })
      .optional(),
  })
  .strict();
export type PelicanConfigUpdate = z.infer<typeof PelicanConfigUpdateSchema>;

/** Why a Pelican call failed (`PelicanClient` error kinds). */
export const PELICAN_ERROR_KINDS = [
  'application_key',
  'unauthorized',
  'forbidden',
  'timeout',
  'redirect',
  'network',
  'http',
  'bad_response',
] as const;
export const PelicanErrorKindSchema = z.enum(PELICAN_ERROR_KINDS);
export type PelicanErrorKind = z.infer<typeof PelicanErrorKindSchema>;

export const PelicanTestCodeSchema = z.enum([
  'ok',
  'not_configured',
  ...PELICAN_ERROR_KINDS,
]);
export type PelicanTestCode = z.infer<typeof PelicanTestCodeSchema>;

/** Outcome of a connection test — always HTTP 200; the outcome is data. */
export const PelicanTestResultSchema = z
  .object({
    success: z.boolean(),
    code: PelicanTestCodeSchema,
    message: z.string(),
    serverCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PelicanTestResult = z.infer<typeof PelicanTestResultSchema>;
