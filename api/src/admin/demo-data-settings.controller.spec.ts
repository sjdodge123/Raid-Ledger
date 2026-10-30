/**
 * ROK-1700 — the Demo Data admin routes live in their own controller so
 * NasOnlyGuard runs BEFORE the JWT guard: under RL_FLAVOUR=cloud even an
 * unauthenticated probe gets a 404, never a 401.
 */
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NasOnlyGuard } from '../common/flavour/nas-only.guard';
import { AdminGuard } from '../auth/admin.guard';
import { DemoDataSettingsController } from './demo-data-settings.controller';
import type { DemoDataService } from './demo-data.service';

describe('DemoDataSettingsController (ROK-1700)', () => {
  it('mounts under admin/settings/demo (route paths unchanged)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DemoDataSettingsController)).toBe(
      'admin/settings/demo',
    );
  });

  it('runs NasOnlyGuard first, then the JWT guard, then AdminGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      DemoDataSettingsController,
    ) as unknown[];
    expect(guards).toHaveLength(3);
    expect(guards[0]).toBe(NasOnlyGuard);
    expect(guards[2]).toBe(AdminGuard);
  });

  it('delegates status / install / clear to DemoDataService', async () => {
    const service = {
      getStatus: jest.fn().mockResolvedValue({ demoMode: true }),
      installDemoData: jest.fn().mockResolvedValue({ success: true }),
      clearDemoData: jest.fn().mockResolvedValue({ success: true }),
    };
    const controller = new DemoDataSettingsController(
      service as unknown as DemoDataService,
    );
    await expect(controller.getDemoStatus()).resolves.toEqual({
      demoMode: true,
    });
    await controller.installDemoData();
    await controller.clearDemoData();
    expect(service.installDemoData).toHaveBeenCalledTimes(1);
    expect(service.clearDemoData).toHaveBeenCalledTimes(1);
  });
});
