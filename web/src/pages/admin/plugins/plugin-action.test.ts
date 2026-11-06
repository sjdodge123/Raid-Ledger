import { describe, it, expect, vi, beforeEach } from 'vitest';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast: toastMock }));

import { executePluginMutation, type PluginAction } from './plugin-action';

const ok = { mutateAsync: vi.fn(async (): Promise<void> => {}) };
const mutations = { install: ok, activate: ok, deactivate: ok };

/** TDB 2614 — the success toast uses each action's real past tense. */
describe('executePluginMutation — success toast', () => {
    beforeEach(() => { toastMock.success.mockClear(); });

    it.each<[PluginAction, string]>([
        ['install', 'Plugin installed'],
        ['activate', 'Plugin activated'],
        ['deactivate', 'Plugin deactivated'],
    ])('%s → "%s"', async (action, message) => {
        await executePluginMutation(mutations, action, 'discord');
        expect(ok.mutateAsync).toHaveBeenCalledWith('discord');
        expect(toastMock.success).toHaveBeenCalledWith(message);
    });
});
