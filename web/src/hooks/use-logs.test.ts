/**
 * ROK-1164 — a single-file download saves under the filename the server
 * chose (a `.gz` generation arrives decompressed, named without `.gz`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadLogFile, filenameFromDisposition } from './use-logs';

describe('downloadLogFile (ROK-1164)', () => {
  let savedAs: string[];

  beforeEach(() => {
    savedAs = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        savedAs.push(this.download);
      },
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  function serve(disposition: string | null) {
    const headers = new Headers();
    if (disposition) headers.set('Content-Disposition', disposition);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('text', { status: 200, headers }),
    );
  }

  it('saves a decompressed .gz generation under the server-chosen name', async () => {
    serve('attachment; filename="api.log.2"');
    await downloadLogFile('api.log.2.gz');
    expect(savedAs).toEqual(['api.log.2']);
  });

  it('falls back to the requested name when the header is unreadable', async () => {
    serve(null);
    await downloadLogFile('api.log');
    expect(savedAs).toEqual(['api.log']);
  });

  it('parses the quoted filename out of Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="a.log.1"')).toBe(
      'a.log.1',
    );
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
