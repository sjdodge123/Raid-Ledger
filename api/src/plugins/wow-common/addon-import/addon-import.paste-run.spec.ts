/**
 * ROK-1737 — mixed-paste routing: every section runs through its own
 * char/guild/raid apply fn in the SAME tx with its own sha256, a rejecting
 * section aborts the rest, and the body carries one `sections` entry each
 * (a single-section body is unchanged). DB-backed all-or-nothing lives in
 * `addon-import.mixed.integration.spec.ts`.
 */
import type { AddonApplyContext } from './addon-import-apply.types';
import type { AddonBindingResult } from './addon-import.binding';
import type { DecodedAddonPaste } from './addon-import.decoder';
import { applyChar } from './addon-import-char.apply';
import { applyGuild } from './addon-import-guild.apply';
import { applyRaid, previewRaid } from './addon-import-raid.apply';
import { AddonImportError } from './addon-import.errors';
import {
  buildPasteResult,
  runPaste,
  shouldApplyBinding,
} from './addon-import.paste-run';

jest.mock('./addon-import-char.apply', () => ({
  applyChar: jest.fn(),
  previewChar: jest.fn(),
}));
jest.mock('./addon-import-guild.apply', () => ({
  applyGuild: jest.fn(),
  previewGuild: jest.fn(),
}));
jest.mock('./addon-import-raid.apply', () => ({
  applyRaid: jest.fn(),
  previewRaid: jest.fn(),
}));

const CHAR_SUMMARY = { gearCount: 2, avgIlvl: 78, talentNodes: 1, lockouts: 1 };
const RAID_SUMMARY = {
  pulls: 1,
  newPulls: 1,
  duplicatePulls: 0,
  kills: 1,
  wipes: 0,
};
const GUILD_SUMMARY = {
  guildName: 'Night Shift',
  members: 600,
  newMembers: 600,
  updatedMembers: 0,
  pages: 3,
};

const section = (name: string, sha: string, pages = 1) => ({
  payload: { section: name, exportedAt: 1_790_000_000 },
  pages,
  sha256: sha.repeat(64),
  inputBytes: 100,
});

function paste(...names: Array<'char' | 'guild' | 'raid'>): DecodedAddonPaste {
  const sections = Object.fromEntries(
    names.map((n) => [n, section(n, n[0] ?? 'x', n === 'guild' ? 3 : 1)]),
  );
  return {
    sections,
    order: names,
    tokens: names.length,
    inputBytes: 300,
  } as unknown as DecodedAddonPaste;
}

const CTX = {
  tx: 'TX',
  userId: 1,
  characterId: 'c',
  gameId: 7,
  region: 'us',
} as unknown as Omit<AddonApplyContext, 'sha256'>;
const BINDING: AddonBindingResult = {
  errors: [],
  warnings: [],
  diff: {},
  pinGuid: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (applyChar as jest.Mock).mockResolvedValue({
    status: 'applied',
    summary: CHAR_SUMMARY,
  });
  (applyGuild as jest.Mock).mockResolvedValue({
    status: 'applied',
    summary: GUILD_SUMMARY,
  });
  (applyRaid as jest.Mock).mockResolvedValue({
    status: 'stale',
    summary: RAID_SUMMARY,
  });
});

describe('runPaste', () => {
  it('routes each section to its own apply fn, same tx, its own sha256 + pages', async () => {
    const runs = await runPaste(CTX, paste('char', 'guild', 'raid'), false);
    expect(runs.map((r) => r.outcome.status)).toEqual([
      'applied',
      'applied',
      'stale',
    ]);
    expect(applyChar).toHaveBeenCalledWith(
      expect.objectContaining({ tx: 'TX', sha256: 'c'.repeat(64) }),
      expect.objectContaining({ section: 'char' }),
    );
    expect(applyGuild).toHaveBeenCalledWith(
      expect.objectContaining({ tx: 'TX', sha256: 'g'.repeat(64) }),
      expect.objectContaining({ section: 'guild' }),
      3,
    );
    expect(applyRaid).toHaveBeenCalledWith(
      expect.objectContaining({ tx: 'TX', sha256: 'r'.repeat(64) }),
      expect.objectContaining({ section: 'raid' }),
    );
  });

  it('a dry run previews only', async () => {
    (previewRaid as jest.Mock).mockResolvedValue({
      status: 'preview',
      summary: RAID_SUMMARY,
    });
    await runPaste(CTX, paste('raid'), true);
    expect(previewRaid).toHaveBeenCalledTimes(1);
    expect(applyRaid).not.toHaveBeenCalled();
  });

  it('a rejecting section throws and the later sections never run', async () => {
    (applyGuild as jest.Mock).mockRejectedValue(
      new AddonImportError('NOT_IN_GUILD'),
    );
    await expect(
      runPaste(CTX, paste('char', 'guild', 'raid'), false),
    ).rejects.toMatchObject({
      code: 'NOT_IN_GUILD',
    });
    expect(applyRaid).not.toHaveBeenCalled();
  });
});

describe('buildPasteResult', () => {
  it('a mixed paste: top level mirrors the first section, one entry per section, STALE_EXPORT if any stale', async () => {
    const runs = await runPaste(CTX, paste('char', 'raid'), false);
    expect(shouldApplyBinding(runs)).toBe(true);
    const res = buildPasteResult(runs, BINDING);
    expect(res).toMatchObject({
      section: 'char',
      status: 'applied',
      summary: CHAR_SUMMARY,
    });
    expect(res.warnings).toEqual([{ code: 'STALE_EXPORT' }]);
    expect(res.sections).toEqual([
      {
        section: 'char',
        status: 'applied',
        exportedAt: 1_790_000_000,
        summary: CHAR_SUMMARY,
      },
      {
        section: 'raid',
        status: 'stale',
        exportedAt: 1_790_000_000,
        summary: RAID_SUMMARY,
      },
    ]);
  });

  it('a single-section body has no `sections` key', async () => {
    const res = buildPasteResult(
      await runPaste(CTX, paste('char'), false),
      BINDING,
    );
    expect(res).not.toHaveProperty('sections');
  });

  it('binding writes are skipped only when EVERY section is stale', async () => {
    (applyChar as jest.Mock).mockResolvedValue({
      status: 'stale',
      summary: CHAR_SUMMARY,
    });
    expect(
      shouldApplyBinding(await runPaste(CTX, paste('char', 'raid'), false)),
    ).toBe(false);
  });
});
