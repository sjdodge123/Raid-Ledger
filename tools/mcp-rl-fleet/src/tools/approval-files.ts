// ROK-1900 — local file reads for rl_approval_submit. The TOOL reads the
// mockup / spec / screenshots (agents never paste HTML or base64), checks the
// dashboard's caps before any network round-trip (spec D7), and warns about
// mockups that load outside URLs, which the sandboxed iframe blocks (Q9).
import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

export const CAPS = Object.freeze({
  mockupBytes: 512 * 1024,
  specBytes: 256 * 1024,
  screenshots: 8,
  screenshotBytes: 5 * 1024 * 1024,
});

export class SubmitFileError extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'SubmitFileError';
  }
}

export interface SubmitFiles {
  mockup_html?: string;
  spec_md?: string;
  screenshots?: Array<{ name: string; b64: string }>;
}

// src/href/srcset/url()/@import pointing at http(s) or protocol-relative.
const EXTERNAL_RE =
  /(?:\b(?:src|href|srcset|action|poster|data)\s*=\s*["']?\s*(?:https?:)?\/\/)|(?:url\(\s*["']?\s*(?:https?:)?\/\/)|(?:@import\s+["']?(?:https?:)?\/\/)/i;
const SPEC_PATH_RE = /^[A-Za-z0-9_./-]+$/;
const SHOT_NAME_RE = /[^A-Za-z0-9 _.()-]/g;

export const mockupLoadsExternalUrls = (html: string): boolean => EXTERNAL_RE.test(html);

async function readCapped(path: string, cap: number, code: string, label: string): Promise<Buffer> {
  if (!isAbsolute(path)) throw new SubmitFileError('path_not_absolute', `${label} must be an absolute path`);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    throw new SubmitFileError('file_not_found', `${label}: ${path}`);
  }
  if (size > cap) throw new SubmitFileError(code, `${label} is ${size} bytes; max ${cap}`);
  return readFile(path);
}

/** Repo-relative form of a spec path for display, or undefined if it cannot be expressed safely. */
export function relativeSpecPath(abs: string): string | undefined {
  const i = abs.indexOf('/planning-artifacts/');
  const rel = i >= 0 ? abs.slice(i + 1) : basename(abs);
  if (!SPEC_PATH_RE.test(rel) || rel.split('/').includes('..')) return undefined;
  return rel;
}

export async function readSubmitFiles(p: {
  mockup_path?: string | undefined;
  spec_path?: string | undefined;
  screenshot_paths?: string[] | undefined;
}): Promise<{ files: SubmitFiles; warnings: string[] }> {
  const files: SubmitFiles = {};
  const warnings: string[] = [];
  if (p.mockup_path !== undefined) {
    const html = (await readCapped(p.mockup_path, CAPS.mockupBytes, 'mockup_too_large', 'mockup')).toString('utf8');
    files.mockup_html = html;
    if (mockupLoadsExternalUrls(html)) {
      warnings.push(
        'mockup loads external URLs (fonts/images/scripts from the web) — the sandboxed inbox iframe blocks them; inline them (data: URIs) so the operator sees what you intended',
      );
    }
  }
  if (p.spec_path !== undefined) {
    files.spec_md = (await readCapped(p.spec_path, CAPS.specBytes, 'spec_too_large', 'spec')).toString('utf8');
  }
  const shots = p.screenshot_paths ?? [];
  if (shots.length > CAPS.screenshots) {
    throw new SubmitFileError('too_many_screenshots', `${shots.length} given; max ${CAPS.screenshots}`);
  }
  if (shots.length > 0) {
    files.screenshots = [];
    for (const [i, path] of shots.entries()) {
      const buf = await readCapped(path, CAPS.screenshotBytes, 'screenshot_too_large', `screenshot_paths[${i}]`);
      const name = basename(path).replace(SHOT_NAME_RE, '_').slice(0, 100) || `shot-${i + 1}`;
      files.screenshots.push({ name, b64: buf.toString('base64') });
    }
  }
  return { files, warnings };
}
