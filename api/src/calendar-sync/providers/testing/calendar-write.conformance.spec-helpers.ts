import type {
  CalendarCredentials,
  CalendarWriteCapability,
  CopyEventInput,
  CopyRef,
} from '../calendar-provider.interface';

/**
 * ROK-1596: the write half of the calendar provider conformance suite
 * (spec §6 row A1). Every adapter with `CalendarWriteCapability` runs it
 * from its spec with a factory that runs before EACH case and stages what
 * the adapter needs (a real adapter: HTTP fixtures for calendars.get/insert,
 * events.insert/patch/delete and a 404 for a removed calendar).
 */
/** What the write suite needs from an adapter's spec (ROK-1596). */
export interface WriteConformanceHarness {
  provider: CalendarWriteCapability;
  credentials: CalendarCredentials;
  /** Stage `calendarId` as deleted on the provider side (user removed it). */
  removeCalendarRemotely(calendarId: string): void | Promise<void>;
  /** The copy as the provider holds it now; null = it does not exist. */
  readCopy(ref: CopyRef): Promise<{ title: string; busy: boolean } | null>;
  /** The user's main calendar id; `primary` when absent (ROK-1598 A5). */
  primaryCalendarId?: string;
}

export type WriteConformanceFactory = () =>
  WriteConformanceHarness | Promise<WriteConformanceHarness>;

type WriteHarness = () => WriteConformanceHarness;

const COPY: CopyEventInput = {
  copyId: 'rl:conformance-instance:42:7',
  title: 'Raid Night',
  description: 'https://raid.example/events/42\nAdded by Raid Ledger',
  url: 'https://raid.example/events/42',
  start: new Date('2026-11-01T19:00:00.000Z'),
  end: new Date('2026-11-01T22:00:00.000Z'),
  tentative: false,
};

async function seedCopy(h: WriteConformanceHarness, tentative = false) {
  const cal = await h.provider.ensureRaidLedgerCalendar(h.credentials, null);
  const input = { ...COPY, tentative };
  const ref = await h.provider.upsertEvent(h.credentials, cal, input, null);
  return { cal, ref };
}

function describeDedicatedCalendar(get: WriteHarness): void {
  it('ensureRaidLedgerCalendar is idempotent for a known id', async () => {
    const h = get();
    const id = await h.provider.ensureRaidLedgerCalendar(h.credentials, null);
    expect(id.length).toBeGreaterThan(0);
    await expect(
      h.provider.ensureRaidLedgerCalendar(h.credentials, id),
    ).resolves.toBe(id);
  });

  it('ensureRaidLedgerCalendar recreates a calendar deleted remotely', async () => {
    const h = get();
    const id = await h.provider.ensureRaidLedgerCalendar(h.credentials, null);
    await h.removeCalendarRemotely(id);
    const next = await h.provider.ensureRaidLedgerCalendar(h.credentials, id);
    expect(next).not.toBe(id);
    expect(next.length).toBeGreaterThan(0);
  });

  it('deleteRaidLedgerCalendar removes the calendar and its copies', async () => {
    const h = get();
    const { cal, ref } = await seedCopy(h);
    await h.provider.deleteRaidLedgerCalendar(h.credentials, cal);
    await expect(h.readCopy(ref)).resolves.toBeNull();
    const next = await h.provider.ensureRaidLedgerCalendar(h.credentials, cal);
    expect(next).not.toBe(cal);
  });
}

function describeCopies(get: WriteHarness): void {
  it('upsertEvent creates, then updates the same copy in place', async () => {
    const h = get();
    const { cal, ref } = await seedCopy(h);
    expect(ref.calendarId).toBe(cal);
    const moved = { ...COPY, start: new Date('2026-11-02T19:00:00.000Z') };
    const next = await h.provider.upsertEvent(h.credentials, cal, moved, ref);
    expect(next.providerEventId).toBe(ref.providerEventId);
    expect(next.calendarId).toBe(cal);
  });

  it('a confirmed copy is "<title>" and Busy', async () => {
    const h = get();
    const { ref } = await seedCopy(h);
    await expect(h.readCopy(ref)).resolves.toEqual({
      title: 'Raid Night',
      busy: true,
    });
  });

  it('a tentative copy is "(Tentative) <title>" and Free; flipping back keeps the id', async () => {
    const h = get();
    const { cal, ref } = await seedCopy(h, true);
    await expect(h.readCopy(ref)).resolves.toEqual({
      title: '(Tentative) Raid Night',
      busy: false,
    });
    const next = await h.provider.upsertEvent(h.credentials, cal, COPY, ref);
    expect(next.providerEventId).toBe(ref.providerEventId);
    await expect(h.readCopy(next)).resolves.toEqual({
      title: 'Raid Night',
      busy: true,
    });
  });

  it('deleteEvent removes the copy and a second delete still resolves', async () => {
    const h = get();
    const { ref } = await seedCopy(h);
    await h.provider.deleteEvent(h.credentials, ref);
    await expect(h.readCopy(ref)).resolves.toBeNull();
    await expect(
      h.provider.deleteEvent(h.credentials, ref),
    ).resolves.toBeUndefined();
  });
}

/** Review M1: a create with no ref never leaves a second copy. */
function describeAdoption(get: WriteHarness): void {
  it('upsertEvent with no ref adopts the copy already carrying that rlCopyId (one copy, M1)', async () => {
    const h = get();
    const { cal, ref } = await seedCopy(h);
    const tentative = { ...COPY, tentative: true };
    const again = await h.provider.upsertEvent(
      h.credentials,
      cal,
      tentative,
      null,
    );
    expect(again.providerEventId).toBe(ref.providerEventId);
    await expect(h.readCopy(ref)).resolves.toEqual({
      title: '(Tentative) Raid Night',
      busy: false,
    });
  });

  it('a copy with the same rlCopyId in ANOTHER calendar is not adopted', async () => {
    const h = get();
    const { ref } = await seedCopy(h);
    const primary = h.primaryCalendarId ?? 'primary';
    const other = await h.provider.upsertEvent(
      h.credentials,
      primary,
      COPY,
      null,
    );
    expect(other.calendarId).toBe(primary);
    expect(other.providerEventId).not.toBe(ref.providerEventId);
  });
}

/** Register the write conformance suite for one adapter (ROK-1596). */
export function describeCalendarWriteConformance(
  factory: WriteConformanceFactory,
  name = 'calendar provider',
): void {
  describe(`${name} — calendar write conformance`, () => {
    let harness: WriteConformanceHarness;
    beforeEach(async () => {
      harness = await factory();
    });
    const get: WriteHarness = () => harness;
    describe('dedicated calendar', () => describeDedicatedCalendar(get));
    describe('copies', () => describeCopies(get));
    describe('rlCopyId adoption', () => describeAdoption(get));
  });
}
