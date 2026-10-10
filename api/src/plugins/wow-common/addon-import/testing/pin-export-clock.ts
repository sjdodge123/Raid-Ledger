import { exportClock } from '../addon-import.clock';
import { FIXTURE_EXPORTED_AT } from './addon-fixture.builder';

/** Fixture "now": one hour after the golden fixtures' export stamp. */
export const FIXTURE_NOW_MS = (FIXTURE_EXPORTED_AT + 3600) * 1000;

/**
 * ROK-1756 — pin the export-time bound's clock for every test in the calling
 * spec file. The golden fixtures (ledgerlink v1 + the builder) are dated
 * 2026-09-21; without this they fail the 1-year bound after 2027-09-21.
 * Call once at the top level of a spec; it registers its own hooks. Works in
 * integration specs too: the app reads `exportClock.nowMs` at call time.
 */
export function pinExportClock(nowMs: number = FIXTURE_NOW_MS): void {
  let spy: jest.SpyInstance<number, []> | undefined;
  beforeEach(() => {
    spy = jest.spyOn(exportClock, 'nowMs').mockReturnValue(nowMs);
  });
  afterEach(() => spy?.mockRestore());
}
