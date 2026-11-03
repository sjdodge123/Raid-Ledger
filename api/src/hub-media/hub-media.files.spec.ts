/**
 * ROK-2068 NITs — `unlinkMediaFiles` attempts BOTH renditions even when the
 * full-size unlink fails, reports each failure to Sentry, and still rejects
 * with the first failure (callers keep their behaviour).
 */
import { rm } from 'node:fs/promises';
import * as Sentry from '@sentry/nestjs';
import { unlinkMediaFiles } from './hub-media.files';

jest.mock('node:fs/promises', () => ({
  rename: jest.fn(),
  rm: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const NAME = '0b6f6c1e-8a5d-4c1f-9a7e-2f3b4c5d6e7f';
const rmMock = jest.mocked(rm);
const capture = jest.mocked(Sentry.captureException);

const removed = (): string[] =>
  rmMock.mock.calls.map(([p]) => String(p).split('/').pop() ?? '');

describe('unlinkMediaFiles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('removes both renditions and reports nothing when both succeed', async () => {
    rmMock.mockResolvedValue(undefined);
    await unlinkMediaFiles(4, NAME);
    expect(removed()).toEqual([`${NAME}.webp`, `${NAME}.thumb.webp`]);
    expect(capture).not.toHaveBeenCalled();
  });

  it('a failed full-size unlink still unlinks the thumbnail, reports, and rejects', async () => {
    const boom = new Error('EACCES full');
    rmMock.mockRejectedValueOnce(boom).mockResolvedValueOnce(undefined);
    await expect(unlinkMediaFiles(4, NAME)).rejects.toBe(boom);
    expect(removed()).toEqual([`${NAME}.webp`, `${NAME}.thumb.webp`]);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(boom, {
      tags: { context: 'hub-media-unlink' },
      extra: { guildId: 4, storageName: NAME },
    });
  });

  it('reports every failure and rejects with the first', async () => {
    const full = new Error('EIO full');
    const thumb = new Error('EIO thumb');
    rmMock.mockRejectedValueOnce(full).mockRejectedValueOnce(thumb);
    await expect(unlinkMediaFiles(4, NAME)).rejects.toBe(full);
    expect(capture.mock.calls.map(([e]) => e)).toEqual([full, thumb]);
  });
});
