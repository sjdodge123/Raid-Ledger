/**
 * ROK-2272 S4b — the two DEMO_MODE fixtures the event-planning smoke uses:
 * `sync-planning-post` (re-sync one event's planning post) and `lock-sweep`
 * (run the Core lock sweep at the REAL current time). Plus the class-level
 * guard chain every `/admin/test/*` controller must keep.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import type { EventPlanningPostsService } from './event-planning-posts.service';
import type { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import type { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import type { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { HubForumDiscordDemoTestController } from './hub-forum-discord.demo-test.controller';

function build() {
  const syncEvent = jest.fn().mockResolvedValue(undefined);
  const sweep = jest.fn().mockResolvedValue(3);
  const controller = new HubForumDiscordDemoTestController(
    {} as ForumDiscordDb,
    {} as HubForumDiscordGateway,
    {} as HubForumDiscordSignupPings,
    { syncEvent } as unknown as EventPlanningPostsService,
    { sweep } as unknown as HubForumDiscordEventLockSweep,
  );
  return { controller, syncEvent, sweep };
}

describe('HubForumDiscordDemoTestController (ROK-2272 S4b fixtures)', () => {
  it('stays behind the JWT, admin and DEMO_MODE guards, DEMO_MODE last', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      HubForumDiscordDemoTestController,
    );
    expect(Array.isArray(guards)).toBe(true);
    const list = guards as unknown[];
    expect(list).toHaveLength(3);
    expect(list[1]).toBe(AdminGuard);
    expect(list[2]).toBe(DemoModeGuard);
  });

  it('sync-planning-post re-syncs exactly that event', async () => {
    const { controller, syncEvent } = build();
    await expect(controller.syncPlanningPost(42)).resolves.toEqual({
      synced: true,
    });
    expect(syncEvent).toHaveBeenCalledTimes(1);
    expect(syncEvent).toHaveBeenCalledWith(42);
  });

  it('lock-sweep runs the sweep at the real current time and reports changes', async () => {
    const { controller, sweep } = build();
    await expect(controller.lockSweepNow()).resolves.toEqual({ changed: 3 });
    expect(sweep).toHaveBeenCalledTimes(1);
    // No caller-supplied "now": the sweep's own default (new Date()) applies.
    expect(sweep).toHaveBeenCalledWith();
  });
});
