/**
 * ROK-1955 review — controller-level rules for the web approval routes:
 * an impersonation session cannot approve/deny (it would mint a persistent
 * credential for the target), and the preview code rides the POST body.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedExpressRequest } from '../../auth/types';
import { CompanionDeviceLinkController } from './companion-device-link.controller';
import type { CompanionDeviceLinkPollService } from './companion-device-link-poll.service';
import type { CompanionDeviceLinkService } from './companion-device-link.service';

function setup() {
  const links = {
    decide: jest.fn().mockResolvedValue({ status: 'approved' }),
    preview: jest.fn().mockResolvedValue({ status: 'pending' }),
  };
  const controller = new CompanionDeviceLinkController(
    links as unknown as CompanionDeviceLinkService,
    {} as unknown as CompanionDeviceLinkPollService,
  );
  const res = { setHeader: jest.fn() } as unknown as Response;
  return { links, controller, res };
}

function reqAs(impersonatedBy: number | null): AuthenticatedExpressRequest {
  return {
    ip: '203.0.113.9',
    user: { id: 5, impersonatedBy },
  } as unknown as AuthenticatedExpressRequest;
}

const BODY = { userCode: 'BCDFGHJK', decision: 'approve' };

describe('CompanionDeviceLinkController', () => {
  it('decision from an impersonation session → 403, service never called', async () => {
    const { links, controller, res } = setup();
    await expect(controller.decide(BODY, reqAs(1), res)).rejects.toThrow(
      ForbiddenException,
    );
    expect(links.decide).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('decision from the real user reaches the service', async () => {
    const { links, controller, res } = setup();
    await controller.decide(BODY, reqAs(null), res);
    expect(links.decide).toHaveBeenCalledWith(
      { userId: 5, ip: '203.0.113.9' },
      BODY,
      res,
    );
  });

  it('preview passes the POST body (not a path param) to the service', async () => {
    const { links, controller, res } = setup();
    const body = { userCode: 'bcdf-ghjk' };
    await controller.preview(body, reqAs(null), res);
    expect(links.preview).toHaveBeenCalledWith(
      { userId: 5, ip: '203.0.113.9' },
      body,
      res,
    );
  });
});
