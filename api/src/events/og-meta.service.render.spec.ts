/**
 * OgMetaService — renderInviteOgHtml, OG tag content, and Twitter card tests.
 */
import {
  makeValidInvite,
  setupOgMetaTestModule,
  type OgMetaMocks,
} from './og-meta.service.spec-helpers';
import type { OgMetaService } from './og-meta.service';

let service: OgMetaService;
let mocks: OgMetaMocks;

async function setupEach() {
  const setup = await setupOgMetaTestModule();
  service = setup.service;
  mocks = setup.mocks;
}

// ─── renderInviteOgHtml tests ───────────────────────────────────────────────

async function testValidInviteOgTags() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      title: 'Mythic+ Monday',
      game: {
        name: 'World of Warcraft',
        coverUrl: 'https://images.igdb.com/cover.jpg',
      },
    }),
  );
  const html = await service.renderInviteOgHtml('abc123');
  expect(html).toContain('og:title');
  expect(html).toContain('You&#39;re invited to: Mythic+ Monday');
  expect(html).toContain('og:description');
  expect(html).toContain('World of Warcraft');
  expect(html).toContain('og:image');
  expect(html).toContain('https://images.igdb.com/cover.jpg');
  expect(html).toContain('og:url');
  expect(html).toContain('https://raid.example.com/i/abc123');
  expect(html).toContain('og:type');
  expect(html).toContain('og:site_name');
  expect(html).toContain('Raid Ledger');
  expect(html).toContain('twitter:card');
  expect(html).toContain('twitter:title');
  expect(html).toContain('twitter:description');
}

async function testFallbackInvalidInvite() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'Invite not found',
  });
  const html = await service.renderInviteOgHtml('bad-code');
  expect(html).toContain('og:title');
  expect(html).toContain('Raid Ledger');
  expect(html).toContain('invalid or has expired');
  expect(html).not.toContain('og:image');
}

async function testFallbackClaimedInvite() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'This invite has already been claimed',
  });
  const html = await service.renderInviteOgHtml('claimed-code');
  expect(html).toContain('already been claimed');
}

async function testFallbackEndedEvent() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'This event has already ended',
  });
  const html = await service.renderInviteOgHtml('expired-code');
  expect(html).toContain('already ended');
}

async function testFallbackCancelledEvent() {
  mocks.inviteService.resolveInvite.mockResolvedValue({
    valid: false,
    error: 'This event has been cancelled',
  });
  const html = await service.renderInviteOgHtml('cancelled-code');
  expect(html).toContain('been cancelled');
}

async function testResolveInviteError() {
  mocks.inviteService.resolveInvite.mockRejectedValue(
    new Error('Database connection failed'),
  );
  const html = await service.renderInviteOgHtml('error-code');
  expect(html).toContain('og:title');
  expect(html).toContain('Raid Ledger');
  expect(html).toContain('invalid');
}

async function testXssEscapeTitle() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ title: '<script>alert("xss")</script>', game: null }),
  );
  const html = await service.renderInviteOgHtml('xss-code');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
}

async function testNoCoverArt() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: { name: 'Custom Game', coverUrl: null } }),
  );
  const html = await service.renderInviteOgHtml('no-cover');
  expect(html).not.toContain('og:image');
  expect(html).not.toContain('twitter:image');
}

async function testMetaRefreshRedirect() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('test-code');
  expect(html).toContain('http-equiv="refresh"');
  expect(html).toContain('https://raid.example.com/i/test-code');
}

async function testLocalhostFallback() {
  mocks.settingsService.getClientUrl.mockResolvedValue(null);
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('local-code');
  expect(html).toContain('http://localhost:5173/i/local-code');
}

// ─── OG tag content tests ───────────────────────────────────────────────────

function setupTagContentBeforeEach() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      title: 'Mythic+ Monday',
      startTime: '2026-03-02T20:00:00.000Z',
      game: {
        name: 'World of Warcraft',
        coverUrl: 'https://images.igdb.com/cover.jpg',
      },
    }),
  );
}

async function testOgTypeWebsite() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toMatch(/property="og:type"\s+content="website"/);
}

async function testOgSiteName() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toMatch(/property="og:site_name"\s+content="Raid Ledger"/);
}

async function testOgTitlePrefix() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain('You&#39;re invited to: Mythic+ Monday');
}

async function testOgUrlCanonical() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain(
    'property="og:url" content="https://raid.example.com/i/abc"',
  );
}

async function testOgImageCover() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain(
    'property="og:image" content="https://images.igdb.com/cover.jpg"',
  );
}

async function testOgDescGameName() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain('og:description');
  expect(html).toContain('World of Warcraft');
}

async function testOgDescDiscord() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain('Discord');
}

async function testOgDescClickToSignUp() {
  const html = await service.renderInviteOgHtml('abc');
  expect(html).toContain('Click to sign up');
}

// ─── Twitter card tests ─────────────────────────────────────────────────────

function setupTwitterBeforeEach() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({
      title: 'Weekend Raid',
      game: {
        name: 'FFXIV',
        coverUrl: 'https://images.igdb.com/ffxiv.jpg',
      },
    }),
  );
}

async function testTwitterCardSummary() {
  const html = await service.renderInviteOgHtml('tw1');
  expect(html).toMatch(/name="twitter:card"\s+content="summary"/);
}

async function testTwitterTitle() {
  const html = await service.renderInviteOgHtml('tw1');
  expect(html).toContain('name="twitter:title"');
  expect(html).toContain('Weekend Raid');
}

async function testTwitterDescription() {
  const html = await service.renderInviteOgHtml('tw1');
  expect(html).toContain('name="twitter:description"');
}

async function testTwitterImagePresent() {
  const html = await service.renderInviteOgHtml('tw1');
  expect(html).toContain(
    'name="twitter:image" content="https://images.igdb.com/ffxiv.jpg"',
  );
}

async function testTwitterImageNoCover() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: { name: 'Custom Game', coverUrl: null } }),
  );
  const html = await service.renderInviteOgHtml('tw2');
  expect(html).not.toContain('twitter:image');
}

async function testTwitterImageNoGame() {
  mocks.inviteService.resolveInvite.mockResolvedValue(
    makeValidInvite({ game: null }),
  );
  const html = await service.renderInviteOgHtml('tw3');
  expect(html).not.toContain('twitter:image');
}

beforeEach(() => setupEach());

describe('OgMetaService — renderInviteOgHtml', () => {
  it('should render OG tags for a valid invite', () => testValidInviteOgTags());
  it('should render fallback for invalid invite', () =>
    testFallbackInvalidInvite());
  it('should render fallback for claimed invite', () =>
    testFallbackClaimedInvite());
  it('should render fallback for ended event', () => testFallbackEndedEvent());
  it('should render fallback for cancelled event', () =>
    testFallbackCancelledEvent());
  it('should handle resolveInvite throwing', () => testResolveInviteError());
  it('should escape HTML in event title', () => testXssEscapeTitle());
  it('should render without image when no cover art', () => testNoCoverArt());
  it('should include meta refresh redirect', () => testMetaRefreshRedirect());
  it('should use localhost fallback when client URL is null', () =>
    testLocalhostFallback());
});

describe('OgMetaService — OG tag content', () => {
  beforeEach(() => setupTagContentBeforeEach());
  it('og:type should equal "website"', () => testOgTypeWebsite());
  it('og:site_name should equal "Raid Ledger"', () => testOgSiteName());
  it('og:title should contain invitation phrase', () => testOgTitlePrefix());
  it('og:url should equal canonical invite URL', () => testOgUrlCanonical());
  it('og:image should contain game cover URL', () => testOgImageCover());
  it('og:description should contain game name', () => testOgDescGameName());
  it('og:description should include Discord walkthrough', () =>
    testOgDescDiscord());
  it('og:description should mention clicking to sign up', () =>
    testOgDescClickToSignUp());
});

describe('OgMetaService — Twitter card tags', () => {
  beforeEach(() => setupTwitterBeforeEach());
  it('twitter:card should equal "summary"', () => testTwitterCardSummary());
  it('twitter:title should be present', () => testTwitterTitle());
  it('twitter:description should be present', () => testTwitterDescription());
  it('twitter:image should equal game cover URL', () =>
    testTwitterImagePresent());
  it('twitter:image absent when no cover art', () => testTwitterImageNoCover());
  it('twitter:image absent when game is null', () => testTwitterImageNoGame());
});
