/**
 * ROK-1592: resolves a calendar adapter by provider key (plan L1, L12, L15).
 *
 * Only `google` resolves today; `microsoft` (ROK-1597) and `apple` (ROK-1598)
 * return null so their routes 404. ROK-1596 adds
 * `getWriteProviderForConnection`: an adapter is a write provider when it
 * implements `CalendarWriteCapability` (Google from ROK-1596 G2).
 *
 * DEMO_MODE fake rows are `provider='google'` with a `demo-fake:` subject
 * (L15). They route to the fake ONLY when a fake is registered AND
 * `process.env.DEMO_MODE === 'true'` AND the `demo_mode` setting is on — the
 * same double gate as `admin/demo-test-core.controller.ts`. Otherwise they
 * resolve to null, never to Google: a fake token must not reach Google.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import type {
  CalendarAccountProvider,
  CalendarWriteCapability,
} from './calendar-provider.interface';
import { GoogleCalendarAdapter } from './google/google.adapter';
import { FAKE_SUBJECT_PREFIX } from './testing/fake-calendar.provider';

/** `account_subject` prefix of a DEMO_MODE fake connection (L15). */
export const DEMO_FAKE_SUBJECT_PREFIX = FAKE_SUBJECT_PREFIX;

/**
 * DI token for the in-memory fake (`testing/fake-calendar.provider`). The
 * module registers it; when it is absent no row ever routes to a fake.
 */
export const CALENDAR_FAKE_PROVIDER = Symbol('CALENDAR_FAKE_PROVIDER');

/** The slice of SettingsService the registry needs. */
export interface DemoModeSource {
  getDemoMode(): Promise<boolean>;
}

/** The columns of a `calendar_connections` row that pick its adapter. */
export interface ConnectionProviderRef {
  provider: string;
  accountSubject: string;
}

/** An adapter that can write Raid Ledger copies. */
export type CalendarWriteProvider = CalendarAccountProvider &
  CalendarWriteCapability;

const WRITE_METHODS = [
  'ensureRaidLedgerCalendar',
  'upsertEvent',
  'deleteEvent',
  'deleteRaidLedgerCalendar',
] as const;

/** true when `p` implements every `CalendarWriteCapability` method. */
export function hasWriteCapability(
  p: CalendarAccountProvider | null,
): p is CalendarWriteProvider {
  if (!p) return false;
  const methods = p as unknown as Record<string, unknown>;
  return WRITE_METHODS.every((m) => typeof methods[m] === 'function');
}

export function isDemoFakeSubject(subject: string): boolean {
  return subject.startsWith(DEMO_FAKE_SUBJECT_PREFIX);
}

@Injectable()
export class CalendarProviderRegistry {
  private readonly accountProviders: ReadonlyMap<
    string,
    CalendarAccountProvider
  >;

  constructor(
    @Inject(SettingsService) private readonly settings: DemoModeSource,
    @Inject(GoogleCalendarAdapter) google: CalendarAccountProvider,
    @Optional()
    @Inject(CALENDAR_FAKE_PROVIDER)
    private readonly fake: CalendarAccountProvider | null = null,
  ) {
    this.accountProviders = new Map([[google.key, google]]);
  }

  /** The adapter that starts a new connect; null = not shipped (404). */
  getAccountProvider(key: string): CalendarAccountProvider | null {
    return this.accountProviders.get(key) ?? null;
  }

  /** The adapter for an existing row; null = none may touch it. */
  async getAccountProviderForConnection(
    conn: ConnectionProviderRef,
  ): Promise<CalendarAccountProvider | null> {
    if (!isDemoFakeSubject(conn.accountSubject)) {
      return this.getAccountProvider(conn.provider);
    }
    return (await this.fakeAllowed()) ? this.fake : null;
  }

  /**
   * The write adapter for an existing row; null = the provider cannot write
   * yet, or (demo-fake row) the double gate is closed — never Google.
   */
  async getWriteProviderForConnection(
    conn: ConnectionProviderRef,
  ): Promise<CalendarWriteProvider | null> {
    const provider = await this.getAccountProviderForConnection(conn);
    return hasWriteCapability(provider) ? provider : null;
  }

  private async fakeAllowed(): Promise<boolean> {
    if (!this.fake || process.env.DEMO_MODE !== 'true') return false;
    return this.settings.getDemoMode();
  }
}
