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

type MockService = ReturnType<typeof createMockService>;
type GetController = () => DemoTestSignupsController;
type GetMockService = () => MockService;

describe('DemoTestSignupsController', () => {
  let controller: DemoTestSignupsController;
  let mockService: MockService;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestSignupsController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestSignupsController);
  });

  const getController = () => controller;
  const getService = () => mockService;

  describe('createSignup', () => createSignupTests(getController, getService));
  describe('triggerDeparture', () =>
    triggerDepartureTests(getController, getService));
  describe('cancelSignup', () => cancelSignupTests(getController, getService));
});

function createSignupTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().createSignupForTest({
      eventId: 1,
      userId: 2,
      preferredRoles: ['dps'],
      status: 'signed_up',
    });
    expect(result).toEqual({ id: 1 });
    expect(getMock().createSignupForTest).toHaveBeenCalledWith(1, 2, {
      preferredRoles: ['dps'],
      characterId: undefined,
      status: 'signed_up',
    });
  });

  it('rejects invalid eventId', async () => {
    await expect(
      getController().createSignupForTest({ eventId: -1, userId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });
}

function triggerDepartureTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().triggerDepartureForTest({
      eventId: 1,
      signupId: 2,
      discordUserId: '123',
    });
    expect(result).toEqual({ success: true });
    expect(getMock().triggerDepartureForTest).toHaveBeenCalledWith(1, 2, '123');
  });

  it('rejects missing discordUserId', async () => {
    await expect(
      getController().triggerDepartureForTest({ eventId: 1, signupId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });
}

function cancelSignupTests(
  getController: GetController,
  getMock: GetMockService,
) {
  it('delegates to service', async () => {
    const result = await getController().cancelSignupForTest({
      eventId: 1,
      userId: 2,
    });
    expect(result).toEqual({ success: true });
    expect(getMock().cancelSignupForTest).toHaveBeenCalledWith(1, 2);
  });

  it('rejects invalid body', async () => {
    await expect(
      getController().cancelSignupForTest({ eventId: 0, userId: 2 }),
    ).rejects.toThrow(/Validation failed/);
  });
}
