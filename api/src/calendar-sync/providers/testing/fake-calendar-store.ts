import { NotFoundError } from '../calendar-provider.errors';
import type {
  BusyBlock,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';

/**
 * ROK-1596: the remote state behind `FakeCalendarProvider`'s write
 * capability — what "the user's calendar" holds. Specs read it back
 * (`copiesIn`) and script failures into it (`failNext`). Deterministic: the
 * n-th calendar is `fake-cal-n`, the n-th copy `fake-evt-n`.
 */

/** Google's alias for the user's main calendar; always present. */
export const FAKE_PRIMARY_CALENDAR_ID = 'primary';

/** One Raid Ledger copy as the fake calendar stores it. */
export interface FakeCopy {
  id: string;
  calendarId: string;
  copyId: string;
  /** As shown on the calendar: the adapter adds "(Tentative) ". */
  title: string;
  description: string;
  url: string;
  /** false = shows as Free (tentative). */
  busy: boolean;
  start: Date;
  end: Date;
  etag: string;
}

/** A calendar `seedCalendars` adds (ROK-1593 read). */
export interface FakeCalendarSeed {
  id: string;
  name: string;
  /** false = a calendar shared read-only with the user. Default true. */
  writable?: boolean;
}

/** The fields an upsert writes; ids and etags are the store's. */
export type FakeCopyFields = Omit<FakeCopy, 'id' | 'calendarId' | 'etag'>;

export class FakeCalendarStore {
  private readonly calendars = new Map<string, string>([
    [FAKE_PRIMARY_CALENDAR_ID, 'Primary'],
  ]);
  private readonly copies = new Map<string, FakeCopy>();
  private readonly failures: Error[] = [];
  private readonly readOnly = new Set<string>();
  private readonly busy = new Map<string, BusyBlock[]>();
  /** ROK-1595: blocks only one grant sees (owner key → calendar → blocks). */
  private readonly ownedBusy = new Map<string, Map<string, BusyBlock[]>>();
  private readonly readFailures: Error[] = [];
  private calendarSerial = 0;
  private copySerial = 0;
  private etagSerial = 0;

  /** Queue `err` for the next write call (FIFO; one error per call). */
  failNext(err: Error): void {
    this.failures.push(err);
  }

  /** Drop every queued failure (spec teardown). */
  clearFailures(): void {
    this.failures.length = 0;
  }

  /** Throws the next queued failure, if any. Every write op calls it first. */
  takeFailure(): void {
    const err = this.failures.shift();
    if (err) throw err;
  }

  createCalendar(name: string): string {
    this.calendarSerial += 1;
    const id = `fake-cal-${this.calendarSerial}`;
    this.calendars.set(id, name);
    return id;
  }

  hasCalendar(id: string): boolean {
    return this.calendars.has(id);
  }

  calendarName(id: string): string | null {
    return this.calendars.get(id) ?? null;
  }

  /** Add foreign calendars the user can read (ROK-1593). */
  seedCalendars(seeds: readonly FakeCalendarSeed[]): void {
    for (const seed of seeds) {
      this.calendars.set(seed.id, seed.name);
      if (seed.writable === false) this.readOnly.add(seed.id);
    }
  }

  /**
   * Foreign busy blocks on a calendar (never carry `ourId`). With `owner`
   * (ROK-1595) only a fetch by that grant sees them — the DEMO seed's path,
   * so one connection's seeds never leak into another's sync. Without it,
   * every grant sees them (specs scripting "the user's calendar").
   */
  seedBusy(
    calendarId: string,
    blocks: readonly BusyBlock[],
    owner?: string,
  ): void {
    if (!this.calendars.has(calendarId))
      throw new NotFoundError('calendar_not_found');
    const bucket = owner === undefined ? this.busy : this.ownerBucket(owner);
    const prior = bucket.get(calendarId) ?? [];
    bucket.set(calendarId, [...prior, ...blocks]);
  }

  private ownerBucket(owner: string): Map<string, BusyBlock[]> {
    const existing = this.ownedBusy.get(owner);
    if (existing) return existing;
    const created = new Map<string, BusyBlock[]>();
    this.ownedBusy.set(owner, created);
    return created;
  }

  /** Queue `err` for the next `fetchBusy` (FIFO; one error per call). */
  failNextFetch(err: Error): void {
    this.readFailures.push(err);
  }

  takeReadFailure(): void {
    const err = this.readFailures.shift();
    if (err) throw err;
  }

  /** The picker rows; `isRaidLedger` is the caller's to set (as Google). */
  listCalendars(): ProviderCalendar[] {
    return [...this.calendars].map(([id, name]) => ({
      id,
      name,
      primary: id === FAKE_PRIMARY_CALENDAR_ID,
      writable: !this.readOnly.has(id),
      isRaidLedger: false,
    }));
  }

  /**
   * Busy blocks overlapping `range`: seeded foreign blocks plus the store's
   * OWN busy copies (`ourId` = copy id) — a real round-trip of what the
   * write path stored. Free (tentative/bench) copies are not busy. `owner`
   * adds the blocks seeded for that grant only (ROK-1595).
   */
  busyIn(calendarId: string, range: TimeRange, owner?: string): BusyBlock[] {
    const overlaps = (b: { start: Date; end: Date }) =>
      b.start < range.end && b.end > range.start;
    const copies = this.copiesIn(calendarId)
      .filter((c) => c.busy)
      .map((c) => ({
        start: c.start,
        end: c.end,
        allDay: false,
        ourId: c.copyId,
      }));
    const owned =
      owner === undefined
        ? []
        : (this.ownedBusy.get(owner)?.get(calendarId) ?? []);
    const seeded = [...(this.busy.get(calendarId) ?? []), ...owned];
    return [...seeded, ...copies].filter(overlaps).map((b) => ({ ...b }));
  }

  /** Drop a calendar and every copy in it (also "deleted remotely"). */
  removeCalendar(id: string): void {
    this.calendars.delete(id);
    this.busy.delete(id);
    for (const bucket of this.ownedBusy.values()) bucket.delete(id);
    for (const copy of this.copiesIn(id)) this.copies.delete(copy.id);
  }

  copiesIn(calendarId: string): FakeCopy[] {
    return [...this.copies.values()].filter((c) => c.calendarId === calendarId);
  }

  allCopies(): FakeCopy[] {
    return [...this.copies.values()];
  }

  getCopy(id: string): FakeCopy | null {
    return this.copies.get(id) ?? null;
  }

  /** The copy carrying `copyId` in `calendarId` (Google's rlCopyId lookup). */
  findCopyByCopyId(calendarId: string, copyId: string): FakeCopy | null {
    const found = this.copiesIn(calendarId).find((c) => c.copyId === copyId);
    return found ?? null;
  }

  /**
   * Insert (`existingId` null) or patch in place. Like Google: an unknown
   * calendar, or patching a copy that is gone, is a `NotFoundError`.
   */
  upsertCopy(
    calendarId: string,
    fields: FakeCopyFields,
    existingId: string | null,
  ): FakeCopy {
    if (!this.calendars.has(calendarId))
      throw new NotFoundError('calendar_not_found');
    const prior = existingId ? this.copies.get(existingId) : undefined;
    if (existingId && (!prior || prior.calendarId !== calendarId))
      throw new NotFoundError('event_not_found');
    const copy: FakeCopy = {
      ...fields,
      id: prior?.id ?? this.nextCopyId(),
      calendarId,
      etag: this.nextEtag(),
    };
    this.copies.set(copy.id, copy);
    return copy;
  }

  /** true when something was deleted; a missing copy is not an error. */
  deleteCopy(id: string): boolean {
    return this.copies.delete(id);
  }

  private nextCopyId(): string {
    this.copySerial += 1;
    return `fake-evt-${this.copySerial}`;
  }

  private nextEtag(): string {
    this.etagSerial += 1;
    return `"fake-etag-${this.etagSerial}"`;
  }
}
