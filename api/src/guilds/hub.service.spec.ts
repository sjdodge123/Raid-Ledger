/**
 * ROK-1832 — `HubService.page` adds the viewer's per-group mute flag in core
 * (never per adapter), and only for a viewer who is a member of the group —
 * a visitor or a staff non-member (leader rung, no roster seat) cannot mute.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LadderRole } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { HubKindAdapter } from '../plugins/plugin-host/extension-points';
import type { GuildAccessService } from './guild-access.service';
import type { HubKindRegistry } from './hub-kind.registry';
import { HubService } from './hub.service';
import { findGuildKind } from './guild-core.queries';
import { isHubMuted } from '../notifications/hub-notification-mute.helpers';

jest.mock('./guild-core.queries', () => ({ findGuildKind: jest.fn() }));
jest.mock('../notifications/hub-notification-mute.helpers', () => ({
  isHubMuted: jest.fn(),
}));

const findKind = jest.mocked(findGuildKind);
const muted = jest.mocked(isHubMuted);
const actor = { id: 42, role: 'member' as const };

function serviceFor(role: LadderRole, member = true): HubService {
  const viewer = { role, canEdit: false, canManageEditors: false };
  const pageStub: unknown = { guild: { id: 7 }, viewer };
  const adapter: Partial<HubKindAdapter> = {
    page: jest.fn().mockResolvedValue(pageStub),
  };
  const registry: unknown = { require: () => adapter };
  const db: unknown = {};
  const access: unknown = { isMember: jest.fn().mockResolvedValue(member) };
  return new HubService(
    db as PostgresJsDatabase<typeof schema>,
    registry as HubKindRegistry,
    access as GuildAccessService,
  );
}

beforeEach(() => {
  findKind.mockResolvedValue('wow_guild');
  muted.mockResolvedValue(true);
});

describe('ROK-1832 HubService.page viewer.notificationsMuted', () => {
  it.each(['member', 'officer', 'leader'] as const)(
    'a %s gets the flag from isHubMuted',
    async (role) => {
      const page = await serviceFor(role).page(actor, 7);
      expect(page.viewer.notificationsMuted).toBe(true);
      expect(muted).toHaveBeenCalledWith(expect.anything(), 42, 7);
    },
  );

  it('a staff non-member (leader rung) gets no flag and no lookup', async () => {
    muted.mockClear();
    const page = await serviceFor('leader', false).page(actor, 7);
    expect(page.viewer).not.toHaveProperty('notificationsMuted');
    expect(muted).not.toHaveBeenCalled();
  });

  it('a visitor gets no flag and no lookup', async () => {
    muted.mockClear();
    const page = await serviceFor('visitor').page(actor, 7);
    expect(page.viewer).not.toHaveProperty('notificationsMuted');
    expect(muted).not.toHaveBeenCalled();
  });
});
