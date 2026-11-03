/**
 * ROK-1931 — the Deaths fixture's mod-reported death row: the mod shape the
 * check constraint demands, and a position the read's 5 m dedupe keeps
 * (more than 5 m from every one of `second`'s own Death pins).
 */
import { DEATHS_FIXTURE_CHARACTERS } from './valheim-deaths-demo-seed.data';
import {
  DEATHS_FIXTURE_REPORTED_XZ,
  reportedDeathValues,
} from './valheim-deaths-demo-seed.reported';

const NOW = new Date('2026-11-03T12:00:00Z');
const OWNER = {
  serverId: 7,
  name: 'Sigrunna',
  steamId: '76561198019300021',
  playerId: '1930000000021',
};

describe('deaths fixture reported death (ROK-1931)', () => {
  it('is a mod row with every column the mod shape check requires', () => {
    const row = reportedDeathValues(OWNER, NOW);
    expect(row).toMatchObject({
      source: 'mod',
      pelicanServerId: 7,
      steamId: OWNER.steamId,
      playerId: OWNER.playerId,
      worldUid: '1930193019301',
      x: DEATHS_FIXTURE_REPORTED_XZ.x,
      z: DEATHS_FIXTURE_REPORTED_XZ.z,
    });
    expect(row.reportedAt).toEqual(row.occurredAt);
    expect(row.occurredAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it("lies more than 5 m from every one of second's own Death pins", () => {
    const second = DEATHS_FIXTURE_CHARACTERS.find((c) => c.key === 'second');
    const deathPins = (second?.pins ?? []).filter((p) => p.type === 'Death');
    expect(deathPins.length).toBeGreaterThan(0);
    const { x, z } = DEATHS_FIXTURE_REPORTED_XZ;
    const nearest = Math.min(
      ...deathPins.map((p) => Math.hypot(p.x - x, p.z - z)),
    );
    expect(nearest).toBeGreaterThan(5);
  });
});
