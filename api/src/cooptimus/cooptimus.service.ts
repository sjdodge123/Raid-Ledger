/**
 * Co-Optimus transport (ROK-1397) — settings-gated, permission-first.
 *
 * The API is keyless but Cloudflare-gated for unattended clients; the
 * transport activates only once the operator configures the allowlisted
 * user-agent granted by Co-Optimus (see docs/spikes/rok-275-co-optimus-spike.md
 * §7 and the ROK-275 permission email). Unconfigured ⇒ every call returns
 * null and the module is a warn-once no-op, mirroring ITAD's keyless mode.
 */
import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  COOPTIMUS_API_BASE,
  COOPTIMUS_RATE_LIMIT_MS,
  COOPTIMUS_ALLOWED_HOSTS,
} from './cooptimus.constants';
import {
  parseCooptimusResponse,
  isEmptyEnvelope,
  type CooptimusEntry,
} from './cooptimus-xml.util';
import {
  parseGamePage,
  UNKNOWN_PAGE_FACTS,
  type CooptimusPageFacts,
} from './cooptimus-page.util';

const FETCH_TIMEOUT_MS = 15_000;

export interface CooptimusLookup {
  /** Entries parsed from the response ([] when the envelope is empty). */
  entries: CooptimusEntry[];
  /** True when the API positively answered "no such game". */
  empty: boolean;
}

@Injectable()
export class CooptimusService {
  private readonly logger = new Logger(CooptimusService.name);
  private warnedUnconfigured = false;
  private nextFreeAt = 0;

  constructor(private readonly settingsService: SettingsService) {}

  isConfigured(): Promise<boolean> {
    return this.settingsService.isCooptimusConfigured();
  }

  /** Search by (partial) name. Null ⇒ transport disabled (unconfigured). */
  async searchByName(name: string): Promise<CooptimusLookup | null> {
    return this.lookup({ search: 'true', name });
  }

  /** Re-sync a pinned/known entry directly by Co-Optimus game id. */
  async searchById(id: number): Promise<CooptimusLookup | null> {
    return this.lookup({ search: 'true', id: String(id) });
  }

  /**
   * Admin "test" probe: one real request for a known co-op title. A 403
   * means the UA is not (or no longer) allowlisted past the bot wall —
   * surface that honestly instead of a generic failure.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const ua = await this.settingsService.getCooptimusUserAgent();
    if (!ua) {
      return {
        success: false,
        message: 'Co-Optimus user-agent is not configured',
      };
    }
    try {
      const text = await this.fetchApi(ua, {
        search: 'true',
        name: 'Borderlands',
      });
      const entries = parseCooptimusResponse(text);
      if (entries.length > 0) {
        return {
          success: true,
          message: `Connected — ${entries.length} entries for "Borderlands"`,
        };
      }
      return {
        success: false,
        message:
          'Reached the API but the response held no entries — check the UA allowlisting',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: msg.includes('403')
          ? 'HTTP 403 — the user-agent is not allowlisted past the Cloudflare challenge'
          : `Request failed: ${msg}`,
      };
    }
  }

  private async lookup(
    params: Record<string, string>,
  ): Promise<CooptimusLookup | null> {
    const ua = await this.settingsService.getCooptimusUserAgent();
    if (!ua) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.warn(
          'Co-Optimus user-agent not configured — enrichment disabled (permission-first; see ROK-275)',
        );
      }
      return null;
    }
    const text = await this.fetchApi(ua, params);
    return {
      entries: parseCooptimusResponse(text),
      empty: isEmptyEnvelope(text),
    };
  }

  /**
   * The URL originates from an external XML payload, so it is untrusted input
   * to a server-side request: https only, and only Co-Optimus hosts.
   */
  private isAllowedPageUrl(url: string | null): url is string {
    if (!url) return false;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    // https ONLY. The allowlisted user-agent is effectively the credential on
    // their Cloudflare exemption, so it must never cross the wire in plaintext
    // (Codex pre-push P2). Their own <url> values are all https.
    if (parsed.protocol !== 'https:') return false;
    if (!COOPTIMUS_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
      this.logger.warn(
        `Refusing Co-Optimus page fetch for off-domain host: ${parsed.hostname}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Facts their site renders but `games.php` never returns — combo co-op and
   * downloadable-only (see cooptimus-page.util for the measurements). One
   * extra throttled GET per matched game.
   *
   * Deliberately non-throwing: the API match already succeeded, so a page that
   * 404s, times out, or changes shape must degrade to "unknown" rather than
   * fail the row and burn one of the batch's consecutive-failure budget.
   */
  async fetchGamePageFacts(url: string | null): Promise<CooptimusPageFacts> {
    if (!this.isAllowedPageUrl(url)) return UNKNOWN_PAGE_FACTS;
    const ua = await this.settingsService.getCooptimusUserAgent();
    if (!ua) return UNKNOWN_PAGE_FACTS;
    try {
      await this.throttle();
      const res = await fetch(url, {
        headers: { 'User-Agent': ua, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // A 3xx to another host would side-step the allowlist above, so refuse
        // to follow one at all. Their game URLs answer 200 directly; a redirect
        // means something changed and "unknown" is the safe answer.
        redirect: 'error',
      });
      if (!res.ok) {
        this.logger.warn(`Co-Optimus page HTTP ${res.status} for ${url}`);
        return UNKNOWN_PAGE_FACTS;
      }
      return parseGamePage(await res.text());
    } catch (err) {
      this.logger.warn(
        `Co-Optimus page fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return UNKNOWN_PAGE_FACTS;
    }
  }

  /**
   * ≥ crawl-delay spacing across ALL callers (robots.txt asks 1s). Slot
   * reservation is synchronous (no await between read and write), so
   * concurrent callers — e.g. admin "Test" during a cron batch — each get a
   * consecutive slot instead of racing a shared timestamp (review finding).
   */
  private async throttle(): Promise<void> {
    const slot = Math.max(Date.now(), this.nextFreeAt);
    this.nextFreeAt = slot + COOPTIMUS_RATE_LIMIT_MS;
    const wait = slot - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  private async fetchApi(
    userAgent: string,
    params: Record<string, string>,
  ): Promise<string> {
    await this.throttle();
    const url = `${COOPTIMUS_API_BASE}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: 'text/xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Co-Optimus HTTP ${res.status}`);
    return res.text();
  }
}
