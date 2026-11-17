/**
 * Hub ↔ Discord channel handlers, kept in their original order (MSW matches
 * the first handler): Pictures channel (ROK-1941), forum sync (ROK-2208), channel
 * lifecycle (ROK-1428). Grouped here so `handlers.ts` stays under the 300-line limit.
 */
import { hubMediaChannelHandlers } from './hub-media-channel-handlers';
import { hubForumDiscordHandlers } from './hub-forum-discord-handlers';
import { channelLifecycleHandlers } from './channel-lifecycle-handlers';

export const hubDiscordHandlers = [
    ...hubMediaChannelHandlers,
    ...hubForumDiscordHandlers,
    ...channelLifecycleHandlers,
];
