/**
 * ROK-2369 — the deactivated-plugin spec's helpers can fail. A handler whose
 * active check is deleted must be reported even when it does nothing on the
 * probe (the vacuous case), a fire-and-forget write must land inside the
 * watch window, and a probe crash must not pass as "no effects".
 */
import * as path from 'path';
import {
  probeTarget,
  targetProblems,
  type ActiveGate,
} from './plugin-deactivate-effects';
import {
  checkedHandlerTargets,
  loadRawSources,
  scopedCronTargets,
} from './plugin-deactivate-inventory';

async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function fakeDb() {
  return {
    insert: jest.fn(() => undefined),
    update: jest.fn(() => undefined),
    delete: jest.fn(() => undefined),
    transaction: jest.fn(() => undefined),
    execute: jest.fn(() => undefined),
  };
}

const CRASH_MESSAGE = "Cannot read properties of undefined (reading 'id')";

const gate: ActiveGate = {
  isActive: (slug: string) => slug === 'core',
  getActiveSlugsSync: () => new Set<string>(['core']),
};

/** A listener; `checked: false` is the same handler with its check deleted. */
class FakeListener {
  constructor(
    private readonly db: ReturnType<typeof fakeDb>,
    private readonly checked: boolean,
    private readonly writes: boolean,
  ) {}

  handle(payload: { slug: string }): void {
    if (payload.slug !== 'valheim') return;
    if (this.checked && !gate.isActive('valheim')) return;
    if (this.writes) void this.work();
  }

  crash(): void {
    throw new TypeError("Cannot read properties of undefined (reading 'id')");
  }

  /** Crashes on the bare probe (slug filter), reaches the gate on a slug. */
  slugFirst(payload: { slug: string }): void {
    if (payload.slug === 'probe') throw new TypeError(CRASH_MESSAGE);
    if (!gate.isActive('valheim')) return;
  }

  /** Consults the gate, then crashes: a real leak while off. */
  crashAfterGate(): void {
    gate.isActive('valheim');
    throw new TypeError(CRASH_MESSAGE);
  }

  /** Consults the gate, then starts a same-instance helper that crashes. */
  gateThenCrashLater(): void {
    if (!gate.isActive('valheim')) void this.crashLater();
  }

  private async crashLater(): Promise<void> {
    await ticks(3);
    throw new TypeError(CRASH_MESSAGE);
  }

  private async work(): Promise<void> {
    await ticks(5);
    this.db.insert();
  }
}

const PAYLOADS = [{ slug: 'probe' }, { slug: 'valheim' }];
const NEVER = 'k: never consulted isActive/getActiveSlugsSync';

async function problems(
  checked: boolean,
  writes: boolean,
  method = 'handle',
  requireGate = true,
): Promise<string[]> {
  const db = fakeDb();
  const instance = new FakeListener(db, checked, writes);
  const r = await probeTarget(
    { key: 'k', instance, method },
    { db, gate },
    PAYLOADS,
  );
  return targetProblems(r, { requireGate });
}

describe('ROK-2369 deactivate probe', () => {
  it('passes a handler that consults the gate (after its slug filter)', async () => {
    expect(await problems(true, true)).toEqual([]);
  });

  it('reports a handler whose active check was deleted, even when it does nothing', async () => {
    expect(await problems(false, false)).toEqual([NEVER]);
  });

  it('catches a fire-and-forget write landing several ticks later', async () => {
    expect(await problems(false, true)).toEqual(['k: db.insert×1', NEVER]);
  });

  const crash = `TypeError: ${CRASH_MESSAGE}`;

  it('names the crash when a handler never reaches the gate', async () => {
    expect(await problems(true, false, 'crash')).toEqual([
      `${NEVER} (last throw: ${crash})`,
    ]);
  });

  it('reports an ungated crash when the gate is not required (crons)', async () => {
    expect(await problems(true, false, 'crash', false)).toEqual([
      `k: threw ${crash}`,
    ]);
  });

  it('does not fail a crash on the bare probe when a later payload reaches the gate', async () => {
    expect(await problems(true, false, 'slugFirst')).toEqual([]);
  });

  it('reports a crash after the gate was consulted', async () => {
    expect(await problems(true, false, 'crashAfterGate')).toEqual([
      `k: threw ${crash}`,
    ]);
  });

  it('reports a fire-and-forget helper that rejects after the gate (Codex P2)', async () => {
    expect(await problems(true, false, 'gateThenCrashLater')).toEqual([
      `k: threw ${crash}`,
    ]);
  });

  it('restores the instance after the probe', async () => {
    const db = fakeDb();
    const instance = new FakeListener(db, true, true);
    const t = { key: 'k', instance, method: 'handle' };
    await probeTarget(t, { db, gate }, PAYLOADS);
    expect(Object.getOwnPropertyNames(instance)).toEqual([
      'db',
      'checked',
      'writes',
    ]);
  });
});

describe('ROK-2369 deactivate inventory', () => {
  it('a @Cron inside a comment does not mint a cron target', () => {
    const text = [
      'export class Sweeper {',
      "  // legacy: @Cron('0 * * * *')",
      '  sweep(): void {}',
      '}',
    ].join('\n');
    const raw = [{ file: 'plugins/valheim/sweeper.ts', text }];
    expect(scopedCronTargets(raw, new Map())).toEqual({
      targets: [],
      unresolved: [],
      skipped: [],
    });
  });

  it('pins every checked handler and how it reaches its gate', () => {
    const raw = loadRawSources(path.resolve(__dirname, '../..'));
    const index = new Map<string, object>([
      ['ValheimSteamLinkListener', { handleLinked: () => undefined }],
      ['ValheimClaimSuggestListener', { onBotConnected: () => undefined }],
      ['ServerHubMembershipService', { onPresenceChanged: () => undefined }],
    ]);
    const inv = checkedHandlerTargets(raw, index);
    const dir = 'plugins/valheim/armory/identity';
    expect(inv.unresolved).toEqual([]);
    expect(inv.targets.map((t) => [t.key, t.gate])).toEqual([
      [
        'plugins/pelican/hub/server-hub-membership.service.ts#onPresenceChanged',
        'direct',
      ],
      [`${dir}/valheim-claim-suggest.listener.ts#onBotConnected`, 'callback'],
      [`${dir}/valheim-steam-link.listener.ts#handleLinked`, 'direct'],
    ]);
  });

  it('pins the gateway callbacks the integration spec cannot fire', () => {
    const raw = loadRawSources(path.resolve(__dirname, '../..'));
    // A new gateway callback lands here: give it its own unit coverage.
    expect(checkedHandlerTargets(raw, new Map()).skipped).toEqual([
      'plugins/valheim/armory/identity/valheim-claim-suggest.listener.ts#interactionCreate[0]',
    ]);
  });
});
