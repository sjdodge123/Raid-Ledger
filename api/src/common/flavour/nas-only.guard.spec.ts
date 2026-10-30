/** ROK-1700 — NasOnlyGuard: 404 under cloud, pass-through otherwise. */
import { NotFoundException } from '@nestjs/common';
import { NasOnlyGuard } from './nas-only.guard';

describe('ROK-1700 NasOnlyGuard', () => {
  const guard = new NasOnlyGuard();
  afterEach(() => delete process.env.RL_FLAVOUR);

  it('throws 404 under RL_FLAVOUR=cloud', () => {
    process.env.RL_FLAVOUR = 'cloud';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it.each([undefined, 'nas'])('passes when RL_FLAVOUR=%p', (value) => {
    if (value !== undefined) process.env.RL_FLAVOUR = value;
    expect(guard.canActivate()).toBe(true);
  });
});

// The demo-data routes' guard order is asserted in
// admin/demo-data-settings.controller.spec.ts (NasOnlyGuard first).
