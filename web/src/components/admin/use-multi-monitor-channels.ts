import { useMemo } from 'react';
import type { ChannelBindingDto } from '@raid-ledger/contract';

/**
 * Compute the set of channel IDs that have multiple game-voice-monitor bindings.
 * Used to show a warning in the channel binding list.
 */
export function useMultiMonitorChannels(
  bindings: ChannelBindingDto[],
): Set<string> {
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bindings) {
      if (b.bindingPurpose !== 'game-voice-monitor') continue;
      counts.set(b.channelId, (counts.get(b.channelId) ?? 0) + 1);
    }
    const result = new Set<string>();
    for (const [chId, count] of counts) {
      if (count >= 2) result.add(chId);
    }
    return result;
  }, [bindings]);
}
