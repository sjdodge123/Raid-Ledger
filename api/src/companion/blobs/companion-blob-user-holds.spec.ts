/** Tech-debt 2026-10-27 — the per-user live-hold ledger behind the quota check. */
import { CompanionBlobUserHolds } from './companion-blob-user-holds';

describe('CompanionBlobUserHolds', () => {
  it('counts live holds against the quota and frees them on release', () => {
    const holds = new CompanionBlobUserHolds();
    const a = holds.tryHold(7, 100, 100, 150);
    expect(a).not.toBeNull();
    expect(holds.bytes(7)).toBe(100);
    expect(holds.tryHold(7, 100, 100, 150)).toBeNull();
    a?.();
    expect(holds.bytes(7)).toBe(0);
    expect(holds.tryHold(7, 100, 100, 150)).not.toBeNull();
  });

  it('keeps users apart', () => {
    const holds = new CompanionBlobUserHolds();
    holds.tryHold(7, 100, 100, 150);
    expect(holds.tryHold(8, 100, 100, 150)).not.toBeNull();
    expect(holds.bytes(8)).toBe(100);
  });

  it('a release is idempotent and never frees another upload’s bytes', () => {
    const holds = new CompanionBlobUserHolds();
    const a = holds.tryHold(7, 0, 40, 150);
    holds.tryHold(7, 0, 60, 150);
    a?.();
    a?.();
    expect(holds.bytes(7)).toBe(60);
  });

  it('a chunked upload (declared 0) is refused once live holds alone exceed the quota', () => {
    const holds = new CompanionBlobUserHolds();
    expect(holds.tryHold(7, 0, 100, 150)).not.toBeNull();
    expect(holds.tryHold(7, 0, 100, 150)).not.toBeNull();
    expect(holds.tryHold(7, 0, 100, 150)).toBeNull();
  });
});
