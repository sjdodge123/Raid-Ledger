import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMultiMonitorChannels } from './use-multi-monitor-channels';
import type { ChannelBindingDto } from '@raid-ledger/contract';

function makeBinding(
  overrides: Partial<ChannelBindingDto> = {},
): ChannelBindingDto {
  return {
    id: 'uuid-1',
    guildId: 'guild-123',
    channelId: 'channel-456',
    channelName: 'general',
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: null,
    config: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useMultiMonitorChannels', () => {
  it('returns empty set when no bindings', () => {
    const { result } = renderHook(() => useMultiMonitorChannels([]));
    expect(result.current.size).toBe(0);
  });

  it('returns empty set when only one voice-monitor per channel', () => {
    const bindings = [
      makeBinding({
        id: 'b1',
        channelId: 'ch-1',
        bindingPurpose: 'game-voice-monitor',
      }),
    ];
    const { result } = renderHook(() => useMultiMonitorChannels(bindings));
    expect(result.current.size).toBe(0);
  });

  it('returns channel ID when two voice-monitors share a channel', () => {
    const bindings = [
      makeBinding({
        id: 'b1',
        channelId: 'ch-1',
        bindingPurpose: 'game-voice-monitor',
        gameId: 1,
      }),
      makeBinding({
        id: 'b2',
        channelId: 'ch-1',
        bindingPurpose: 'game-voice-monitor',
        gameId: 2,
      }),
    ];
    const { result } = renderHook(() => useMultiMonitorChannels(bindings));
    expect(result.current.has('ch-1')).toBe(true);
  });

  it('ignores non-voice-monitor bindings', () => {
    const bindings = [
      makeBinding({
        id: 'b1',
        channelId: 'ch-1',
        bindingPurpose: 'game-announcements',
      }),
      makeBinding({
        id: 'b2',
        channelId: 'ch-1',
        bindingPurpose: 'game-announcements',
      }),
    ];
    const { result } = renderHook(() => useMultiMonitorChannels(bindings));
    expect(result.current.size).toBe(0);
  });
});
