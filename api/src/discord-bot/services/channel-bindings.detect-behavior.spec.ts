/**
 * channel-bindings.detect-behavior.spec.ts
 *
 * Tests for ROK-515 addition to ChannelBindingsService.detectBehavior():
 * - voice + no gameId → 'general-lobby' (new behavior)
 * - voice + gameId → 'game-voice-monitor' (existing behavior, unchanged)
 * - text → 'game-announcements' (existing behavior, unchanged)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ChannelBindingsService } from './channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('ChannelBindingsService.detectBehavior (ROK-515)', () => {
  let service: ChannelBindingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelBindingsService,
        {
          provide: DrizzleAsyncProvider,
          useValue: {}, // detectBehavior doesn't use the DB
        },
      ],
    }).compile();

    service = module.get(ChannelBindingsService);
  });

  it('returns "general-lobby" for voice channel with no gameId', () => {
    expect(service.detectBehavior('voice')).toBe('general-lobby');
  });

  it('returns "general-lobby" for voice channel when gameId is null', () => {
    expect(service.detectBehavior('voice', null)).toBe('general-lobby');
  });

  it('returns "game-voice-monitor" for voice channel with a gameId', () => {
    expect(service.detectBehavior('voice', 42)).toBe('game-voice-monitor');
  });

  it('returns "game-announcements" for text channel regardless of gameId', () => {
    expect(service.detectBehavior('text')).toBe('game-announcements');
    expect(service.detectBehavior('text', null)).toBe('game-announcements');
    expect(service.detectBehavior('text', 99)).toBe('game-announcements');
  });

  it('returns "game-announcements" as default for unknown channel types', () => {
    // Default case in the switch statement
    expect(service.detectBehavior('unknown' as any)).toBe('game-announcements');
  });
});
