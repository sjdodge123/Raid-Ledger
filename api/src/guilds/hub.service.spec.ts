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
import { readWidgetPrefs } from './hub-widget-prefs.service';

jest.mock('./guild-core.queries', () => ({ findGuildKind: jest.fn() }));
jest.mock('../notifications/hub-notification-mute.helpers', () => ({
  isHubMuted: jest.fn(),
}));
jest.mock('./hub-widget-prefs.service', () => ({
  readWidgetPrefs: jest.fn(),
}));

const findKind = jest.mocked(findGuildKind);
const muted = jest.mocked(isHubMuted);
const prefs = jest.mocked(readWidgetPrefs);
const SAVED = { order: ['raids'], hidden: ['roster'], added: [], config: {} };
const actor = { id: 42, role: 'member' as const };

function serviceFor(
  role: LadderRole,
  member = true,
  topRank = false,
): HubService {
  const viewer = { role, canEdit: false, canManageEditors: false };
  const pageStub: unknown = { guild: { id: 7 }, viewer };
  const adapter: Partial<HubKindAdapter> = {
    page: jest.fn().mockResolvedValue(pageStub),
  };
  const registry: unknown = { require: () => adapter };
  const db: unknown = {};
  const access: unknown = {
    isMember: jest.fn().mockResolvedValue(member),
    holdsTopRank: jest.fn().mockResolvedValue(topRank),
  };
  return new HubService(
    db as PostgresJsDatabase<typeof schema>,
    registry as HubKindRegistry,
    access as GuildAccessService,
  );
}

beforeEach(() => {
  findKind.mockResolvedValue('wow_guild');
  muted.mockResolvedValue(true);
  prefs.mockResolvedValue(null);
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

describe('ROK-1814 HubService.page viewer.isStaff / canEditCrest', () => {
  it('a plain member holding the top in-game rank may edit the crest', async () => {
    const page = await serviceFor('member', true, true).page(actor, 7);
    expect(page.viewer).toMatchObject({ isStaff: false, canEditCrest: true });
  });

  it('a plain member without it may not', async () => {
    const page = await serviceFor('member').page(actor, 7);
    expect(page.viewer).toMatchObject({ isStaff: false, canEditCrest: false });
  });

  it('a visitor may not, even at the top rank', async () => {
    const page = await serviceFor('visitor', false, true).page(actor, 7);
    expect(page.viewer).toMatchObject({ canEditCrest: false });
  });

  it.each(['admin', 'operator'] as const)('%s is staff', async (role) => {
    const page = await serviceFor('leader', false).page({ id: 1, role }, 7);
    expect(page.viewer).toMatchObject({ isStaff: true });
  });
});

describe('ROK-1918 HubService.page widgetPrefs', () => {
  it.each(['visitor', 'member', 'leader'] as const)(
    'a %s gets the saved layout (layout, not data)',
    async (role) => {
      prefs.mockResolvedValue(SAVED);
      const page = await serviceFor(role).page(actor, 7);
      expect(page.widgetPrefs).toEqual(SAVED);
      expect(prefs).toHaveBeenCalledWith(expect.anything(), 7);
    },
  );

  it('a hub that never saved carries widgetPrefs: null', async () => {
    const page = await serviceFor('member').page(actor, 7);
    expect(page.widgetPrefs).toBeNull();
  });
});
