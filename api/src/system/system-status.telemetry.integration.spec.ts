/**
 * ROK-1779 — the public GET /system/status serves the api's DISABLE_TELEMETRY
 * decision so the web app initialises Sentry only when the instance allows
 * it. Read per request, so flipping the env var here is observable.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';

describe('ROK-1779 — GET /system/status telemetryEnabled', () => {
  let testApp: TestApp;
  let saved: string | undefined;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(() => {
    saved = process.env.DISABLE_TELEMETRY;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DISABLE_TELEMETRY;
    else process.env.DISABLE_TELEMETRY = saved;
  });

  it('is true when DISABLE_TELEMETRY is unset (opt-out default)', async () => {
    delete process.env.DISABLE_TELEMETRY;
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(true);
  });

  it("is false when DISABLE_TELEMETRY='true'", async () => {
    process.env.DISABLE_TELEMETRY = 'true';
    const res = await testApp.request.get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.telemetryEnabled).toBe(false);
  });
});
