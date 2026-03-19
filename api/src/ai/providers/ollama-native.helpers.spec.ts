import { EventEmitter, PassThrough } from 'stream';
import type { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as https from 'https';
import * as http from 'http';
import * as childProcess from 'child_process';

type HttpsGetCb = (res: IncomingMessage) => void;

jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  mkdtemp: jest.fn().mockResolvedValue('/tmp/ollama-abc123'),
  rm: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('https');
jest.mock('http');
jest.mock('child_process');

const mockCreateWriteStream = fs.createWriteStream as jest.Mock;
const mockExistsSync = fs.existsSync as jest.Mock;
const mockHttpsGet = https.get as jest.Mock;
const mockHttpGet = http.get as jest.Mock;
const mockRename = fsp.rename as jest.Mock;
const mockChmod = fsp.chmod as jest.Mock;
const mockUnlink = fsp.unlink as jest.Mock;
const mockMkdtemp = fsp.mkdtemp as jest.Mock;
const mockRm = fsp.rm as jest.Mock;
const mockExecFile = childProcess.execFile as unknown as jest.Mock;

import {
  downloadFile,
  downloadAndExtractBinary,
} from './ollama-native.helpers';

describe('downloadFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads, sets permissions, and renames atomically', async () => {
    const response = new PassThrough();
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      cb(
        Object.assign(response, {
          statusCode: 200,
        }) as unknown as IncomingMessage,
      );
      setTimeout(() => response.end('binary-data'), 10);
      return req;
    });

    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await downloadFile('https://example.com/ollama', '/usr/local/bin/ollama');

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tmp',
    );
    expect(mockChmod).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp', 0o755);
    expect(mockRename).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tmp',
      '/usr/local/bin/ollama',
    );
  });

  it('follows redirects', async () => {
    let callCount = 0;
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      callCount++;
      if (callCount === 1) {
        const redirect = new PassThrough();
        Object.assign(redirect, {
          statusCode: 302,
          headers: { location: 'https://cdn.example.com/ollama' },
          resume: jest.fn(),
        });
        cb(redirect as unknown as IncomingMessage);
      } else {
        const response = new PassThrough();
        cb(
          Object.assign(response, {
            statusCode: 200,
          }) as unknown as IncomingMessage,
        );
        setTimeout(() => response.end('binary-data'), 10);
      }
      return req;
    });

    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await downloadFile('https://example.com/ollama', '/usr/local/bin/ollama');

    expect(callCount).toBe(2);
    expect(mockRename).toHaveBeenCalled();
  });

  it('cleans up temp file on download error', async () => {
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      const response = new PassThrough();
      Object.assign(response, { statusCode: 500, resume: jest.fn() });
      cb(response as unknown as IncomingMessage);
      return req;
    });

    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow(
      'Download failed: HTTP 500 from https://example.com/ollama',
    );

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
  });

  it('cleans up temp file when rename fails after successful download', async () => {
    const response = new PassThrough();
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      cb(
        Object.assign(response, {
          statusCode: 200,
        }) as unknown as IncomingMessage,
      );
      setTimeout(() => response.end('binary-data'), 10);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);
    mockRename.mockRejectedValueOnce(new Error('EXDEV: cross-device link'));

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow('EXDEV: cross-device link');

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
  });

  it('cleans up temp file when chmod fails', async () => {
    const response = new PassThrough();
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      cb(
        Object.assign(response, {
          statusCode: 200,
        }) as unknown as IncomingMessage,
      );
      setTimeout(() => response.end('binary-data'), 10);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);
    mockChmod.mockRejectedValueOnce(
      new Error('EPERM: operation not permitted'),
    );

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow('EPERM: operation not permitted');

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('rejects with "Too many redirects" after exceeding MAX_REDIRECTS', async () => {
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      const redirect = new PassThrough();
      Object.assign(redirect, {
        statusCode: 301,
        headers: { location: 'https://example.com/ollama' },
        resume: jest.fn(),
      });
      cb(redirect as unknown as IncomingMessage);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow('Too many redirects');

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
  });

  it('uses http.get for plain HTTP URLs', async () => {
    const response = new PassThrough();
    mockHttpGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      cb(
        Object.assign(response, {
          statusCode: 200,
        }) as unknown as IncomingMessage,
      );
      setTimeout(() => response.end('binary-data'), 10);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await downloadFile(
      'http://internal.example.com/ollama',
      '/usr/local/bin/ollama',
    );

    expect(mockHttpGet).toHaveBeenCalled();
    expect(mockHttpsGet).not.toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalled();
  });

  it('cleans up temp file on network-level connection error', async () => {
    mockHttpsGet.mockImplementation(() => {
      const req = new EventEmitter();
      setTimeout(() => req.emit('error', new Error('ECONNREFUSED')), 10);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow('ECONNREFUSED');

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
  });

  it('cleans up temp file when write stream emits an error', async () => {
    const response = new PassThrough();
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      cb(
        Object.assign(response, {
          statusCode: 200,
        }) as unknown as IncomingMessage,
      );
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);
    setTimeout(
      () =>
        writeStream.emit('error', new Error('ENOSPC: no space left on device')),
      20,
    );

    await expect(
      downloadFile('https://example.com/ollama', '/usr/local/bin/ollama'),
    ).rejects.toThrow('ENOSPC: no space left on device');

    expect(mockUnlink).toHaveBeenCalledWith('/usr/local/bin/ollama.tmp');
  });
});

/** Mock a successful HTTPS download (200 OK with data). */
function mockSuccessfulDownload(): void {
  const response = new PassThrough();
  mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
    const req = new EventEmitter();
    cb(
      Object.assign(response, {
        statusCode: 200,
      }) as unknown as IncomingMessage,
    );
    setTimeout(() => response.end('archive-data'), 10);
    return req;
  });
  const writeStream = new PassThrough();
  mockCreateWriteStream.mockReturnValue(writeStream);
}

/** Mock execFile to succeed (tar extraction). */
function mockTarSuccess(): void {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null) => void,
    ) => {
      cb(null);
    },
  );
}

describe('downloadAndExtractBinary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('downloads archive, extracts, and places binary at dest', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();

    await downloadAndExtractBinary(
      'https://example.com/ollama.tar.zst',
      '/usr/local/bin/ollama',
    );

    expect(mockCreateWriteStream).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockMkdtemp).toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledWith(
      'tar',
      [
        '--zstd',
        '-xf',
        '/usr/local/bin/ollama.tar.zst.tmp',
        '-C',
        '/tmp/ollama-abc123',
      ],
      expect.objectContaining({ timeout: 300_000 }),
      expect.any(Function),
    );
    expect(mockChmod).toHaveBeenCalledWith(
      '/tmp/ollama-abc123/bin/ollama',
      0o755,
    );
    expect(mockRename).toHaveBeenCalledWith(
      '/tmp/ollama-abc123/bin/ollama',
      '/usr/local/bin/ollama',
    );
  });

  it('cleans up archive and extract dir on success', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();

    await downloadAndExtractBinary(
      'https://example.com/ollama.tar.zst',
      '/usr/local/bin/ollama',
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/ollama-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('throws when bin/ollama not found in archive', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();
    mockExistsSync.mockReturnValue(false);

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('bin/ollama not found in archive');

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/ollama-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('cleans up on tar extraction failure', async () => {
    mockSuccessfulDownload();
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null) => void,
      ) => {
        cb(new Error('tar: zstd: No such file or directory'));
      },
    );

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('tar: zstd: No such file or directory');

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/ollama-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('cleans up on download failure', async () => {
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      const response = new PassThrough();
      Object.assign(response, { statusCode: 404, resume: jest.fn() });
      cb(response as unknown as IncomingMessage);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('Download failed: HTTP 404');

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
  });

  it('error message includes the URL when HTTP 404 occurs', async () => {
    const archiveUrl =
      'https://github.com/ollama/ollama/releases/latest/download/ollama-linux-amd64.tar.zst';
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      const response = new PassThrough();
      Object.assign(response, { statusCode: 404, resume: jest.fn() });
      cb(response as unknown as IncomingMessage);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadAndExtractBinary(archiveUrl, '/usr/local/bin/ollama'),
    ).rejects.toThrow(`Download failed: HTTP 404 from ${archiveUrl}`);
  });

  it('error message includes URL for HTTP 403 forbidden', async () => {
    const archiveUrl = 'https://example.com/ollama.tar.zst';
    mockHttpsGet.mockImplementation((_url: string, cb: HttpsGetCb) => {
      const req = new EventEmitter();
      const response = new PassThrough();
      Object.assign(response, { statusCode: 403, resume: jest.fn() });
      cb(response as unknown as IncomingMessage);
      return req;
    });
    const writeStream = new PassThrough();
    mockCreateWriteStream.mockReturnValue(writeStream);

    await expect(
      downloadAndExtractBinary(archiveUrl, '/usr/local/bin/ollama'),
    ).rejects.toThrow(`Download failed: HTTP 403 from ${archiveUrl}`);
  });

  it('does not attempt to rm extractDir when mkdtemp fails', async () => {
    mockSuccessfulDownload();
    mockMkdtemp.mockRejectedValueOnce(
      new Error('ENOSPC: no space left on device'),
    );

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('ENOSPC: no space left on device');

    // Archive is still cleaned up
    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    // extractDir was never set, so rm should not be called
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('cleans up and propagates error when chmod on extracted binary fails', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();
    mockChmod.mockRejectedValueOnce(
      new Error('EPERM: operation not permitted'),
    );

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('EPERM: operation not permitted');

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/ollama-abc123', {
      recursive: true,
      force: true,
    });
    // Rename must not be called when chmod failed
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('cleans up and propagates error when rename fails after chmod', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();
    mockRename.mockRejectedValueOnce(new Error('EXDEV: cross-device link'));

    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).rejects.toThrow('EXDEV: cross-device link');

    expect(mockUnlink).toHaveBeenCalledWith(
      '/usr/local/bin/ollama.tar.zst.tmp',
    );
    expect(mockRm).toHaveBeenCalledWith('/tmp/ollama-abc123', {
      recursive: true,
      force: true,
    });
  });

  it('does not propagate cleanup errors — rm failure is swallowed', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();
    mockRm.mockRejectedValueOnce(new Error('EBUSY: resource busy or locked'));

    // The main operation should succeed despite rm failing in finally
    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).resolves.toBeUndefined();
  });

  it('does not propagate cleanup errors — unlink failure is swallowed', async () => {
    mockSuccessfulDownload();
    mockTarSuccess();
    mockUnlink.mockRejectedValueOnce(
      new Error('ENOENT: no such file or directory'),
    );

    // The main operation should succeed despite unlink failing in finally
    await expect(
      downloadAndExtractBinary(
        'https://example.com/ollama.tar.zst',
        '/usr/local/bin/ollama',
      ),
    ).resolves.toBeUndefined();
  });
});
