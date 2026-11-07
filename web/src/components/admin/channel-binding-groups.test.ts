/** ROK-2106 — grouping channel bindings by Discord channel (id + kind). */
import { describe, it, expect } from 'vitest';
import type { ChannelBindingDto } from '@raid-ledger/contract';
import { at } from '../../test/defined';
import { groupBindingsByChannel } from './channel-binding-groups';

function b(overrides: Partial<ChannelBindingDto>): ChannelBindingDto {
    return {
        id: 'b', guildId: 'g', channelId: 'c', channelName: 'chan', channelType: 'text',
        bindingPurpose: 'game-announcements', gameId: 1, gameName: 'Game', config: null,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
    };
}

const WOW_FOREVER = b({ id: 'wow-f', channelId: 'wow-t', channelName: 'wow', gameName: 'WoW: Forever' });
const GENERAL = b({ id: 'gen', channelId: 'gen-t', channelName: 'general', bindingPurpose: 'general-lobby', gameId: null });
const WOW_BCC = b({ id: 'wow-b', channelId: 'wow-t', channelName: 'wow', gameName: 'BCC Anniversary' });
const WOW_VOICE_F = b({ id: 'wv-f', channelId: 'wow-v', channelName: 'WoW', channelType: 'voice', bindingPurpose: 'game-voice-monitor' });
const WOW_VOICE_B = b({ id: 'wv-b', channelId: 'wow-v', channelName: 'WoW', channelType: 'voice', bindingPurpose: 'game-voice-monitor', gameId: 2 });

const ids = (rows: ChannelBindingDto[]): string[] => rows.map((r) => r.id);

describe('groupBindingsByChannel', () => {
    it('returns no groups for no bindings', () => {
        expect(groupBindingsByChannel([])).toEqual([]);
    });

    it('collects a channel\'s scattered bindings into one group, in API order', () => {
        const groups = groupBindingsByChannel([WOW_FOREVER, GENERAL, WOW_BCC]);
        expect(groups.map((g) => g.channelName)).toEqual(['general', 'wow']);
        expect(ids(at(groups, 1).bindings)).toEqual(['wow-f', 'wow-b']);
    });

    it('keeps a single-binding channel as a group of one', () => {
        const groups = groupBindingsByChannel([GENERAL]);
        expect(groups).toHaveLength(1);
        expect(ids(at(groups, 0).bindings)).toEqual(['gen']);
    });

    it('splits a text and a voice channel with the same name, text first', () => {
        const groups = groupBindingsByChannel([WOW_VOICE_F, WOW_FOREVER]);
        expect(groups.map((g) => `${g.channelType}:${g.channelId}`)).toEqual(['text:wow-t', 'voice:wow-v']);
    });

    it('orders groups by name case-insensitively and falls back to the channel id', () => {
        const unnamed = b({ id: 'u', channelId: 'aaa-id', channelName: undefined });
        const upper = b({ id: 'z', channelId: 'z-id', channelName: 'Zebra' });
        const lower = b({ id: 'm', channelId: 'm-id', channelName: 'mango' });
        const groups = groupBindingsByChannel([upper, lower, unnamed]);
        expect(groups.map((g) => g.displayName)).toEqual(['aaa-id', 'mango', 'Zebra']);
    });

    it('carries the lifecycle from the first auto-managed binding', () => {
        const auto = b({ id: 'auto', channelId: 'wow-t', autoManaged: true, lifecycleState: 'active' });
        const [group] = groupBindingsByChannel([WOW_FOREVER, auto, WOW_BCC]);
        expect(group?.lifecycleBinding?.id).toBe('auto');
        const [manual] = groupBindingsByChannel([GENERAL]);
        expect(manual?.lifecycleBinding).toBeNull();
    });

    it('flags multi-monitor only for two or more voice-monitor bindings', () => {
        const groups = groupBindingsByChannel([WOW_VOICE_F, WOW_VOICE_B, WOW_FOREVER, WOW_BCC]);
        expect(groups.map((g) => [g.channelType, g.hasMultiMonitor])).toEqual([['text', false], ['voice', true]]);
        const [single] = groupBindingsByChannel([WOW_VOICE_F]);
        expect(single?.hasMultiMonitor).toBe(false);
    });
});
