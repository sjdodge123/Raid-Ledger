import { Logger } from '@nestjs/common';
import type { z } from 'zod';
import type { PelicanErrorKind } from '@raid-ledger/contract';
import {
  PELICAN_HTTP_TIMEOUT_MS,
  PELICAN_MAX_PER_PAGE,
} from './pelican.constants';
import { classifyApiKey, normalisePanelUrl } from './pelican-url.helpers';
import {
  PelicanErrorBodySchema,
  PelicanScheduleListSchema,
  PelicanServerPageSchema,
  PelicanStatsSchema,
  type PelicanSchedule,
  type PelicanServerPage,
  type PelicanStats,
} from './pelican-api.schemas';

/** A failed Pelican call. Carries no response body and never the key. */
export interface PelicanClientError {
  kind: PelicanErrorKind;
  /** HTTP status for `unauthorized` / `forbidden` / `http` / `bad_response`. */
  status?: number;
  /** 403 from Pelican's key `allowed_ips` check (`AuthenticateIPAccess`). */
  ipNotAllowed?: boolean;
}

export type PelicanResult<T> =
  { ok: true; data: T } | { ok: false; error: PelicanClientError };

export interface PelicanClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Thin client for Pelican's client API (`/api/client`, `pacc_` keys).
 * Methods never throw on HTTP, timeout, redirect or parse failure — they
 * resolve a {@link PelicanResult}. The constructor throws only on an
 * invalid panel URL (callers validate before constructing).
 */
export class PelicanClient {
  private readonly logger = new Logger(PelicanClient.name);
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: PelicanClientOptions) {
    const normalised = normalisePanelUrl(opts.baseUrl);
    if (!normalised.ok) throw new Error('Invalid Pelican panel URL');
    this.baseUrl = normalised.url;
    this.host = new URL(normalised.url).host;
    this.apiKey = opts.apiKey.trim();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? PELICAN_HTTP_TIMEOUT_MS;
  }

  /** `GET /api/client` — servers visible to the key's user. */
  listServers(
    q: { page?: number; perPage?: number } = {},
  ): Promise<PelicanResult<PelicanServerPage>> {
    const page = Math.max(1, Math.floor(q.page ?? 1));
    const perPage = Math.min(
      PELICAN_MAX_PER_PAGE,
      Math.max(1, Math.floor(q.perPage ?? 50)),
    );
    const path = `?page=${page}&per_page=${perPage}`;
    return this.request(path, PelicanServerPageSchema);
  }

  /** `GET /api/client/servers/{id}/resources` — live state + usage. */
  getResources(serverId: string): Promise<PelicanResult<PelicanStats>> {
    const path = `/servers/${encodeURIComponent(serverId)}/resources`;
    return this.request(path, PelicanStatsSchema);
  }

  /** `GET /api/client/servers/{id}/schedules` — schedules with tasks. */
  listSchedules(serverId: string): Promise<PelicanResult<PelicanSchedule[]>> {
    const path = `/servers/${encodeURIComponent(serverId)}/schedules`;
    return this.request(path, PelicanScheduleListSchema);
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<PelicanResult<T>> {
    if (classifyApiKey(this.apiKey) === 'application') {
      return this.fail(path, { kind: 'application_key' });
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/client${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return this.fail(path, { kind: fetchErrorKind(err) });
    }
    if (!res.ok) return this.fail(path, await httpError(res));
    const parsed = schema.safeParse(await readJson(res));
    if (!parsed.success) {
      return this.fail(path, { kind: 'bad_response', status: res.status });
    }
    return { ok: true, data: parsed.data };
  }

  /** Logs host, path, status and kind only — never the key or a body. */
  private fail<T>(path: string, error: PelicanClientError): PelicanResult<T> {
    const status = error.status === undefined ? '' : ` HTTP ${error.status}`;
    const route = `/api/client${path.split('?')[0] ?? ''}`;
    this.logger.warn(
      `Pelican ${this.host}${route} failed: ${error.kind}${status}`,
    );
    return { ok: false, error };
  }
}

/** Map a `fetch` rejection to a kind without touching its `cause` chain. */
export function fetchErrorKind(err: unknown): PelicanErrorKind {
  const name = errorField(err, 'name');
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  // undici: TypeError('fetch failed') with cause Error('unexpected redirect').
  const cause = err instanceof Error ? err.cause : undefined;
  const causeMessage = errorField(cause, 'message');
  if (causeMessage !== undefined && /redirect/i.test(causeMessage)) {
    return 'redirect';
  }
  return 'network';
}

function errorField(value: unknown, key: 'name' | 'message') {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const field: unknown = Reflect.get(value, key);
  return typeof field === 'string' ? field : undefined;
}

async function httpError(res: Response): Promise<PelicanClientError> {
  if (res.status === 401) return { kind: 'unauthorized', status: 401 };
  if (res.status !== 403) return { kind: 'http', status: res.status };
  const body = PelicanErrorBodySchema.safeParse(await readJson(res));
  const ipNotAllowed =
    body.success &&
    body.data.errors.some(
      (e) =>
        e.code === 'AccessDeniedHttpException' &&
        /IP address .* does not have permission/i.test(e.detail ?? ''),
    );
  return { kind: 'forbidden', status: 403, ipNotAllowed };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}
