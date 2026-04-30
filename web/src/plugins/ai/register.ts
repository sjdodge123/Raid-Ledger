import { registerPlugin } from '../plugin-registry';
import { AiPluginContent } from './slots/ai-plugin-content';

const ai = registerPlugin('ai', {
    icon: '/plugins/ai/badge.svg',
    color: '#8B5CF6',
    label: 'AI Features',
});

ai.registerSlot('admin-settings:plugin-content', AiPluginContent);
