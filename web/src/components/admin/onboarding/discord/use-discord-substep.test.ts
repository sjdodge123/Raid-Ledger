import { describe, it, expect } from 'vitest';
import type { DiscordSetupStatus } from '@raid-ledger/contract';
import { deriveSubstep, type DiscordSubstep } from './use-discord-substep';

function setup(done: string[]): DiscordSetupStatus {
    const keys = ['oauth', 'bot-token', 'bot-connected', 'default-channel', 'timezone'];
    const steps = keys.map((key) => ({ key, label: key, completed: done.includes(key), settingsPath: '/admin' }));
    return { steps, overallComplete: false, completedCount: done.length, totalCount: keys.length };
}

const JOINED = { connected: true, guildName: 'Ironforge Raiders' };

describe('deriveSubstep (ROK-1703 D-2)', () => {
    const rows: [string, DiscordSetupStatus | undefined, Parameters<typeof deriveSubstep>[1], DiscordSubstep][] = [
        ['no data at all → 4a', undefined, undefined, 'create'],
        ['nothing saved → 4a', setup([]), { connected: false }, 'create'],
        ['OAuth saved, no token → 4c', setup(['oauth']), { connected: false }, 'keys'],
        ['token saved, no OAuth → 4c', setup(['bot-token']), { connected: false }, 'keys'],
        ['both saved, bot offline → 4d', setup(['oauth', 'bot-token']), { connected: false }, 'invite'],
        ['both saved, connected but in no server → 4d', setup(['oauth', 'bot-token', 'bot-connected']), { connected: true }, 'invite'],
        ['joined, no default channel → 4e', setup(['oauth', 'bot-token', 'bot-connected']), JOINED, 'joined'],
        ['everything done → 4e summary', setup(['oauth', 'bot-token', 'bot-connected', 'default-channel']), JOINED, 'joined'],
    ];
    it.each(rows)('%s', (_name, status, bot, expected) => {
        expect(deriveSubstep(status, bot)).toBe(expected);
    });
});
