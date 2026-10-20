/**
 * ROK-1725 — PATCH /events/:id/report-link body validation at the controller:
 * each allow-list rule rejects with its own message (400), an accepted URL is
 * normalised before it reaches the service, and the role maps to isAdmin.
 */
import { Test } from '@nestjs/testing';
import { EVENT_REPORT_URL_MAX, type UserRole } from '@raid-ledger/contract';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SignupsService } from './signups.service';
import { ShareService } from './share.service';
import { EventGuildTagService } from './event-guild-tag.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { LfgEventConvertService } from '../lfg/lfg-event-convert.service';
import type { AuthenticatedRequest } from '../auth/types';

const ALLOW_LIST =
  'Only Warcraft Logs and foreverlogs.gg report links are accepted';

let controller: EventsController;
let updateReportLink: jest.Mock;

const asRole = (role: UserRole) =>
  ({ user: { id: 5, role } }) as AuthenticatedRequest;

beforeEach(async () => {
  updateReportLink = jest.fn().mockResolvedValue({ id: 7, reportUrl: null });
  const module = await Test.createTestingModule({
    controllers: [EventsController],
    providers: [
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: EventsService, useValue: { updateReportLink } },
      { provide: SignupsService, useValue: {} },
      { provide: ShareService, useValue: {} },
      { provide: ActivityLogService, useValue: {} },
      { provide: LfgEventConvertService, useValue: {} },
      { provide: EventGuildTagService, useValue: {} },
    ],
  }).compile();
  controller = module.get(EventsController);
});

describe('PATCH /events/:id/report-link — rejected URLs (ROK-1725)', () => {
  const tooLong = `https://www.warcraftlogs.com/reports/${'a'.repeat(EVENT_REPORT_URL_MAX)}`;
  it.each([
    [
      'http',
      'http://www.warcraftlogs.com/reports/x',
      'Report link must start with https://',
    ],
    ['a foreign host', 'https://evil.com/reports/x', ALLOW_LIST],
    ['a look-alike host', 'https://notwarcraftlogs.com/reports/x', ALLOW_LIST],
    [
      'the home page',
      'https://www.warcraftlogs.com/',
      "Paste a link to a specific report, not the site's home page",
    ],
    [
      'userinfo',
      'https://u:p@www.warcraftlogs.com/reports/x',
      'Report link must not contain a username or password',
    ],
    [
      'an explicit port',
      'https://www.warcraftlogs.com:8443/reports/x',
      'Report link must not include a port',
    ],
    ['an over-long URL', tooLong, 'Report link is too long'],
  ])('rejects %s with its own message', async (_label, reportUrl, message) => {
    await expect(
      controller.updateReportLink(7, asRole('member'), { reportUrl }),
    ).rejects.toMatchObject({
      status: 400,
      response: { errors: [`reportUrl: ${message}`] },
    });
    expect(updateReportLink).not.toHaveBeenCalled();
  });

  it('rejects an unknown body key (strict schema)', async () => {
    await expect(
      controller.updateReportLink(7, asRole('member'), {
        reportUrl: null,
        title: 'x',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(updateReportLink).not.toHaveBeenCalled();
  });
});

describe('PATCH /events/:id/report-link — accepted bodies (ROK-1725)', () => {
  it('normalises the URL before it reaches the service', async () => {
    await controller.updateReportLink(7, asRole('member'), {
      reportUrl: '  https://WWW.WarcraftLogs.com/reports/AbC#fight=2  ',
    });
    expect(updateReportLink).toHaveBeenCalledWith(7, 5, false, {
      reportUrl: 'https://www.warcraftlogs.com/reports/AbC#fight=2',
    });
  });

  it('passes null through to clear the link', async () => {
    await controller.updateReportLink(7, asRole('member'), { reportUrl: null });
    expect(updateReportLink).toHaveBeenCalledWith(7, 5, false, {
      reportUrl: null,
    });
  });

  it.each([
    ['operator', true],
    ['admin', true],
    ['member', false],
  ] as const)('maps role %s to isAdmin=%s', async (role, isAdmin) => {
    await controller.updateReportLink(7, asRole(role), {
      reportUrl: 'https://foreverlogs.gg/reports/x',
    });
    expect(updateReportLink).toHaveBeenCalledWith(7, 5, isAdmin, {
      reportUrl: 'https://foreverlogs.gg/reports/x',
    });
  });
});
