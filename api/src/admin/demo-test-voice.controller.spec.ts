import { Test } from '@nestjs/testing';
import { DemoTestVoiceController } from './demo-test-voice.controller';
import { DemoTestService } from './demo-test.service';

function createMockService() {
  return {
    flushVoiceSessionsForTest: jest.fn().mockResolvedValue({ success: true }),
    injectVoiceSessionForTest: jest.fn().mockResolvedValue(undefined),
    triggerClassifyForTest: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DemoTestVoiceController', () => {
  let controller: DemoTestVoiceController;
  let mockService: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    mockService = createMockService();

    const module = await Test.createTestingModule({
      controllers: [DemoTestVoiceController],
      providers: [{ provide: DemoTestService, useValue: mockService }],
    }).compile();

    controller = module.get(DemoTestVoiceController);
  });

  it('flushVoiceSessions returns success', async () => {
    const result = await controller.flushVoiceSessionsForTest();
    expect(result).toMatchObject({ success: true });
    expect(mockService.flushVoiceSessionsForTest).toHaveBeenCalled();
  });

  it('injectVoiceSession delegates to service', async () => {
    const payload = {
      eventId: 1,
      discordUserId: '111',
      userId: 2,
      durationSec: 600,
    };
    const result = await controller.injectVoiceSessionForTest(payload);
    expect(result).toEqual({ success: true });
    expect(mockService.injectVoiceSessionForTest).toHaveBeenCalledWith(payload);
  });

  it('injectVoiceSession rejects invalid body', async () => {
    await expect(
      controller.injectVoiceSessionForTest({ eventId: -1 }),
    ).rejects.toThrow(/Validation failed/);
  });

  it('triggerClassify delegates to service', async () => {
    const result = await controller.triggerClassifyForTest({ eventId: 42 });
    expect(result).toEqual({ success: true });
    expect(mockService.triggerClassifyForTest).toHaveBeenCalledWith(42);
  });

  it('triggerClassify rejects missing eventId', async () => {
    await expect(controller.triggerClassifyForTest({})).rejects.toThrow(
      /Validation failed/,
    );
  });
});
