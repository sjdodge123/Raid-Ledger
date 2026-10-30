import { readFile } from 'node:fs/promises';
import type Redis from 'ioredis';
import type { GuildActor } from '../guild-access.service';
import { encodeGuildCrest } from './hub-crest.encode';
import { deleteCrestFiles, writeCrestFiles } from './hub-crest.paths';
import {
  findCrestRow,
  findGalleryStorageName,
  updateCrestRow,
  type CrestPatch,
  type CrestRow,
} from './hub-crest.queries';
import { HubCrestService } from './hub-crest.service';

jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('./hub-crest.encode', () => ({ encodeGuildCrest: jest.fn() }));
jest.mock('./hub-crest.queries', () => ({
  findCrestRow: jest.fn(),
  findGalleryStorageName: jest.fn(),
  updateCrestRow: jest.fn(),
}));
jest.mock('./hub-crest.paths', () => ({
  ...jest.requireActual<object>('./hub-crest.paths'),
  writeCrestFiles: jest.fn(),
  deleteCrestFiles: jest.fn(),
}));

const OLD = 'a'.repeat(32);
const NEW = 'b'.repeat(32);
const PRESET = { emblemId: 'crossed-swords', fg: 'or', bg: 'gules' } as const;
const editor: GuildActor = { id: 7, role: 'member' };
const staff: GuildActor = { id: 1, role: 'admin' };

let row: CrestRow;
const redis = { eval: jest.fn() };
const svc = new HubCrestService(
  {} as ConstructorParameters<typeof HubCrestService>[0],
  redis as unknown as Redis,
);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GUILD_CREST_UPLOAD_PER_HOUR;
  delete process.env.THROTTLE_DISABLED;
  row = {
    id: 5,
    crestActive: 'upload',
    crestUploadKey: OLD,
    crestPreset: { ...PRESET },
    crestRemovedAt: null,
  };
  redis.eval.mockResolvedValue(1);
  jest.mocked(findCrestRow).mockImplementation(() => Promise.resolve(row));
  jest.mocked(updateCrestRow).mockImplementation((_db, _id, build) => {
    const patch: CrestPatch | null = build(row);
    return Promise.resolve(
      patch ? { before: row, after: { ...row, ...patch } as CrestRow } : null,
    );
  });
  jest.mocked(encodeGuildCrest).mockResolvedValue({
    ok: true,
    key: NEW,
    sm: Buffer.from('sm'),
    lg: Buffer.from('lg'),
  });
});

describe('HubCrestService.get', () => {
  it('returns the editor state for the hub', async () => {
    const state = await svc.get(5);
    expect(state.active).toBe('upload');
    expect(state.upload?.urlLg).toBe(`/uploads/guild-crests/5/${OLD}.lg.webp`);
  });

  it('404s for a missing hub', async () => {
    jest.mocked(findCrestRow).mockResolvedValue(null);
    await expect(svc.get(5)).rejects.toMatchObject({ status: 404 });
  });
});

describe('HubCrestService.set', () => {
  it('saves and shows a preset', async () => {
    const state = await svc.set(editor, 5, {
      active: 'preset',
      preset: PRESET,
    });
    expect(state).toMatchObject({ active: 'preset', preset: PRESET });
  });

  it('400s when asked to show an upload that is not stored', async () => {
    row.crestUploadKey = null;
    await expect(
      svc.set(editor, 5, { active: 'upload' }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('400s on a body that fails the schema', async () => {
    await expect(svc.set(editor, 5, { active: 'nope' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('clears the shown crest with {active:null}', async () => {
    const state = await svc.set(editor, 5, { active: null });
    expect(state.active).toBeNull();
  });
});

describe('HubCrestService.upload', () => {
  it('writes the files, points at the new key, deletes the old files after the update', async () => {
    const state = await svc.upload(editor, 5, Buffer.from('png'));
    expect(writeCrestFiles).toHaveBeenCalledWith(5, NEW, expect.anything());
    expect(state.upload?.urlSm).toBe(`/uploads/guild-crests/5/${NEW}.sm.webp`);
    expect(deleteCrestFiles).toHaveBeenCalledWith(5, OLD);
    const updated =
      jest.mocked(updateCrestRow).mock.invocationCallOrder[0] ?? 0;
    const deleted =
      jest.mocked(deleteCrestFiles).mock.invocationCallOrder[0] ?? 0;
    expect(deleted).toBeGreaterThan(updated);
  });

  it('keeps the files when the same bytes are re-uploaded', async () => {
    row.crestUploadKey = NEW;
    await svc.upload(editor, 5, Buffer.from('png'));
    expect(deleteCrestFiles).not.toHaveBeenCalled();
  });

  it('maps an encode refusal to a coded 415 and writes nothing', async () => {
    jest
      .mocked(encodeGuildCrest)
      .mockResolvedValue({ ok: false, code: 'not_image' });
    await expect(svc.upload(editor, 5, Buffer.from('x'))).rejects.toMatchObject(
      {
        status: 415,
        response: expect.objectContaining({ code: 'not_image' }),
      },
    );
    expect(writeCrestFiles).not.toHaveBeenCalled();
  });

  it('maps a too-small image to a coded 422', async () => {
    jest
      .mocked(encodeGuildCrest)
      .mockResolvedValue({ ok: false, code: 'too_small' });
    await expect(svc.upload(editor, 5, Buffer.from('x'))).rejects.toMatchObject(
      {
        status: 422,
        response: expect.objectContaining({ code: 'too_small' }),
      },
    );
  });

  it('429s past the hourly window, before encoding', async () => {
    redis.eval.mockResolvedValue(11);
    await expect(svc.upload(editor, 5, Buffer.from('x'))).rejects.toMatchObject(
      {
        status: 429,
        response: expect.objectContaining({ code: 'rate_limited' }),
      },
    );
    expect(encodeGuildCrest).not.toHaveBeenCalled();
  });

  it('THROTTLE_DISABLED lifts the window', async () => {
    process.env.THROTTLE_DISABLED = 'true';
    redis.eval.mockResolvedValue(999);
    await svc.upload(editor, 5, Buffer.from('x'));
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

describe('HubCrestService.fromGallery', () => {
  it('re-encodes the gallery full file of THIS hub as the upload', async () => {
    jest
      .mocked(findGalleryStorageName)
      .mockResolvedValue('0f8fad5b-d9cb-469f-a165-70867728950e');
    jest.mocked(readFile).mockResolvedValue(Buffer.from('webp'));
    const state = await svc.fromGallery(editor, 5, { mediaId: 3 });
    expect(findGalleryStorageName).toHaveBeenCalledWith(
      expect.anything(),
      5,
      3,
    );
    const path = jest.mocked(readFile).mock.calls[0]?.[0];
    expect(typeof path === 'string' ? path : '').toMatch(
      /5[\\/]0f8fad5b-d9cb-469f-a165-70867728950e\.webp$/,
    );
    expect(encodeGuildCrest).toHaveBeenCalledWith(Buffer.from('webp'));
    expect(state.active).toBe('upload');
  });

  it('404s for a media id that is not in this hub, without encoding', async () => {
    jest.mocked(findGalleryStorageName).mockResolvedValue(null);
    await expect(
      svc.fromGallery(editor, 5, { mediaId: 3 }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(encodeGuildCrest).not.toHaveBeenCalled();
  });

  it('400s on a bad body', async () => {
    await expect(
      svc.fromGallery(editor, 5, { mediaId: -1 }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('HubCrestService.removeUpload', () => {
  it('403s for a non-staff editor', async () => {
    await expect(svc.removeUpload(editor, 5)).rejects.toMatchObject({
      status: 403,
    });
    expect(updateCrestRow).not.toHaveBeenCalled();
  });

  it('staff removal records who/when, falls back to the preset, deletes the files', async () => {
    const state = await svc.removeUpload(staff, 5);
    expect(state).toMatchObject({ active: 'preset', upload: null });
    expect(state.removedByStaffAt).not.toBeNull();
    expect(deleteCrestFiles).toHaveBeenCalledWith(5, OLD);
  });

  it('404s when there is no upload to remove', async () => {
    row.crestUploadKey = null;
    await expect(svc.removeUpload(staff, 5)).rejects.toMatchObject({
      status: 404,
    });
  });
});
