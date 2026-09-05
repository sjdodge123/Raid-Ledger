/**
 * ROK-1374 (C1) — the privacy contract of the speed figure.
 *
 * Two things are asserted here and they are both privacy rules, not features:
 *
 *  1. Revoking consent deletes the DATUM, not just the permission (AC21/E19).
 *     Keeping the measurement after the user withdrew consent to measure it is
 *     precisely the failure a privacy review looks for.
 *  2. Only the four permitted values are ever written (AC20). The persisted
 *     payload is asserted key-by-key so an M-Lab server name, a latency series
 *     or a raw ndt7 result object cannot be smuggled in later without turning
 *     this test red.
 */
import { ForbiddenException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { ConnectionSpeedService } from './connection-speed.service';

const CONSENTED_ROW = {
  connectionDownstreamMbps: '940.00',
  connectionSpeedSource: 'ndt7',
  connectionSpeedMeasuredAt: new Date('2026-09-01T00:00:00.000Z'),
  speedTestConsentAt: new Date('2026-08-01T00:00:00.000Z'),
  shareDownloadEtaAt: null,
};

const UNCONSENTED_ROW = {
  connectionDownstreamMbps: null,
  connectionSpeedSource: null,
  connectionSpeedMeasuredAt: null,
  speedTestConsentAt: null,
  shareDownloadEtaAt: null,
};

let db: MockDb;
let service: ConnectionSpeedService;

beforeEach(() => {
  db = createDrizzleMock();
  service = new ConnectionSpeedService(db as never);
});

/** The single `.set({...})` payload the service handed to drizzle. */
function persistedPayload(): Record<string, unknown> {
  expect(db.set).toHaveBeenCalledTimes(1);
  return db.set.mock.calls[0][0] as Record<string, unknown>;
}

describe('ConnectionSpeedService.setConsent', () => {
  it('nulls the three speed columns as well as the consent stamp on revoke', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setConsent(7, false);

    expect(persistedPayload()).toEqual({
      speedTestConsentAt: null,
      connectionDownstreamMbps: null,
      connectionSpeedSource: null,
      connectionSpeedMeasuredAt: null,
      shareDownloadEtaAt: null,
    });
  });

  it('clears the roster-sharing flag on revoke — the datum it shares is gone', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setConsent(7, false);

    expect(persistedPayload().shareDownloadEtaAt).toBeNull();
  });

  it('leaves sharing untouched when the grant does not mention it', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setConsent(7, true);

    expect(Object.keys(persistedPayload())).not.toContain('shareDownloadEtaAt');
  });

  it('stamps sharing in the same call when the grant opts in', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setConsent(7, true, true);

    const payload = persistedPayload();
    expect(payload.shareDownloadEtaAt).toBeInstanceOf(Date);
    expect(payload.speedTestConsentAt).toBeInstanceOf(Date);
  });

  it('stamps consent without inventing a measurement on grant', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setConsent(7, true);

    const payload = persistedPayload();
    expect(payload.speedTestConsentAt).toBeInstanceOf(Date);
    expect(Object.keys(payload)).toEqual(['speedTestConsentAt']);
  });
});

describe('ConnectionSpeedService.setEtaSharing', () => {
  it('stamps the share flag and touches nothing else', async () => {
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setEtaSharing(7, true);

    const payload = persistedPayload();
    expect(Object.keys(payload)).toEqual(['shareDownloadEtaAt']);
    expect(payload.shareDownloadEtaAt).toBeInstanceOf(Date);
  });

  it('nulls the share flag on opt-out without deleting the measurement', async () => {
    db.returning.mockResolvedValue([CONSENTED_ROW]);

    await service.setEtaSharing(7, false);

    expect(persistedPayload()).toEqual({ shareDownloadEtaAt: null });
  });
});

describe('ConnectionSpeedService.setSpeed', () => {
  it('persists exactly the four permitted values — no M-Lab artefacts', async () => {
    db.limit.mockResolvedValue([CONSENTED_ROW]);
    db.returning.mockResolvedValue([CONSENTED_ROW]);

    await service.setSpeed(7, { downstreamMbps: 940, source: 'ndt7' });

    const payload = persistedPayload();
    expect(Object.keys(payload).sort()).toEqual([
      'connectionDownstreamMbps',
      'connectionSpeedMeasuredAt',
      'connectionSpeedSource',
    ]);
    expect(payload.connectionDownstreamMbps).toBe('940');
    expect(payload.connectionSpeedSource).toBe('ndt7');
  });

  it('refuses an ndt7 figure from a user who never consented', async () => {
    db.limit.mockResolvedValue([UNCONSENTED_ROW]);

    await expect(
      service.setSpeed(7, { downstreamMbps: 940, source: 'ndt7' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('accepts a hand-entered figure without consent — typing a number is not a measurement', async () => {
    db.limit.mockResolvedValue([UNCONSENTED_ROW]);
    db.returning.mockResolvedValue([UNCONSENTED_ROW]);

    await service.setSpeed(7, { downstreamMbps: 50, source: 'manual' });

    expect(persistedPayload().connectionSpeedSource).toBe('manual');
  });
});

describe('ConnectionSpeedService.get', () => {
  it('reports an unmeasured user as all-null rather than 404ing', async () => {
    db.limit.mockResolvedValue([UNCONSENTED_ROW]);

    await expect(service.get(7)).resolves.toEqual({
      downstreamMbps: null,
      source: null,
      measuredAt: null,
      consentAt: null,
      shareEtaAt: null,
    });
  });

  it('reports the sharing stamp as an ISO string once the user opts in', async () => {
    db.limit.mockResolvedValue([
      {
        ...CONSENTED_ROW,
        shareDownloadEtaAt: new Date('2026-09-05T10:00:00.000Z'),
      },
    ]);

    await expect(service.get(7)).resolves.toMatchObject({
      shareEtaAt: '2026-09-05T10:00:00.000Z',
    });
  });
});
