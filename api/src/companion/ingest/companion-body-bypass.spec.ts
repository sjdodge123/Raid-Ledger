/**
 * ROK-1956 L2 — the companion body bypass keeps the global JSON parsers off
 * the ingest routes only (the bounded reader enforces the 256 KiB cap), and
 * both app entry points install it BEFORE the 2 MB JSON parser.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import {
  COMPANION_CONTENT_TYPE,
  companionBodyBypass,
  type CompanionBypassedRequest,
} from './companion-body-bypass';

function run(path: string, type?: string): CompanionBypassedRequest {
  const req = {
    path,
    headers: type === undefined ? {} : { 'content-type': type },
  };
  const next = jest.fn();
  companionBodyBypass(req as unknown as Request, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}

/** Index of the first non-comment line containing `needle`, else -1. */
function codeIndexOf(source: string, needle: string): number {
  const lines = source.split('\n');
  return lines.findIndex(
    (l) => !l.trim().startsWith('//') && l.includes(needle),
  );
}

describe('companionBodyBypass (ROK-1956)', () => {
  it.each([
    '/companion/v1/messages/bg3-save',
    '/Companion/V1/Messages/bg3-save',
    '/companion/v1/blobs/abc',
    '/COMPANION/V1/BLOBS/abc',
  ])('moves the Content-Type off %s (case-insensitive like Express)', (p) => {
    const req = run(p, 'application/json; charset=utf-8');
    expect(req.headers['content-type']).toBeUndefined();
    expect(req[COMPANION_CONTENT_TYPE]).toBe('application/json; charset=utf-8');
  });

  it.each([
    '/companion/v1/device',
    '/companion/v1/devices/3',
    '/companion/v1/devices/link',
    '/companion/v1/config',
    '/companion/v1/messages',
    '/plugins/valheim/link/messages/map',
  ])('leaves %s untouched (its JSON body still parses)', (p) => {
    const req = run(p, 'application/json');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req[COMPANION_CONTENT_TYPE]).toBeUndefined();
  });

  it('stashes nothing when the request has no Content-Type', () => {
    const req = run('/companion/v1/messages/bg3-save');
    expect(req[COMPANION_CONTENT_TYPE]).toBeUndefined();
  });

  it.each([
    ['main.ts', join(__dirname, '../../main.ts')],
    ['test-app.ts', join(__dirname, '../../common/testing/test-app.ts')],
  ])('%s installs the bypass before the 2 MB JSON parser', (_n, file) => {
    const source = readFileSync(file, 'utf8');
    const install = codeIndexOf(source, 'installCompanionBodyBypass(app)');
    const json = codeIndexOf(source, "useBodyParser('json'");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(json).toBeGreaterThan(install);
  });
});
