/**
 * ROK-1779 — the public GET /system/status serves the api's telemetry decision
 * (opt-in: ENABLE_TELEMETRY='true', DISABLE_TELEMETRY='true' wins) so the web
 * app initialises Sentry only when the instance opted in.
 *
 * The endpoint serves the decision instrument.ts recorded at boot, never a
 * live env read. The test app DOES load instrument.ts — backup.helpers.ts
 * imports scripts/run-migrations-with-sentry.ts, whose first import is
 * instrument — so a decision is already recorded (from whatever env jest
 * started with) before these cases run. Each case therefore sets the env and
 * re-runs the boot resolution, exactly as instrument.ts does at startup, and
 * asserts the endpoint serves that decision. The gate's own use of it is
 * covered by instrument-telemetry-gate.spec.ts.
 */
import { resolveBootTelemetry } from '../sentry/telemetry-policy';
import { getTestApp, type TestApp } from '../common/testing/test-app';

const KEYS = ['DISABLE_TELEMETRY', 'ENABLE_TELEMETRY'] as const;

describe('ROK-1779 — GET /system/status telemetryEnabled', () => {
  let testApp: TestApp;
  const saved: Partial<Record<(typeof KEYS)[number], string>> = {};

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(() => {
    for (const key of KEYS) {
      const value = process.env[key];
      if (value === undefined) delete saved[key];
      else saved[key] = value;
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resolveBootTelemetry();
  });

  /** Set the env, then record the boot decision as instrument.ts does. */
  function bootWith(env: Partial<Record<(typeof KEYS)[number], string>>) {
    Object.assign(process.env, env);
    resolveBootTelemetry();
  }

  it('is false when nothing is set (opt-in default)', async () => {
    bootWith({});
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(false);
  });

  it("is true when ENABLE_TELEMETRY='true'", async () => {
    bootWith({ ENABLE_TELEMETRY: 'true' });
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(true);
  });

  it('is false when DISABLE_TELEMETRY is also true (disable wins)', async () => {
    bootWith({ ENABLE_TELEMETRY: 'true', DISABLE_TELEMETRY: 'true' });
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(false);
  });
});
