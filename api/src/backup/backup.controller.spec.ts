import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import type { Response } from 'express';
import { BackupController } from './backup.controller';
import type { BackupService } from './backup.service';

type MockRes = Writable & {
  setHeader: jest.Mock;
  destroy: jest.Mock;
};

/** A writable sink that satisfies stream.pipe() without touching a socket. */
function createMockRes(): MockRes {
  const res = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  }) as MockRes;
  res.setHeader = jest.fn();
  return res;
}

describe('BackupController', () => {
  describe('downloadBackup', () => {
    it('destroys the response when the read stream errors (TOCTOU race)', async () => {
      // getBackupFilePath existsSync-validates then returns the path; the file
      // can vanish before createReadStream opens it, which surfaces as an
      // async ENOENT 'error' on the stream.
      const missingPath = path.join(
        os.tmpdir(),
        `rl-toctou-${Date.now()}-${Math.random().toString(36).slice(2)}.dump`,
      );
      const backupService = {
        getBackupFilePath: jest.fn().mockReturnValue(missingPath),
      } as unknown as BackupService;
      const controller = new BackupController(backupService);

      const res = createMockRes();
      const destroyed = new Promise<NodeJS.ErrnoException>((resolve) => {
        res.destroy = jest.fn((err: NodeJS.ErrnoException) => {
          resolve(err);
          return res;
        });
      });

      controller.downloadBackup('daily', 'x.dump', res as unknown as Response);

      const err = await destroyed;
      expect(err.code).toBe('ENOENT');
      expect(res.destroy).toHaveBeenCalledTimes(1);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/octet-stream',
      );
    });
  });
});
