/**
 * AddonImportService orchestration (ROK-1724): owner check first, 413 before
 * the schema, stale writes nothing (binding skipped), binding rejects
 * thrown, and one audit row per attempt. DB-backed behaviour lives in
 * `addon-import.integration.spec.ts`.
 */
import { ForbiddenException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { CharactersService } from '../../../characters/characters.service';
import type { AddonImportAuditService } from './addon-import.audit';
import { bindToCharacter } from './addon-import.binding';
import { applyBinding } from './addon-import-binding.apply';
import { applyChar } from './addon-import-char.apply';
import { decodeImportString } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { AddonImportService } from './addon-import.service';

jest.mock('./addon-import.decoder', () => ({ decodeImportString: jest.fn() }));
jest.mock('./addon-import.binding', () => ({ bindToCharacter: jest.fn() }));
jest.mock('./addon-import-binding.apply', () => ({ applyBinding: jest.fn() }));
jest.mock('./addon-import-char.apply', () => ({
  applyChar: jest.fn(),
  previewChar: jest.fn(),
}));

const CHAR_ID = '00000000-0000-4000-8000-000000000001';
const SUMMARY = { gearCount: 1, avgIlvl: 80, talentNodes: 1, lockouts: 0 };

function makeDb() {
  const row = {
    c: {
      id: CHAR_ID,
      gameId: 7,
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'normal',
      class: 'Paladin',
      level: 60,
      addonGuid: null,
    },
    slug: 'world-of-warcraft-forever',
  };
  const chain = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([row]),
    transaction: jest.fn((fn: (tx: unknown) => unknown) => fn('TX')),
  };
  return chain as unknown as PostgresJsDatabase<typeof schema>;
}

function setup() {
  const characters = { findOne: jest.fn().mockResolvedValue({}) };
  const audit = {
    reserveAttempt: jest.fn().mockResolvedValue(41),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AddonImportService(
    makeDb(),
    characters as unknown as CharactersService,
    audit as unknown as AddonImportAuditService,
  );
  return { service, characters, audit };
}

const binding = (errors: AddonImportError[] = []) => ({
  errors,
  warnings: [],
  diff: { level: { from: 59, to: 60 } },
  pinGuid: 'Player-1-A',
});

beforeEach(() => {
  jest.clearAllMocks();
  (decodeImportString as jest.Mock).mockReturnValue({
    payload: { section: 'char', exportedAt: 1_790_000_000 },
    pages: 1,
    sha256: 'a'.repeat(64),
    inputBytes: 10,
  });
  (bindToCharacter as jest.Mock).mockReturnValue(binding());
});

const body = { importString: '!RL1!char!AAAA', dryRun: false };

describe('AddonImportService', () => {
  it('a stale apply skips the binding writes and warns STALE_EXPORT', async () => {
    const { service, audit } = setup();
    (applyChar as jest.Mock).mockResolvedValue({
      status: 'stale',
      summary: SUMMARY,
    });
    const res = await service.importString(1, CHAR_ID, body);
    expect(res.status).toBe('stale');
    expect(res.warnings).toContainEqual({ code: 'STALE_EXPORT' });
    expect(applyBinding).not.toHaveBeenCalled();
    expect(audit.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'stale', dryRun: false }),
      41,
    );
  });

  it('reserves the audit row (limit check) before decoding, as PENDING', async () => {
    const { service, audit } = setup();
    (applyChar as jest.Mock).mockResolvedValue({
      status: 'applied',
      summary: SUMMARY,
    });
    await service.importString(1, CHAR_ID, body);
    expect(audit.reserveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, dryRun: false, result: 'PENDING' }),
    );
    const reserved = audit.reserveAttempt.mock.invocationCallOrder[0] ?? 0;
    const decoded =
      (decodeImportString as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    expect(reserved).toBeLessThan(decoded);
    expect(audit.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'applied' }),
      41,
    );
  });

  it('an applied import writes the binding in the same transaction', async () => {
    const { service } = setup();
    (applyChar as jest.Mock).mockResolvedValue({
      status: 'applied',
      summary: SUMMARY,
    });
    await service.importString(1, CHAR_ID, body);
    expect(applyBinding).toHaveBeenCalledWith(
      expect.objectContaining({ tx: 'TX', characterId: CHAR_ID }),
      expect.objectContaining({ pinGuid: 'Player-1-A' }),
    );
  });

  it("someone else's character → 403 before decode or audit", async () => {
    const { service, characters, audit } = setup();
    characters.findOne.mockRejectedValue(new ForbiddenException('not yours'));
    await expect(service.importString(2, CHAR_ID, body)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(decodeImportString).not.toHaveBeenCalled();
    expect(audit.recordAttempt).not.toHaveBeenCalled();
  });

  it('an oversized string is 413 TOO_LARGE (not the schema 400) and audited', async () => {
    const { service, audit } = setup();
    const big = { importString: 'A'.repeat(262_145) };
    const err: unknown = await service
      .importString(1, CHAR_ID, big)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AddonImportError);
    expect((err as AddonImportError).getStatus()).toBe(413);
    expect((err as AddonImportError).code).toBe('TOO_LARGE');
    expect(audit.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'TOO_LARGE', sizeBytes: 262_145 }),
      null,
    );
    expect(audit.reserveAttempt).not.toHaveBeenCalled();
  });

  it('throws the first binding error and audits its code', async () => {
    const { service, audit } = setup();
    (bindToCharacter as jest.Mock).mockReturnValue(
      binding([new AddonImportError('NAME_MISMATCH')]),
    );
    await expect(service.importString(1, CHAR_ID, body)).rejects.toMatchObject({
      code: 'NAME_MISMATCH',
    });
    expect(applyChar).not.toHaveBeenCalled();
    expect(audit.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'NAME_MISMATCH',
        payloadSha256: 'a'.repeat(64),
      }),
      41,
    );
  });
});
