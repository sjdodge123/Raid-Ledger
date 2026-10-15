/**
 * ROK-1779 — the public GET /system/status serves the api's telemetry decision
 * (opt-in: ENABLE_TELEMETRY='true', DISABLE_TELEMETRY='true' wins) so the web
 * app initialises Sentry only when the instance opted in. Read per request, so
 * flipping the env vars here is observable.
 */
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
  });

  it('is false when nothing is set (opt-in default)', async () => {
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(false);
  });

  it("is true when ENABLE_TELEMETRY='true'", async () => {
    process.env.ENABLE_TELEMETRY = 'true';
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(true);
  });

  it('is false when DISABLE_TELEMETRY is also true (disable wins)', async () => {
    process.env.ENABLE_TELEMETRY = 'true';
    process.env.DISABLE_TELEMETRY = 'true';
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(false);
  });
});
