/** ROK-1931 (D8, Q5) — reported deaths → synthetic Death pins, deduped on own pins. */
import type { ValheimMapPin, ValheimReadMapPin } from '@raid-ledger/contract';
import {
  REPORTED_DEATH_PIN_RADIUS_M,
  withReportedDeathPins,
} from './valheim-reported-death-pins';

const AT = new Date('2026-11-02T21:14:00.000Z');
const own = (extra: Partial<ValheimMapPin> = {}): ValheimMapPin => ({
  type: 'Death',
  label: 'mine',
  x: 0,
  z: 0,
  checked: false,
  shared: false,
  ...extra,
});
const at = (x: number, z: number) => ({ x, z, reportedAt: AT });
const xs = (pins: readonly ValheimReadMapPin[]) =>
  pins.map((p) => `${p.x}${p.diedAt ? '*' : ''}`);

describe('withReportedDeathPins (ROK-1931)', () => {
  it('radius is 5 m (Q5)', () => {
    expect(REPORTED_DEATH_PIN_RADIUS_M).toBe(5);
  });

  it('drops a reported death within 5 m of an own Death pin, keeps one just past it', () => {
    const out = withReportedDeathPins([own()], [at(3, 4), at(3, 4.01)]);
    expect(xs(out)).toEqual(['0', '3*']);
    expect(out[1]).toEqual({
      type: 'Death',
      label: '',
      x: 3,
      z: 4.01,
      checked: false,
      shared: false,
      diedAt: AT.toISOString(),
    });
  });

  it('a shared (cartography) copy or a non-Death pin does not suppress it', () => {
    const pins = [own({ shared: true }), own({ type: 'Bed', x: 1 })];
    const out = withReportedDeathPins(pins, [at(0, 0)]);
    expect(xs(out)).toEqual(['0', '1', '0*']);
  });

  it('own pins come first, unchanged; no reported deaths → the same pins', () => {
    const pins = [own({ x: 9, label: 'a' }), own({ type: 'Icon0', x: 8 })];
    expect(withReportedDeathPins(pins, [])).toEqual(pins);
    expect(withReportedDeathPins(pins, [at(-50, 0)]).slice(0, 2)).toEqual(pins);
  });

  it('honours an explicit radius', () => {
    expect(xs(withReportedDeathPins([own()], [at(8, 0)], 10))).toEqual(['0']);
  });
});
