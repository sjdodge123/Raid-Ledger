/**
 * Shared test helpers for og-meta.service spec files.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OgMetaService } from './og-meta.service';
import { InviteService } from './invite.service';
import { SettingsService } from '../settings/settings.service';

/** Build a minimal valid resolveInvite response for a valid invite. */
export function makeValidInvite(
  overrides: {
    title?: string;
    startTime?: string;
    endTime?: string;
    game?: { name: string; coverUrl?: string | null } | null;
  } = {},
) {
  return {
    valid: true,
    event: {
      id: 1,
      title: overrides.title ?? 'Test Event',
      startTime: overrides.startTime ?? '2026-03-02T20:00:00.000Z',
      endTime: overrides.endTime ?? '2026-03-02T23:00:00.000Z',
      game:
        overrides.game !== undefined
          ? overrides.game
          : {
              name: 'World of Warcraft',
              coverUrl: 'https://images.igdb.com/cover.jpg',
            },
    },
    slot: { id: 1, role: 'dps', status: 'pending' },
  };
}

export interface OgMetaMocks {
  inviteService: { resolveInvite: jest.Mock };
  settingsService: { getClientUrl: jest.Mock; getDefaultTimezone: jest.Mock };
}

/** Set up the test module and return service + mocks. */
export async function setupOgMetaTestModule(): Promise<{
  service: OgMetaService;
  mocks: OgMetaMocks;
}> {
  const mocks: OgMetaMocks = {
    inviteService: { resolveInvite: jest.fn() },
    settingsService: {
      getClientUrl: jest.fn().mockResolvedValue('https://raid.example.com'),
      getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
    },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OgMetaService,
      { provide: InviteService, useValue: mocks.inviteService },
      { provide: SettingsService, useValue: mocks.settingsService },
    ],
  }).compile();

  return {
    service: module.get<OgMetaService>(OgMetaService),
    mocks,
  };
}
