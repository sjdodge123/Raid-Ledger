import {
  collectInitHookTargets,
  formatProviderLine,
  wrapProviderInitHook,
} from './integration-provider-timer';

/** Fake clock: each read advances by `step` ms. */
function stepClock(step: number): () => number {
  let t = 0;
  return (): number => (t += step);
}

describe('integration provider timer — wrapProviderInitHook (ROK-2196)', () => {
  it('records a provider onModuleInit duration under its name', async () => {
    const totals = new Map<string, number>();
    const original = jest.fn((): Promise<void> => Promise.resolve());
    const instance = { onModuleInit: original };
    wrapProviderInitHook(instance, 'SlowSeeder', totals, stepClock(100));
    await instance.onModuleInit();
    expect(original).toHaveBeenCalledTimes(1);
    expect(totals.get('SlowSeeder')).toBe(100);
  });

  it('still records and rethrows when the hook throws', async () => {
    const totals = new Map<string, number>();
    const instance = {
      onModuleInit: (): Promise<void> => Promise.reject(new Error('boom')),
    };
    wrapProviderInitHook(instance, 'Broken', totals, stepClock(7));
    await expect(instance.onModuleInit()).rejects.toThrow('boom');
    expect(totals.get('Broken')).toBe(7);
  });

  it('keeps `this` bound to the provider instance', async () => {
    const totals = new Map<string, number>();
    const instance = {
      seen: 0,
      onModuleInit(): void {
        this.seen += 1;
      },
    };
    wrapProviderInitHook(instance, 'Bound', totals, stepClock(1));
    await Promise.resolve(instance.onModuleInit());
    expect(instance.seen).toBe(1);
  });
});

describe('integration provider timer — collect + format (ROK-2196)', () => {
  it('collects each hooked instance once, skipping hookless ones', () => {
    const shared = { onModuleInit: (): void => undefined };
    const modules = [
      {
        providers: new Map<unknown, { name?: unknown; instance?: unknown }>([
          ['A', { name: 'A', instance: shared }],
          ['B', { name: 'B', instance: { other: 1 } }],
          ['C', { name: 'C', instance: null }],
        ]),
        controllers: new Map(),
      },
      {
        providers: new Map([['A2', { name: 'A2', instance: shared }]]),
        controllers: new Map([
          [
            'Ctl',
            { name: 'Ctl', instance: { onModuleInit: (): void => undefined } },
          ],
        ]),
      },
    ];
    const names = collectInitHookTargets(modules).map((t) => t.name);
    expect(names).toEqual(['A', 'Ctl']);
  });

  it('formats slowest first, above the floor, capped at the limit', () => {
    const totals = new Map([
      ['Fast', 5],
      ['WowCommonModule', 1203.4],
      ['Settings', 40],
      ['Mid', 300],
    ]);
    expect(
      formatProviderLine('a.spec.ts', totals, { limit: 2, minMs: 10 }),
    ).toBe(
      '[phase-timing:providers] a.spec.ts WowCommonModule=1203ms Mid=300ms',
    );
  });
});
