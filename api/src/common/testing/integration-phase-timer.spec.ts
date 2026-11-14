import {
  PHASE_TIMING_ENV,
  addPhase,
  beginPhaseTiming,
  createPhaseTimings,
  formatPhaseLine,
  instrumentLifecycleHooks,
  phaseMark,
  recordMigrate,
  recordPhase,
  reportPhaseTiming,
} from './integration-phase-timer';

describe('integration-phase-timer formatting (ROK-2196)', () => {
  it('accumulates sum and count per phase', () => {
    const t = createPhaseTimings(0);
    addPhase(t, 'truncate', 10.5);
    addPhase(t, 'truncate', 20.25);
    expect(t.phases.truncate).toEqual({ ms: 30.75, count: 2 });
  });

  it('formats every phase into one line', () => {
    const t = createPhaseTimings(100);
    addPhase(t, 'import', 812.3);
    addPhase(t, 'module', 1234);
    addPhase(t, 'init', 456);
    addPhase(t, 'moduleInit', 300);
    addPhase(t, 'bootstrap', 50);
    addPhase(t, 'migrate', 70);
    addPhase(t, 'truncate', 100);
    addPhase(t, 'truncate', 110);
    addPhase(t, 'drain', 5);
    addPhase(t, 'close', 300);
    expect(formatPhaseLine('src/a.integration.spec.ts', t, 4100)).toBe(
      '[phase-timing] src/a.integration.spec.ts import=812ms module=1234ms ' +
        'init=456ms(onModuleInit=300ms onApplicationBootstrap=50ms) ' +
        'migrate=70ms truncate=210ms(×2) drain=5ms close=300ms total=4000ms',
    );
  });

  it('prints n/a, skipped and a zero truncate count for missing phases', () => {
    const t = createPhaseTimings(0);
    t.migrateSkipped = true;
    expect(formatPhaseLine('x', t, 10)).toBe(
      '[phase-timing] x import=n/a module=n/a init=n/a migrate=skipped ' +
        'truncate=0ms(×0) drain=n/a close=n/a total=10ms',
    );
  });
});

describe('integration-phase-timer env gate (ROK-2196)', () => {
  const original = process.env[PHASE_TIMING_ENV];
  let write: jest.SpyInstance;

  beforeEach(() => {
    write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    write.mockRestore();
    if (original === undefined) delete process.env[PHASE_TIMING_ENV];
    else process.env[PHASE_TIMING_ENV] = original;
  });

  it('records nothing and prints nothing when the env var is unset', () => {
    delete process.env[PHASE_TIMING_ENV];
    const start = beginPhaseTiming();
    recordPhase('module', start);
    recordMigrate(start, false);
    const app = { callInitHook: jest.fn() };
    const hook = app.callInitHook;
    instrumentLifecycleHooks(app);
    reportPhaseTiming('/x/spec.ts');
    expect(app.callInitHook).toBe(hook);
    expect(write).not.toHaveBeenCalled();
  });

  it('writes exactly one stderr line per file when enabled', async () => {
    process.env[PHASE_TIMING_ENV] = '1';
    beginPhaseTiming();
    recordPhase('truncate', phaseMark());
    recordMigrate(phaseMark(), false);
    const app = { callInitHook: jest.fn(() => Promise.resolve()) };
    instrumentLifecycleHooks(app);
    await app.callInitHook();
    reportPhaseTiming(`${process.cwd()}/src/a.integration.spec.ts`);
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).toMatch(
      /^\[phase-timing\] src\/a\.integration\.spec\.ts import=n\/a .*init=n\/a migrate=skipped truncate=\d+ms\(×1\) .*total=\d+ms\n$/,
    );
  });
});
