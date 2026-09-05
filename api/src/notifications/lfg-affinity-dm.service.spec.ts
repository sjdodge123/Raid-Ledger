/**
 * ROK-1471 D11 — affinity DMs when an LFG group reaches LFM.
 *
 * The service listens to `LFM_REACHED` ONLY, is inert while the board toggle
 * is off (D1), dedups once per (game, user) and fails CLOSED when Redis is
 * unreachable (E14) — a fan-out that cannot dedup must not fan out at all.
 */
import { LfgAffinityDmService } from './lfg-affinity-dm.service';
import { LFG_EVENTS, LFG_EXPIRY_DAYS } from '../lfg/lfg.constants';

/** Rows the mocked `db.select()...where()` chain resolves to, in call order. */
function makeSelectChain(queue: unknown[][]) {
  const chain: Record<string, unknown> = {
    from: jest.fn(() => chain),
    innerJoin: jest.fn(() => chain),
    where: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    then: (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(resolve),
  };
  return chain;
}

interface Harness {
  service: LfgAffinityDmService;
  create: jest.Mock;
  checkAndMarkSent: jest.Mock;
  execute: jest.Mock;
  errorLog: jest.SpyInstance;
  debugLog: jest.SpyInstance;
}

function makeService(opts: {
  enabled?: boolean;
  recipientIds?: number[];
  liveIntentUserIds?: number[];
  game?: { name: string; slug: string } | null;
  alreadySent?: boolean;
  dedupThrows?: boolean;
}): Harness {
  const game = opts.game === undefined ? { name: 'Deep Rock Galactic', slug: 'drg' } : opts.game;
  const execute = jest.fn().mockResolvedValue(
    (opts.recipientIds ?? []).map((id) => ({ id })),
  );
  const selectQueue: unknown[][] = [
    game ? [game] : [],
    (opts.liveIntentUserIds ?? []).map((userId) => ({ userId })),
  ];
  const chain = makeSelectChain(selectQueue);
  const db = { execute, select: jest.fn(() => chain) };
  const create = jest.fn().mockResolvedValue({ id: 'n1' });
  const checkAndMarkSent = opts.dedupThrows
    ? jest.fn().mockRejectedValue(new Error('Redis is down'))
    : jest.fn().mockResolvedValue(opts.alreadySent ?? false);
  const settingsService = {
    get: jest.fn().mockResolvedValue(opts.enabled === false ? 'false' : 'true'),
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Gamer Night' }),
  };
  const service = new LfgAffinityDmService(
    db as never,
    { create } as never,
    { checkAndMarkSent } as never,
    settingsService as never,
  );
  const errorLog = jest
    .spyOn((service as unknown as { logger: { error: () => void } }).logger, 'error')
    .mockImplementation(() => undefined);
  const debugLog = jest
    .spyOn((service as unknown as { logger: { debug: () => void } }).logger, 'debug')
    .mockImplementation(() => undefined);
  return { service, create, checkAndMarkSent, execute, errorLog, debugLog };
}

/** Event names the class registers via `@OnEvent`, read back off the metadata. */
function registeredEvents(): string[] {
  const proto = LfgAffinityDmService.prototype as unknown as Record<string, unknown>;
  const events: string[] = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    const method = proto[key];
    if (typeof method !== 'function') continue;
    const meta: unknown = Reflect.getMetadata('EVENT_LISTENER_METADATA', method);
    const entries = Array.isArray(meta) ? meta : meta ? [meta] : [];
    for (const entry of entries) {
      const event = (entry as { event?: string }).event;
      if (event) events.push(event);
    }
  }
  return events;
}

describe('LfgAffinityDmService (ROK-1471 D11)', () => {
  const payload = { gameId: 7, activeCount: 2 };

  afterEach(() => jest.restoreAllMocks());

  it('DMs every subscriber who is not already in the group (AC10)', async () => {
    const h = makeService({ recipientIds: [11, 22], liveIntentUserIds: [22] });

    await h.service.handleLfmReached(payload);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 11,
        type: 'lfg_invite',
        payload: expect.objectContaining({
          gameId: 7,
          gameSlug: 'drg',
          gameName: 'Deep Rock Galactic',
          memberCount: 2,
        }),
      }),
    );
  });

  it('excludes deactivated and banned users in the recipient read itself', async () => {
    const h = makeService({ recipientIds: [11] });

    await h.service.handleLfmReached(payload);

    const issued = JSON.stringify(h.execute.mock.calls[0][0]);
    expect(issued).toContain('deactivated_at IS NULL');
    expect(issued).toContain('banned_at IS NULL');
  });

  it('dedups once per (game, user) for the intent lifetime', async () => {
    const h = makeService({ recipientIds: [11] });

    await h.service.handleLfmReached(payload);

    expect(h.checkAndMarkSent).toHaveBeenCalledWith(
      'lfg-invite:game:7:user:11',
      LFG_EXPIRY_DAYS * 86400,
    );
  });

  it('listens to LFM_REACHED only — never GROUP_CHANGED', () => {
    const events = registeredEvents();
    expect(events).toContain(LFG_EVENTS.LFM_REACHED);
    expect(events).not.toContain(LFG_EVENTS.GROUP_CHANGED);
  });

  it('is inert while the board toggle is off — no dedup, no DM (D1)', async () => {
    const h = makeService({ enabled: false, recipientIds: [11, 22] });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
    expect(h.checkAndMarkSent).not.toHaveBeenCalled();
  });

  it('sends nothing when every recipient was already invited (T14)', async () => {
    const h = makeService({ recipientIds: [11, 22], alreadySent: true });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the dedup store throws — no DMs, one error log (E14/T16)', async () => {
    const h = makeService({ recipientIds: [11, 22], dedupThrows: true });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalledTimes(1);
    expect(String(h.errorLog.mock.calls[0][0])).toContain('7');
  });

  it('logs and returns without error when nobody subscribes to the game (E12)', async () => {
    const h = makeService({ recipientIds: [] });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
    expect(h.checkAndMarkSent).not.toHaveBeenCalled();
    expect(h.debugLog).toHaveBeenCalled();
  });

  it('does nothing when the game row has vanished', async () => {
    const h = makeService({ recipientIds: [11], game: null });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
  });
});
