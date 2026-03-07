/**
 * OgMetaService — XSS prevention, edge cases, fallback OG, meta refresh,
 * HTML structure, and controller integration tests.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { InviteService } from './invite.service';
import { InviteController } from './invite.controller';
import { OgMetaService } from './og-meta.service';
import {
  makeValidInvite,
  setupOgMetaTestModule,
  type OgMetaMocks,
} from './og-meta.service.spec-helpers';

let service: OgMetaService;
let mocks: OgMetaMocks;

async function setupEach() {
  const setup = await setupOgMetaTestModule();
  service = setup.service;
  mocks = setup.mocks;
}

// ─── XSS prevention tests ──────────────────────────────────────────────────

async function testEscapeDoubleQuotes() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: 'Title with "quotes"', game: null }),
  );
  const html = await service.renderInviteOgHtml('xss1');
  expect(html).not.toContain('"quotes"');
  expect(html).toContain('&quot;quotes&quot;');
}

async function testEscapeSingleQuotes() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: "O'Reilly's Bash", game: null }),
  );
  const html = await service.renderInviteOgHtml('xss2');
  expect(html).not.toMatch(/content="[^"]*'[^"]*"/);
  expect(html).toContain('&#39;');
}

async function testEscapeAngleBrackets() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: '<Evil> & "Nasty"', game: null }),
  );
  const html = await service.renderInviteOgHtml('xss3');
  expect(html).not.toContain('<Evil>');
  expect(html).toContain('&lt;Evil&gt;');
}

async function testEscapeAmpersandsTitle() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: 'Raid & Conquer', game: null }),
  );
  const html = await service.renderInviteOgHtml('xss4');
  expect(html).toContain('Raid &amp; Conquer');
  expect(html).not.toContain('Raid & Conquer');
}

async function testEscapeAmpersandsGame() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      game: { name: 'Dungeons & Dragons', coverUrl: null },
    }),
  );
  const html = await service.renderInviteOgHtml('xss5');
  expect(html).toContain('Dungeons &amp; Dragons');
}

async function testEscapeScriptInCover() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      game: { name: 'Test Game', coverUrl: 'javascript:alert("xss")' },
    }),
  );
  const html = await service.renderInviteOgHtml('xss6');
  expect(html).not.toContain('alert("xss")');
}

async function testEscapeAngleBracketsInCover() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      game: {
        name: 'Test Game',
        coverUrl: 'https://cdn.example.com/<evil>.jpg',
      },
    }),
  );
  const html = await service.renderInviteOgHtml('xss7');
  expect(html).not.toContain('<evil>');
  expect(html).toContain('&lt;evil&gt;');
}

async function testUnicodeNotEscaped() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      title: 'Caf\u00e9 Raider \u2014 \u014Ckami Night',
      game: null,
    }),
  );
  const html = await service.renderInviteOgHtml('xss8');
  expect(html).toContain('Caf\u00e9 Raider');
  expect(html).toContain('\u014Ckami Night');
}

async function testNoRawScriptTag() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      title: '<script>document.cookie</script>',
      game: null,
    }),
  );
  const html = await service.renderInviteOgHtml('xss9');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('</script>');
}

// ─── Edge case tests ────────────────────────────────────────────────────────

async function testLongTitle() {
  const longTitle = 'A'.repeat(500);
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: longTitle, game: null }),
  );
  const html = await service.renderInviteOgHtml('long1');
  expect(html).toContain(longTitle);
}

async function testNoStartTime() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: true,
    event: {
      id: 1,
      title: 'Open Night',
      startTime: undefined,
      endTime: undefined,
      game: null,
    },
    slot: { id: 1, role: 'dps', status: 'pending' },
  });
  const html = await service.renderInviteOgHtml('notime');
  expect(html).toContain('og:title');
  expect(html).toContain('Open Night');
}

async function testNullGameField() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('nogame');
  expect(html).not.toContain('og:image');
  expect(html).not.toContain('twitter:image');
  expect(html).toContain('og:title');
  expect(html).toContain('og:description');
}

async function testEmptyCoverUrl() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: { name: 'Unknown Game', coverUrl: null } }),
  );
  const html = await service.renderInviteOgHtml('emptycover');
  expect(html).not.toContain('og:image');
}

async function testNoGameLine() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('nodesc');
  expect(html).not.toContain('Game:');
}

async function testGameLinePresent() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: { name: 'Elden Ring', coverUrl: null } }),
  );
  const html = await service.renderInviteOgHtml('withgame');
  expect(html).toContain('Game: Elden Ring');
}

async function testEncodeInviteCode() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('code with spaces');
  expect(html).toContain('/i/code%20with%20spaces');
}

async function testNullEventObj() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: true,
    event: null,
  });
  const html = await service.renderInviteOgHtml('nullevent');
  expect(html).toContain('Raid Ledger');
  expect(html).toContain('invalid');
}

// ─── Fallback OG tag tests ──────────────────────────────────────────────────

async function testFallbackGeneric() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Invite not found',
  });
  const html = await service.renderInviteOgHtml('bad1');
  expect(html).toContain('invalid or has expired');
}

async function testFallbackNoError() {
  mocks.inviteService.resolveInvite.mockResolvedValue({ valid: false });
  const html = await service.renderInviteOgHtml('bad2');
  expect(html).toContain('invalid or has expired');
}

async function testFallbackExpired() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Event has expired',
  });
  const html = await service.renderInviteOgHtml('bad3');
  expect(html).toContain('already ended');
  expect(html).not.toContain('invalid or has expired');
}

async function testFallbackEnded() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Event has ended',
  });
  const html = await service.renderInviteOgHtml('bad4');
  expect(html).toContain('already ended');
}

async function testFallbackClaimed() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Slot claimed',
  });
  const html = await service.renderInviteOgHtml('bad5');
  expect(html).toContain('already been claimed');
  expect(html).not.toContain('invalid or has expired');
}

async function testFallbackCancelled() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Event cancelled by organizer',
  });
  const html = await service.renderInviteOgHtml('bad6');
  expect(html).toContain('been cancelled');
  expect(html).not.toContain('invalid or has expired');
}

async function testFallbackNoImage() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Invite not found',
  });
  const html = await service.renderInviteOgHtml('bad7');
  expect(html).not.toContain('og:image');
  expect(html).not.toContain('twitter:image');
}

async function testFallbackAllRequiredTags() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Invite not found',
  });
  const html = await service.renderInviteOgHtml('bad8');
  expect(html).toContain('og:type');
  expect(html).toContain('og:site_name');
  expect(html).toContain('og:title');
  expect(html).toContain('og:description');
  expect(html).toContain('og:url');
}

async function testFallbackOnException() {
  mocks.inviteService.resolveInvite.mockRejectedValue(new Error('timeout'));
  const html = await service.renderInviteOgHtml('err1');
  expect(html).toContain('invalid');
  expect(html).not.toContain('og:image');
}

async function testFallbackCaseInsensitiveExpired() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'EXPIRED link',
  });
  const html = await service.renderInviteOgHtml('bad9');
  expect(html).toContain('already ended');
}

async function testFallbackCaseInsensitiveCancelled() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'CANCELLED by admin',
  });
  const html = await service.renderInviteOgHtml('bad10');
  expect(html).toContain('been cancelled');
}

// ─── Meta refresh tests ─────────────────────────────────────────────────────

async function testRefreshValidInvite() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('refresh1');
  expect(html).toMatch(
    /http-equiv="refresh" content="0;url=https:\/\/raid\.example\.com\/i\/refresh1"/,
  );
}

async function testRefreshFallback() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Not found',
  });
  const html = await service.renderInviteOgHtml('refresh2');
  expect(html).toContain('http-equiv="refresh"');
  expect(html).toContain('https://raid.example.com/i/refresh2');
}

async function testRefreshEncodedCode() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('code&special=1');
  expect(html).toContain('code%26special%3D1');
}

// ─── HTML structure tests ───────────────────────────────────────────────────

async function testDoctype() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('struct1');
  expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
}

async function testHtmlLang() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('struct2');
  expect(html).toContain('<html lang="en">');
}

async function testCharsetUtf8() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('struct3');
  expect(html).toContain('charset="UTF-8"');
}

async function testBodyWithAnchor() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('struct4');
  expect(html).toContain('<body>');
  expect(html).toContain('</body>');
  expect(html).toContain('<a href=');
}

async function testTitleTag() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: 'Struct Event', game: null }),
  );
  const html = await service.renderInviteOgHtml('struct5');
  expect(html).toMatch(/<title>You&#39;re invited to: Struct Event<\/title>/);
}

async function testMetaDescription() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('struct6');
  expect(html).toContain('name="description"');
}

async function testFallbackHtmlStructure() {
  mocks.inviteService.resolveInvite.mockRejectedValue(new Error('db down'));
  const html = await service.renderInviteOgHtml('struct7');
  expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('</html>');
}

// ─── Controller integration tests ───────────────────────────────────────────

async function testControllerReturnsHtml() {
  const mockOgMetaService = {
    renderInviteOgHtml: jest.fn().mockResolvedValue('<html>ok</html>'),
  };
  const mockInviteService = {
    resolveInvite: jest.fn(),
    claimInvite: jest.fn(),
  };
  const module: TestingModule = await Test.createTestingModule({
    controllers: [InviteController],
    providers: [
      { provide: InviteService, useValue: mockInviteService },
      { provide: OgMetaService, useValue: mockOgMetaService },
    ],
  }).compile();
  const controller = module.get(InviteController);
  const result = await controller.renderOgMeta('testcode');
  expect(mockOgMetaService.renderInviteOgHtml).toHaveBeenCalledWith('testcode');
  expect(result).toBe('<html>ok</html>');
}

function testRouteRegistered() {
  const proto = InviteController.prototype as unknown as Record<
    string,
    unknown
  >;
  const metadataKeys = Reflect.getMetadataKeys(proto['renderOgMeta'] as object);
  expect(metadataKeys.length).toBeGreaterThan(0);
}

beforeEach(() => setupEach());

describe('OgMetaService — XSS prevention', () => {
  it('should escape double quotes', () => testEscapeDoubleQuotes());
  it('should escape single quotes', () => testEscapeSingleQuotes());
  it('should escape angle brackets', () => testEscapeAngleBrackets());
  it('should escape ampersands in title', () => testEscapeAmpersandsTitle());
  it('should escape ampersands in game name', () => testEscapeAmpersandsGame());
  it('should escape script tags in cover URL', () => testEscapeScriptInCover());
  it('should escape angle brackets in cover URL', () =>
    testEscapeAngleBracketsInCover());
  it('should handle unicode without escaping', () => testUnicodeNotEscaped());
  it('should not render raw script tag', () => testNoRawScriptTag());
});

describe('OgMetaService — edge cases', () => {
  it('should handle very long title', () => testLongTitle());
  it('should handle no startTime', () => testNoStartTime());
  it('should handle null game field', () => testNullGameField());
  it('should handle empty cover URL', () => testEmptyCoverUrl());
  it('should not include Game: line when null', () => testNoGameLine());
  it('should include Game: line when present', () => testGameLinePresent());
  it('should encode special chars in invite code', () =>
    testEncodeInviteCode());
  it('should handle null event object', () => testNullEventObj());
});

describe('OgMetaService — fallback OG tags', () => {
  it('generic invalid gets default description', () => testFallbackGeneric());
  it('no error string gets default description', () => testFallbackNoError());
  it('expired error gets ended description', () => testFallbackExpired());
  it('ended keyword maps to ended description', () => testFallbackEnded());
  it('claimed error gets claimed description', () => testFallbackClaimed());
  it('cancelled error gets cancelled description', () =>
    testFallbackCancelled());
  it('fallback has no og:image', () => testFallbackNoImage());
  it('fallback has all required tags except image', () =>
    testFallbackAllRequiredTags());
  it('exception produces invalid fallback', () => testFallbackOnException());
  it('case-insensitive expired triggers ended', () =>
    testFallbackCaseInsensitiveExpired());
  it('case-insensitive cancelled triggers cancelled', () =>
    testFallbackCaseInsensitiveCancelled());
});

describe('OgMetaService — meta refresh redirect', () => {
  it('should redirect for valid invite', () => testRefreshValidInvite());
  it('should redirect for fallback pages', () => testRefreshFallback());
  it('should redirect with encoded invite code', () =>
    testRefreshEncodedCode());
});

describe('OgMetaService — HTML structure', () => {
  it('should start with DOCTYPE', () => testDoctype());
  it('should contain html lang="en"', () => testHtmlLang());
  it('should have charset UTF-8', () => testCharsetUtf8());
  it('should have body with anchor', () => testBodyWithAnchor());
  it('should have title tag matching og:title', () => testTitleTag());
  it('should have meta description tag', () => testMetaDescription());
  it('fallback should also be well-formed', () => testFallbackHtmlStructure());
});

describe('InviteController — OG endpoint', () => {
  it('should return HTML from OgMetaService', () =>
    testControllerReturnsHtml());
  it('renderOgMeta route is registered', () => testRouteRegistered());
});
