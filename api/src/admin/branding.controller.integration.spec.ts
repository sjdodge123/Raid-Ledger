/**
 * ROK-1292 PR 2 — branding logo upload SVG XSS hardening.
 *
 * SVG can carry inline <script>, and the controller currently accepts
 * `image/svg+xml`. Any admin (or attacker with stolen admin creds) can
 * upload a script payload that the SPA later renders verbatim from
 * `/uploads/branding/logo.svg`. PR 2 removes SVG from the allowed-types
 * map. These tests fail today (SVG mime currently passes the filter and
 * a `<` first byte satisfies the magic-byte check, so the API returns
 * 201) and will pass once SVG is dropped.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import { BrandingController } from './branding.controller';

const BRANDING_DIR = path.join(process.cwd(), 'uploads', 'branding');

function clearBrandingDir(): void {
  if (!fs.existsSync(BRANDING_DIR)) return;
  for (const entry of fs.readdirSync(BRANDING_DIR)) {
    try {
      fs.unlinkSync(path.join(BRANDING_DIR, entry));
    } catch {
      // best-effort
    }
  }
}

/** Minimal valid PNG: 8-byte signature + IHDR (1x1) + IDAT + IEND. */
function makeTinyPngBuffer(): Buffer {
  return Buffer.from([
    // PNG signature
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR chunk: length=13, type=IHDR, width=1, height=1, bitdepth=8,
    // colortype=2 (RGB), compression=0, filter=0, interlace=0, CRC.
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde,
    // IDAT chunk: length=12, type=IDAT, deflate stream for 1 RGB pixel, CRC.
    0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
    0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0x6e, 0x2e, 0xf6,
    // IEND chunk: length=0, type=IEND, CRC.
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe('ROK-1292 PR 2 — branding logo SVG XSS rejection', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    clearBrandingDir();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    // SettingsService caches the branding row; reset it so the next test
    // sees a clean slate even though truncateAllTables already wiped the
    // table.
    await testApp.app.get(SettingsService).clearBranding();
  });

  afterAll(() => {
    clearBrandingDir();
  });

  it('rejects an SVG containing <script> with 400 and an error message that does not name SVG', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const res = await testApp.request
      .post('/admin/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', Buffer.from(svg, 'utf8'), {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    const message = JSON.stringify(res.body);
    expect(message).not.toMatch(/SVG/);
  });

  it('rejects an SVG with no <script> tag with 400 (the format itself is no longer accepted)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
    const res = await testApp.request
      .post('/admin/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', Buffer.from(svg, 'utf8'), {
        filename: 'safe.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
  });

  it('on boot, removes any legacy logo.svg from disk and clears community_logo_path if it points to .svg (Codex P1)', async () => {
    if (!fs.existsSync(BRANDING_DIR))
      fs.mkdirSync(BRANDING_DIR, { recursive: true });
    const svgPath = path.join(BRANDING_DIR, 'logo.svg');
    fs.writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const settings = testApp.app.get(SettingsService);
    await settings.setCommunityLogoPath(svgPath);
    expect(fs.existsSync(svgPath)).toBe(true);
    expect((await settings.getBranding()).communityLogoPath).toBe(svgPath);

    await testApp.app.get(BrandingController).onModuleInit();

    expect(fs.existsSync(svgPath)).toBe(false);
    expect((await settings.getBranding()).communityLogoPath).toBeNull();
  });

  it('on boot, leaves a non-SVG logo intact (no false-positive eviction)', async () => {
    if (!fs.existsSync(BRANDING_DIR))
      fs.mkdirSync(BRANDING_DIR, { recursive: true });
    const pngPath = path.join(BRANDING_DIR, 'logo.png');
    fs.writeFileSync(pngPath, makeTinyPngBuffer());
    const settings = testApp.app.get(SettingsService);
    await settings.setCommunityLogoPath(pngPath);

    await testApp.app.get(BrandingController).onModuleInit();

    expect(fs.existsSync(pngPath)).toBe(true);
    expect((await settings.getBranding()).communityLogoPath).toBe(pngPath);
  });

  it('accepts a valid PNG and exposes a .png logo URL (regression baseline)', async () => {
    const png = makeTinyPngBuffer();
    const res = await testApp.request
      .post('/admin/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('logo', png, {
        filename: 'logo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      communityLogoUrl: expect.stringMatching(/\.png$/),
    });
  });
});
