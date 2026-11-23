import { Test } from '@nestjs/testing';
import { DemoTestSignupsController } from './demo-test-signups.controller';
import { ModuleRef } from '@nestjs/core';
import { DemoTestService } from './demo-test.service';
import { SignupsService } from '../events/signups.service';

function createMockService() {
  return {
    createSignupForTest: jest.fn().mockResolvedValue({ id: 1 }),
    triggerDepartureForTest: jest.fn().mockResolvedValue(undefined),
    cancelSignupForTest: jest.fn().mockResolvedValue(undefined),
  };
}

type MockService = ReturnType<typeof createMockService>;
type UpdateStatus = jest.Mock<Promise<{ id: number }>, unknown[]>;
type GetController = () => DemoTestSignupsController;
type GetMockService = () => MockService;

describe('DemoTestSignupsController', () => {
  let controller: DemoTestSignupsController;
  let mockService: MockService;
  let updateStatus: UpdateStatus;

  beforeEach(async () => {
    mockService = createMockService();
    updateStatus = jest.fn().mockResolvedValue({ id: 9 });
    const moduleRef = {
      get: jest.fn((token: unknown) =>
        token === SignupsService ? { updateStatus } : {},
      ),
    };

    const module = await Test.createTestingModule({
      controllers: [DemoTestSignupsController],
      providers: [
        { provide: DemoTestService, useValue: mockService },
        { provide: ModuleRef, useValue: moduleRef },
      ],
    }).compile();

    controller = module.get(DemoTestSignupsController);
  });

  const getController = () => controller;
  const getService = () => mockService;

  describe('createSignup', () => createSignupTests(getController, getService));
  describe('triggerDeparture', () =>
    triggerDepartureTests(getController, getService));
  describe('cancelSignup', () => cancelSignupTests(getController, getService));
  describe('signupStatus (ROK-2275)', () =>
    signupStatusTests(getController, () => updateStatus));
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

function signupStatusTests(
  getController: GetController,
  getUpdateStatus: () => UpdateStatus,
) {
  it('changes any user status through SignupsService.updateStatus', async () => {
    const result = await getController().signupStatusForTest({
      eventId: 4,
      userId: 8,
      status: 'tentative',
    });
    expect(result).toEqual({ id: 9 });
    expect(getUpdateStatus()).toHaveBeenCalledWith(
      4,
      { userId: 8 },
      { status: 'tentative' },
    );
  });

  it('rejects a status other than signed_up / tentative', async () => {
    await expect(
      getController().signupStatusForTest({
        eventId: 4,
        userId: 8,
        status: 'declined',
      }),
    ).rejects.toThrow(/Validation failed/);
    expect(getUpdateStatus()).not.toHaveBeenCalled();
  });

  it('rejects a missing userId', async () => {
    await expect(
      getController().signupStatusForTest({ eventId: 4, status: 'signed_up' }),
    ).rejects.toThrow(/Validation failed/);
    expect(getUpdateStatus()).not.toHaveBeenCalled();
  });
}
