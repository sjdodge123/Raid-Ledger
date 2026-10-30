/** ROK-1700 — NasOnlyGuard: 404 under cloud, pass-through otherwise. */
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminSettingsController } from '../../admin/settings.controller';
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

describe('ROK-1700 demo-data routes are NAS-only (Lead ruling)', () => {
  it.each(['getDemoStatus', 'installDemoData', 'clearDemoData'] as const)(
    '%s carries NasOnlyGuard',
    (method) => {
      const handler = AdminSettingsController.prototype[method];
      const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
      expect(guards).toEqual([NasOnlyGuard]);
    },
  );
});
