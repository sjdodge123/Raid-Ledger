import { Test } from '@nestjs/testing';
import { DemoTestSignupsController } from './demo-test-signups.controller';
import { DemoTestService } from './demo-test.service';

function createMockService() {
  return {
    createSignupForTest: jest.fn().mockResolvedValue({ id: 1 }),
    triggerDepartureForTest: jest.fn().mockResolvedValue(undefined),
    cancelSignupForTest: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DemoTestSignupsController', () => {
  let controller: DemoTestSignupsController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestSignupsController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestSignupsController);
  });

  it('createSignup delegates to service', async () => {
    const result = await controller.createSignupForTest({
      eventId: 1,
      userId: 2,
      preferredRoles: ['dps'],
      status: 'signed_up',
    });
    expect(result).toEqual({ id: 1 });
    expect(mockService.createSignupForTest).toHaveBeenCalledWith(1, 2, {
      preferredRoles: ['dps'],
      characterId: undefined,
      status: 'signed_up',
    });
  });

  it('createSignup rejects invalid eventId', async () => {
    await expect(
      controller.createSignupForTest({ eventId: -1, userId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('triggerDeparture delegates to service', async () => {
    const result = await controller.triggerDepartureForTest({
      eventId: 1,
      signupId: 2,
      discordUserId: '123',
    });
    expect(result).toEqual({ success: true });
    expect(mockService.triggerDepartureForTest).toHaveBeenCalledWith(
      1,
      2,
      '123',
    );
  });

  it('triggerDeparture rejects missing discordUserId', async () => {
    await expect(
      controller.triggerDepartureForTest({ eventId: 1, signupId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('cancelSignup delegates to service', async () => {
    const result = await controller.cancelSignupForTest({
      eventId: 1,
      userId: 2,
    });
    expect(result).toEqual({ success: true });
    expect(mockService.cancelSignupForTest).toHaveBeenCalledWith(1, 2);
  });

  it('cancelSignup rejects invalid body', async () => {
    await expect(
      controller.cancelSignupForTest({ eventId: 0, userId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });
});
