import { EventEmitter, PassThrough } from 'stream';
import type { IncomingMessage } from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as https from 'https';
import * as http from 'http';

type HttpsGetCb = (res: IncomingMessage) => void;

jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('https');
jest.mock('http');

const mockCreateWriteStream = fs.createWriteStream as jest.Mock;
const mockHttpsGet = https.get as jest.Mock;
const mockHttpGet = http.get as jest.Mock;
const mockRename = fsp.rename as jest.Mock;
const mockChmod = fsp.chmod as jest.Mock;
const mockUnlink = fsp.unlink as jest.Mock;

import { downloadFile } from './ollama-native.helpers';

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
    ).rejects.toThrow('Download failed: HTTP 500');

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
