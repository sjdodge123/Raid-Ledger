import { registerPlugin } from '../plugin-registry';
import { AiPluginContent } from './slots/ai-plugin-content';

// Guard against HMR re-execution pushing duplicate registrations
let registered = false;
if (!registered) {
    registered = true;

    const ai = registerPlugin('ai', {
        icon: '/plugins/ai/badge.svg',
        color: '#8B5CF6',
        label: 'AI Features',
    });

    ai.registerSlot('admin-settings:plugin-content', AiPluginContent);
}
