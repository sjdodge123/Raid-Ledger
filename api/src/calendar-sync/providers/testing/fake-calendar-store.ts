import { NotFoundError } from '../calendar-provider.errors';

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

/** The fields an upsert writes; ids and etags are the store's. */
export type FakeCopyFields = Omit<FakeCopy, 'id' | 'calendarId' | 'etag'>;

export class FakeCalendarStore {
  private readonly calendars = new Map<string, string>([
    [FAKE_PRIMARY_CALENDAR_ID, 'Primary'],
  ]);
  private readonly copies = new Map<string, FakeCopy>();
  private readonly failures: Error[] = [];
  private calendarSerial = 0;
  private copySerial = 0;
  private etagSerial = 0;

  /** Queue `err` for the next write call (FIFO; one error per call). */
  failNext(err: Error): void {
    this.failures.push(err);
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

  /** Drop a calendar and every copy in it (also "deleted remotely"). */
  removeCalendar(id: string): void {
    this.calendars.delete(id);
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
