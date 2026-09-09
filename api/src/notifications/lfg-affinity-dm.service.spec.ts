/**
 * ROK-1471 D11 — affinity DMs when an LFG group reaches LFM.
 *
 * The service listens to `LFM_REACHED` ONLY, is inert while the board toggle
 * is off (D1), dedups once per (game, user) and fails CLOSED when Redis is
 * unreachable (E14) — a fan-out that cannot dedup must not fan out at all.
 */
import { LfgAffinityDmService } from './lfg-affinity-dm.service';
import {
  LFG_EVENTS,
  LFG_EXPIRY_DAYS,
  type LfgLfmReachedPayload,
} from '../lfg/lfg.constants';

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
  releaseKey: jest.Mock;
  execute: jest.Mock;
  errorLog: jest.SpyInstance;
  debugLog: jest.SpyInstance;
  warnLog: jest.SpyInstance;
}

function makeService(opts: {
  enabled?: boolean;
  recipientIds?: number[];
  liveIntentUserIds?: number[];
  game?: { name: string; slug: string } | null;
  alreadySent?: boolean;
  dedupThrows?: boolean;
  /** User ids whose `notificationService.create` rejects. */
  createRejectsFor?: number[];
  /** Make the settings read (the board toggle) reject. */
  settingsThrows?: boolean;
  /** ROK-1494 — the id of a live LFG-born session for the game, if any. */
  liveSessionEventId?: number;
}): Harness {
  const game =
    opts.game === undefined
      ? { name: 'Deep Rock Galactic', slug: 'drg' }
      : opts.game;
  const execute = jest
    .fn()
    .mockResolvedValue((opts.recipientIds ?? []).map((id) => ({ id })));
  const selectQueue: unknown[][] = [
    game ? [game] : [],
    (opts.liveIntentUserIds ?? []).map((userId) => ({ userId })),
    opts.liveSessionEventId === undefined
      ? []
      : [{ eventId: opts.liveSessionEventId }],
  ];
  const chain = makeSelectChain(selectQueue);
  const db = { execute, select: jest.fn(() => chain) };
  const rejectFor = new Set(opts.createRejectsFor ?? []);
  const create = jest.fn((body: { userId: number }) =>
    rejectFor.has(body.userId)
      ? Promise.reject(new Error('DM dispatch failed'))
      : Promise.resolve({ id: 'n1' }),
  );
  const checkAndMarkSent = opts.dedupThrows
    ? jest.fn().mockRejectedValue(new Error('Redis is down'))
    : jest.fn().mockResolvedValue(opts.alreadySent ?? false);
  const releaseKey = jest.fn().mockResolvedValue(undefined);
  const settingsService = {
    get: opts.settingsThrows
      ? jest.fn().mockRejectedValue(new Error('settings read failed'))
      : jest.fn().mockResolvedValue(opts.enabled === false ? 'false' : 'true'),
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Gamer Night' }),
  };
  const service = new LfgAffinityDmService(
    db as never,
    { create } as never,
    { checkAndMarkSent, releaseKey } as never,
    settingsService as never,
  );
  const errorLog = jest
    .spyOn(
      (service as unknown as { logger: { error: () => void } }).logger,
      'error',
    )
    .mockImplementation(() => undefined);
  const debugLog = jest
    .spyOn(
      (service as unknown as { logger: { debug: () => void } }).logger,
      'debug',
    )
    .mockImplementation(() => undefined);
  const warnLog = jest
    .spyOn(
      (service as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);
  return {
    service,
    create,
    checkAndMarkSent,
    releaseKey,
    execute,
    errorLog,
    debugLog,
    warnLog,
  };
}

/** Event names the class registers via `@OnEvent`, read back off the metadata. */
function registeredEvents(): string[] {
  const proto = LfgAffinityDmService.prototype as unknown as Record<
    string,
    unknown
  >;
  const events: string[] = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    const method = proto[key];
    if (typeof method !== 'function') continue;
    const meta: unknown = Reflect.getMetadata(
      'EVENT_LISTENER_METADATA',
      method,
    );
    const entries = Array.isArray(meta) ? meta : meta ? [meta] : [];
    for (const entry of entries) {
      const event = (entry as { event?: string }).event;
      if (event) events.push(event);
    }
  }
  return events;
}

describe('LfgAffinityDmService (ROK-1471 D11)', () => {
  const payload: LfgLfmReachedPayload = {
    gameId: 7,
    activeCount: 2,
    urgency: 'week',
    ttlMinutes: null,
  };

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

  it('invites game SUBSCRIBERS only — never inferred affinity from past signups', async () => {
    const h = makeService({ recipientIds: [11] });

    await h.service.handleLfmReached(payload);

    const issued = JSON.stringify(h.execute.mock.calls[0][0]);
    expect(issued).toContain('game_interests');
    expect(issued).not.toContain('event_signups');
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

  it('resolves instead of rejecting when a read throws — the emitter is fire-and-forget', async () => {
    const h = makeService({ settingsThrows: true, recipientIds: [11] });

    await expect(h.service.handleLfmReached(payload)).resolves.toBeUndefined();

    expect(h.create).not.toHaveBeenCalled();
    expect(h.errorLog).toHaveBeenCalledTimes(1);
    expect(String(h.errorLog.mock.calls[0][0])).toContain('7');
  });

  it('releases the dedup key of a rejected DM so the next wave retries it', async () => {
    const h = makeService({ recipientIds: [11, 22], createRejectsFor: [22] });

    await h.service.handleLfmReached(payload);

    expect(h.releaseKey).toHaveBeenCalledTimes(1);
    expect(h.releaseKey).toHaveBeenCalledWith('lfg-invite:game:7:user:22');
  });

  it('names the failed recipients in the dispatch warning', async () => {
    const h = makeService({ recipientIds: [11, 22], createRejectsFor: [22] });

    await h.service.handleLfmReached(payload);

    expect(h.warnLog).toHaveBeenCalledTimes(1);
    expect(String(h.warnLog.mock.calls[0][0])).toContain('22');
    expect(String(h.warnLog.mock.calls[0][0])).not.toContain('11');
  });

  it('does nothing when the game row has vanished', async () => {
    const h = makeService({ recipientIds: [11], game: null });

    await h.service.handleLfmReached(payload);

    expect(h.create).not.toHaveBeenCalled();
  });

  /**
   * ROK-1479 D10 — copy only. The `week` cases above are deliberately left
   * untouched: AC8(a) is "nothing else moved", and the way to prove that is a
   * green existing suite, not a rewritten one.
   */
  describe('ROK-1479 D10 — urgency picks the copy, never the policy', () => {
    // `true` is the value this spec's settings stub returns for the client URL;
    // `buildLfgInviteUrl` concatenates it, so it is the origin every case sees.
    // Typed as the payload the emitter actually produces, so a field this
    // copy depends on cannot be invented by the fixture: if
    // `LfgLfmReachedPayload` ever loses `ttlMinutes`, this stops compiling
    // instead of silently testing a shape no emit can send.
    const nowPayload: LfgLfmReachedPayload = {
      gameId: 7,
      activeCount: 2,
      urgency: 'now',
      ttlMinutes: 60,
    };

    it('says people want to play NOW and quotes the horizon', async () => {
      const h = makeService({ recipientIds: [11] });

      await h.service.handleLfmReached(nowPayload);

      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Deep Rock Galactic \u2014 2 want to play now',
          message: 'Playing in the next 60 minutes \u2014 join: true/lfg/drg',
        }),
      );
    });

    it('falls back to 30 minutes when the payload carries no TTL', async () => {
      const h = makeService({ recipientIds: [11] });

      await h.service.handleLfmReached({
        gameId: 7,
        activeCount: 2,
        urgency: 'now',
        ttlMinutes: null,
      });

      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('next 30 minutes') as unknown,
        }),
      );
    });

    it('leaves the weekly copy byte-identical', async () => {
      const h = makeService({ recipientIds: [11] });

      await h.service.handleLfmReached({ ...payload, urgency: 'week' });

      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Deep Rock Galactic \u2014 2 looking to play',
          message: 'Join the group: true/lfg/drg',
        }),
      );
    });

    it('treats a weekly payload as weekly whatever its TTL', async () => {
      const h = makeService({ recipientIds: [11] });

      await h.service.handleLfmReached(payload);

      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Deep Rock Galactic \u2014 2 looking to play',
        }),
      );
    });

    it('burns the SAME 14-day dedup key for a now wave (A12, unchanged)', async () => {
      const h = makeService({ recipientIds: [11] });

      await h.service.handleLfmReached(nowPayload);

      expect(h.checkAndMarkSent).toHaveBeenCalledWith(
        'lfg-invite:game:7:user:11',
        LFG_EXPIRY_DAYS * 86400,
      );
    });
  });
});

/**
 * ROK-1494 — the copy for a now-group whose session has already spawned.
 *
 * The branch is gated on BOTH the payload's urgency and the provenance read:
 * a game can have a live LFG-born session while a WEEKLY group forms around
 * the same game, and telling those subscribers "the voice channel is open"
 * would send them to a session their group has nothing to do with.
 *
 * Policy is untouched by design (ROK-1455 owns it): the dedup key, its TTL,
 * the cap and the `lfg_invite` opt-out are asserted identical to the wave
 * above, so a copy change can never smuggle a policy change in with it.
 */
describe('LfgAffinityDmService — a spawned now-group (ROK-1494)', () => {
  const nowPayload: LfgLfmReachedPayload = {
    gameId: 7,
    activeCount: 2,
    urgency: 'now',
    ttlMinutes: 60,
  };

  it('says the voice channel is open and links the group', async () => {
    const h = makeService({ recipientIds: [11], liveSessionEventId: 900 });

    await h.service.handleLfmReached(nowPayload);

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Deep Rock Galactic — playing now',
        message: 'The voice channel is open — join: true/lfg/drg',
      }),
    );
  });

  it('carries the session on the payload so the DM can deep-link later', async () => {
    const h = makeService({ recipientIds: [11], liveSessionEventId: 900 });

    await h.service.handleLfmReached(nowPayload);

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ eventId: 900 }) as unknown,
      }),
    );
  });

  it('changes no policy — same dedup key, same TTL', async () => {
    const h = makeService({ recipientIds: [11], liveSessionEventId: 900 });

    await h.service.handleLfmReached(nowPayload);

    expect(h.checkAndMarkSent).toHaveBeenCalledWith(
      'lfg-invite:game:7:user:11',
      LFG_EXPIRY_DAYS * 86400,
    );
  });

  it('keeps the ordinary now copy when nothing has spawned yet', async () => {
    const h = makeService({ recipientIds: [11] });

    await h.service.handleLfmReached(nowPayload);

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Playing in the next 60 minutes — join: true/lfg/drg',
      }),
    );
  });

  it('leaves a WEEKLY group alone even while a session is live', async () => {
    const h = makeService({ recipientIds: [11], liveSessionEventId: 900 });

    await h.service.handleLfmReached({
      gameId: 7,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });

    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Deep Rock Galactic — 2 looking to play',
        message: 'Join the group: true/lfg/drg',
      }),
    );
  });
});
