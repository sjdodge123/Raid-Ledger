/**
 * ROK-2208 L4 — an in-memory Discord behind `HubForumDiscordOutboundGateway`
 * (the outbound sync's only Discord seam), plus a pass-through spy on
 * `HubForumDiscordOutboundService.apply` so a spec can await the async
 * `hub-forum.changed` listener deterministically (`settle`, never a sleep).
 * Excluded from `nest build` by the `*.test-fixtures.ts` pattern.
 */
import type { TestApp } from '../../../common/testing/test-app';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { snowflake } from './hub-forum-discord.test-fixtures';

/** Spy on every outbound Discord write; each create returns fresh ids. */
export function stubOutbound(testApp: TestApp) {
  const gw = testApp.app.get(HubForumDiscordOutboundGateway);
  const service = testApp.app.get(HubForumDiscordOutboundService);
  const spies = {
    createPost: jest.spyOn(gw, 'createPost').mockImplementation(() => {
      const id = snowflake();
      return Promise.resolve({ threadId: id, messageId: id });
    }),
    createReply: jest
      .spyOn(gw, 'createReply')
      .mockImplementation(() => Promise.resolve(snowflake())),
    editMessage: jest.spyOn(gw, 'editMessage').mockResolvedValue('ok'),
    renameThread: jest.spyOn(gw, 'renameThread').mockResolvedValue('ok'),
    deleteThread: jest.spyOn(gw, 'deleteThread').mockResolvedValue('ok'),
    deleteMessage: jest.spyOn(gw, 'deleteMessage').mockResolvedValue('ok'),
    postNotice: jest.spyOn(gw, 'postNotice').mockResolvedValue(undefined),
    // ROK-2260 signup pings: bot online, mention + silent remove recorded.
    isOnline: jest.spyOn(gw, 'isOnline').mockReturnValue(true),
    mention: jest.spyOn(gw, 'mention').mockResolvedValue(undefined),
    removeThreadMembers: jest
      .spyOn(gw, 'removeThreadMembers')
      .mockResolvedValue(undefined),
  };
  const apply = jest.spyOn(service, 'apply');
  return { spies, apply, service };
}

/** The outbound fake + the `apply` spy a spec settles on. */
export type FakeOutbound = ReturnType<typeof stubOutbound>;
