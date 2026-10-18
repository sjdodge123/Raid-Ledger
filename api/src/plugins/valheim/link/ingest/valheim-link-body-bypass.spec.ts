import type { Request, Response } from 'express';
import {
  VALHEIM_LINK_CONTENT_TYPE,
  valheimLinkBodyBypass,
  type ValheimLinkBypassedRequest,
} from './valheim-link-body-bypass';

function run(path: string): ValheimLinkBypassedRequest {
  const req = { path, headers: { 'content-type': 'application/json' } };
  const next = jest.fn();
  valheimLinkBodyBypass(req as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}

describe('valheimLinkBodyBypass (ROK-1833)', () => {
  it.each([
    '/plugins/valheim/link/messages/map',
    '/plugins/Valheim/link/messages/map',
    '/PLUGINS/VALHEIM/LINK/blobs/abc',
  ])('moves the Content-Type off %s (case-insensitive like Express)', (p) => {
    const req = run(p);
    expect(req.headers['content-type']).toBeUndefined();
    expect(req[VALHEIM_LINK_CONTENT_TYPE]).toBe('application/json');
  });

  it('leaves every other path untouched', () => {
    const req = run('/plugins/valheim/other');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req[VALHEIM_LINK_CONTENT_TYPE]).toBeUndefined();
  });
});
