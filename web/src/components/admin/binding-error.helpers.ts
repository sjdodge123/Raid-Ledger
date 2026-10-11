import { errorBodyOf } from '../../lib/api/api-error';
import type { BindingChannelOption } from './BindingCreateForm';

/**
 * Inline copy for a rejected binding create/update. ROK-1766: a 409
 * BINDING_QP_GAME_TAKEN carries only the existing binding's `channelId`, so
 * name that channel from the list the page already loads; any other error
 * (or a channel not in the list) shows the API message unchanged.
 */
export function bindingErrorMessage(
    error: Error | null | undefined, channels: BindingChannelOption[],
): string | null {
    if (!error) return null;
    const body = errorBodyOf(error);
    if (body?.code !== 'BINDING_QP_GAME_TAKEN') return error.message;
    const channel = channels.find((c) => c.id === body.channelId);
    if (!channel) return error.message;
    return `This game already posts Quick Play to #${channel.name}. Remove or edit that binding first.`;
}
