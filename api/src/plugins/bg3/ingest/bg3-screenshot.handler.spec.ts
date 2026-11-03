/**
 * ROK-1966 — the `bg3-screenshot` handler: contract wiring, the Q3 target
 * refusal (non-member / non-BG3 hub), the replay no-op and the stored row.
 * The spoiler rule is the `bg3-screenshot` media gate
 * (`bg3-gallery.registrations.spec.ts`); the DB-level reads are covered by
 * `bg3-screenshot.integration.spec.ts`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BG3_SCREENSHOT_CONTRACT_ID,
  Bg3ScreenshotMessageSchema,
  type Bg3ScreenshotMessage,
} from '@raid-ledger/contract';
import { HttpException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { CompanionHandlerContext } from '../../../companion/ingest/companion-handler.registry';
import type { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import { readBg3Blob } from '../read/bg3-thumbnail.encode';
import { Bg3ScreenshotHandler } from './bg3-screenshot.handler';
import {
  bg3ScreenshotProvenanceKey,
  isLiveBg3HubMember,
  screenshotHeld,
  screenshotStorageName,
  storeBg3Screenshot,
} from './bg3-screenshot.repository';
import { screenshotRateKey } from './bg3-screenshot.limits';
import type { Bg3ScreenshotTargets } from './bg3-screenshot.targets';
import { toHubTargets } from './bg3-screenshot.targets';

jest.mock('./bg3-screenshot.repository', () => ({
  ...jest.requireActual('./bg3-screenshot.repository'),
  isLiveBg3HubMember: jest.fn(),
  screenshotHeld: jest.fn(),
  storeBg3Screenshot: jest.fn(),
  uploaderName: jest.fn().mockResolvedValue('Tav'),
}));
jest.mock('../read/bg3-thumbnail.encode', () => ({
  readBg3Blob: jest.fn(),
}));

const member = jest.mocked(isLiveBg3HubMember);
const held = jest.mocked(screenshotHeld);
const store = jest.mocked(storeBg3Screenshot);
const blob = jest.mocked(readBg3Blob);
/** The fixed-window count the Redis INCR script answers. */
const windowCount = jest.fn<Promise<number>, unknown[]>();

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/companion/bg3-screenshot/v1/fixtures',
);
const SHOT: Bg3ScreenshotMessage = Bg3ScreenshotMessageSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'steam-1080p.json'), 'utf8')),
);

function setup() {
  const handler = new Bg3ScreenshotHandler(
    {} as CompanionBlobStore,
    { forUser: jest.fn() } as unknown as Bg3ScreenshotTargets,
    { eval: windowCount } as unknown as Redis,
  );
  const tx: unknown = { tx: true };
  const ctx = {
    tx,
    userId: 7,
    via: 'device',
    deviceId: 3,
    receivedAt: new Date('2026-11-03T12:01:00Z'),
  } as CompanionHandlerContext;
  return { handler, ctx };
}

async function refusal(p: Promise<unknown>): Promise<unknown> {
  const err: unknown = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  return err instanceof HttpException ? err.getResponse() : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  member.mockResolvedValue(true);
  held.mockResolvedValue(false);
  store.mockResolvedValue('stored');
  blob.mockResolvedValue(Buffer.from('webp'));
  windowCount.mockResolvedValue(1);
  process.env.HUB_MEDIA_COMPANION_PER_HOUR = '20';
});

afterEach(() => {
  delete process.env.HUB_MEDIA_COMPANION_PER_HOUR;
});

describe('Bg3ScreenshotHandler — contract wiring', () => {
  const { handler } = setup();

  it('handles bg3-screenshot v1 from devices only, with its image as the one blob ref', () => {
    expect(handler.contract).toBe(BG3_SCREENSHOT_CONTRACT_ID);
    expect(handler.versions).toEqual([1]);
    expect(handler.blobRefs(SHOT)).toEqual([SHOT.payload.image]);
  });
});

describe('Bg3ScreenshotHandler — Q3 target refusal', () => {
  it('refuses a hub the uploader is not a live member of (or a non-BG3 hub) as invalid_payload', async () => {
    member.mockResolvedValue(false);
    const { handler, ctx } = setup();
    const body = await refusal(handler.handle(ctx, SHOT));
    expect(body).toMatchObject({
      code: 'invalid_payload',
      issues: [{ path: 'payload.target.hubGuildId', code: 'not_a_member' }],
    });
    expect(member).toHaveBeenCalledWith(
      ctx.tx,
      7,
      SHOT.payload.target.hubGuildId,
    );
    expect(store).not.toHaveBeenCalled();
  });

  it('refuses in alreadyHeld too, before telling a non-member whether the hub holds it', async () => {
    member.mockResolvedValue(false);
    held.mockResolvedValue(true);
    const { handler, ctx } = setup();
    const body = await refusal(handler.alreadyHeld(ctx.tx, 7, SHOT));
    expect(body).toMatchObject({ code: 'invalid_payload' });
    expect(held).not.toHaveBeenCalled();
  });
});

describe('Bg3ScreenshotHandler — dedupe (AC2)', () => {
  it('a screenshot already in the hub (live or Removed) is held → acked stale', async () => {
    held.mockResolvedValue(true);
    const { handler, ctx } = setup();
    await expect(handler.alreadyHeld(ctx.tx, 7, SHOT)).resolves.toBe(true);
    expect(held).toHaveBeenCalledWith(
      ctx.tx,
      SHOT.payload.target.hubGuildId,
      bg3ScreenshotProvenanceKey(SHOT.payload.image.sha256),
    );
  });

  it('the provenance key is the WebP sha256, content-addressed', () => {
    expect(bg3ScreenshotProvenanceKey('ab'.repeat(32))).toBe(
      `bg3-screenshot:sha256:${'ab'.repeat(32)}`,
    );
  });
});

describe('Bg3ScreenshotHandler — handle stores a Gallery screenshot', () => {
  it('stores source bg3-screenshot, kind screenshot, owned by the uploader', async () => {
    const { handler, ctx } = setup();
    await handler.handle(ctx, SHOT);
    expect(store).toHaveBeenCalledWith(
      ctx.tx,
      {
        guildId: SHOT.payload.target.hubGuildId,
        source: 'bg3-screenshot',
        kind: 'screenshot',
        provenanceKey: bg3ScreenshotProvenanceKey(SHOT.payload.image.sha256),
        uploadedBy: 7,
        authorName: 'Tav',
        caption: null,
        capturedAt: new Date(SHOT.payload.takenAt),
        discord: null,
      },
      Buffer.from('webp'),
      SHOT.payload.image.sha256,
    );
  });

  it.each([
    ['not_image', 'invalid_blob'],
    ['cap', 'blob_quota_exceeded'],
  ] as const)('a %s store outcome refuses as %s', async (outcome, code) => {
    store.mockResolvedValue(outcome);
    const { handler, ctx } = setup();
    expect(await refusal(handler.handle(ctx, SHOT))).toMatchObject({ code });
  });

  it('a missing blob refuses as invalid_blob without storing', async () => {
    blob.mockResolvedValue(null);
    const { handler, ctx } = setup();
    expect(await refusal(handler.handle(ctx, SHOT))).toMatchObject({
      code: 'invalid_blob',
    });
    expect(store).not.toHaveBeenCalled();
  });
});

describe('Bg3ScreenshotHandler — per-user hourly allowance (review M1)', () => {
  it('the 20th screenshot in the window is stored; the 21st refuses as retryable rate_limited (429) without storing', async () => {
    const { handler, ctx } = setup();
    windowCount.mockResolvedValueOnce(20).mockResolvedValueOnce(21);
    await handler.handle(ctx, SHOT);
    const err: unknown = await handler.handle(ctx, SHOT).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect(
      err instanceof HttpException
        ? [err.getStatus(), err.getResponse()]
        : null,
    ).toEqual([429, expect.objectContaining({ code: 'rate_limited' })]);
    expect(store).toHaveBeenCalledTimes(1);
    expect(windowCount).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      screenshotRateKey(7),
      3600,
    );
  });

  it('a refused target never spends a slot', async () => {
    member.mockResolvedValue(false);
    const { handler, ctx } = setup();
    await refusal(handler.handle(ctx, SHOT));
    expect(windowCount).not.toHaveBeenCalled();
  });
});

describe('screenshotStorageName — content-addressed file name (review m1)', () => {
  const V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('is a v4-uuid-shaped name, the same for the same sha256 and different for another', () => {
    const a = screenshotStorageName('f'.repeat(64));
    const b = screenshotStorageName(SHOT.payload.image.sha256);
    expect([V4.test(a), V4.test(b)]).toEqual([true, true]);
    expect(screenshotStorageName(SHOT.payload.image.sha256)).toBe(b);
    expect(a).not.toBe(b);
  });
});

describe('toHubTargets — /config picker default (Q3)', () => {
  const hubs = [
    { guildId: 4, name: 'Alpha' },
    { guildId: 9, name: 'Beta' },
  ];

  it('defaults to the hub of the latest save when it is listed', () => {
    expect(toHubTargets(hubs, 9)).toEqual([
      { hubGuildId: 4, name: 'Alpha', isDefault: false },
      { hubGuildId: 9, name: 'Beta', isDefault: true },
    ]);
  });

  it('falls back to the first hub when the latest save is elsewhere or absent', () => {
    expect(toHubTargets(hubs, 77).map((t) => t.isDefault)).toEqual([
      true,
      false,
    ]);
    expect(toHubTargets(hubs, null).map((t) => t.isDefault)).toEqual([
      true,
      false,
    ]);
    expect(toHubTargets([], null)).toEqual([]);
  });
});
