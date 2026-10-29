/**
 * ROK-1957 §9.1 U-5 — the `bg3-save` handler: contract wiring, latest-wins
 * key, blob refs, and the D-6 campaign resolution on `handle`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BG3_SAVE_CONTRACT_ID,
  Bg3SaveMessageSchema,
  type Bg3SaveMessage,
} from '@raid-ledger/contract';
import type { CompanionHandlerContext } from '../../../companion/ingest/companion-handler.registry';
import { Bg3SaveHandler, partyMaxLevel } from './bg3-save.handler';

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/companion/bg3-save/v1/fixtures',
);
const ACT2: Bg3SaveMessage = Bg3SaveMessageSchema.parse(
  JSON.parse(readFileSync(join(FIXTURES, 'act2-party-4p-summon.json'), 'utf8')),
);

function setup(target: { id: number; guildId: number } | null, member = true) {
  const repo = {
    resolveCampaign: jest.fn().mockResolvedValue(target),
    insertSave: jest.fn().mockResolvedValue(true),
    isHubMember: jest.fn().mockResolvedValue(member),
  };
  const handler = new Bg3SaveHandler(repo);
  const tx: unknown = { tx: true };
  const ctx = {
    tx,
    userId: 7,
    via: 'device',
    deviceId: 3,
    receivedAt: new Date('2026-10-24T12:01:00Z'),
  } as CompanionHandlerContext;
  return { repo, handler, ctx };
}

function insertedRow(repo: ReturnType<typeof setup>['repo']): unknown {
  const call: unknown[] | undefined = repo.insertSave.mock.calls[0];
  expect(call).toBeDefined();
  return call?.[1];
}

describe('Bg3SaveHandler — contract wiring (U-5)', () => {
  const { handler } = setup(null);

  it('handles bg3-save v1 from devices AND sessions', () => {
    expect(handler.contract).toBe(BG3_SAVE_CONTRACT_ID);
    expect(handler.versions).toEqual([1]);
    expect(handler.sources).toEqual(['device', 'session']);
  });

  it('latest-wins on {campaignKey, savedAt}', () => {
    expect(handler.latestWins(ACT2)).toEqual({
      key: ACT2.payload.campaignKey,
      at: new Date(ACT2.payload.savedAt),
    });
  });

  it('refs the thumbnail, and nothing when it is null', () => {
    const thumb = ACT2.payload.thumbnail;
    expect(thumb).not.toBeNull();
    expect(handler.blobRefs(ACT2)).toEqual([thumb]);
    const bare = { ...ACT2, payload: { ...ACT2.payload, thumbnail: null } };
    expect(handler.blobRefs(bare)).toEqual([]);
  });
});

describe('Bg3SaveHandler.handle — campaign resolution (D-6)', () => {
  it('assigns the bound campaign when the uploader is in its hub', async () => {
    const { repo, handler, ctx } = setup({ id: 11, guildId: 5 });
    await handler.handle(ctx, ACT2);
    expect(repo.resolveCampaign).toHaveBeenCalledWith(
      ctx.tx,
      7,
      ACT2.payload.campaignKey,
    );
    // Review fix 1: the membership read runs on the ingest tx, never a
    // second pool connection (that deadlocks at DB_POOL_MAX=1).
    expect(repo.isHubMember).toHaveBeenCalledWith(ctx.tx, 7, 5);
    expect(insertedRow(repo)).toMatchObject({
      uploaderUserId: 7,
      deviceId: 3,
      campaignId: 11,
      campaignKey: ACT2.payload.campaignKey,
      savedAt: new Date(ACT2.payload.savedAt),
      capturedAt: new Date(ACT2.capturedAt),
      receivedAt: ctx.receivedAt,
      thumbnailSha256: ACT2.payload.thumbnail?.sha256,
    });
  });

  it('leaves the save unassigned when the uploader left the hub', async () => {
    const { repo, handler, ctx } = setup({ id: 11, guildId: 5 }, false);
    await handler.handle(ctx, ACT2);
    expect(insertedRow(repo)).toMatchObject({ campaignId: null });
  });

  it('leaves the save unassigned with no binding or default', async () => {
    const { repo, handler, ctx } = setup(null);
    await handler.handle(ctx, ACT2);
    expect(repo.isHubMember).not.toHaveBeenCalled();
    expect(insertedRow(repo)).toMatchObject({ campaignId: null });
  });

  it('stores no thumbnail columns for a save without one', async () => {
    const { repo, handler, ctx } = setup(null);
    const bare = { ...ACT2, payload: { ...ACT2.payload, thumbnail: null } };
    await handler.handle(ctx, bare);
    expect(insertedRow(repo)).toMatchObject({
      thumbnailSha256: null,
      thumbnailWidth: null,
      thumbnailHeight: null,
    });
  });
});

describe('partyMaxLevel', () => {
  const member = ACT2.payload.party.find((m) => !m.isSummon);
  const summon = ACT2.payload.party.find((m) => m.isSummon);

  it('ignores summons', () => {
    expect(member).toBeDefined();
    expect(summon).toBeDefined();
    if (!member || !summon) return;
    const party = [
      { ...member, level: 5 },
      { ...summon, level: 12 },
    ];
    expect(partyMaxLevel(party)).toBe(5);
  });

  it('falls back to the summons when the party is only summons', () => {
    if (!summon) throw new Error('fixture has no summon');
    expect(partyMaxLevel([{ ...summon, level: 3 }])).toBe(3);
  });
});
