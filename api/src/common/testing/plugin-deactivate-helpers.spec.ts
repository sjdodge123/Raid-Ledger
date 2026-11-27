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
): Promise<string[]> {
  const db = fakeDb();
  const instance = new FakeListener(db, checked, writes);
  const r = await probeTarget(
    { key: 'k', instance, method },
    { db, gate },
    PAYLOADS,
  );
  return targetProblems(r, { requireGate: true });
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

  it('reports a probe crash instead of swallowing it', async () => {
    const crash =
      "TypeError: Cannot read properties of undefined (reading 'id')";
    expect(await problems(true, false, 'crash')).toEqual([
      `k: threw ${crash}`,
      `k: threw ${crash}`,
      `${NEVER} (last throw: ${crash})`,
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

  it('pins the gateway callbacks the integration spec cannot fire', () => {
    const raw = loadRawSources(path.resolve(__dirname, '../..'));
    expect(checkedHandlerTargets(raw, new Map()).skipped).toEqual([]);
  });
});
