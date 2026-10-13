import { BadRequestException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PelicanConfigSchema } from '@raid-ledger/contract';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import { SettingsService } from '../../settings/settings.service';
import { PelicanClientFactory } from './pelican-client.factory';
import { PelicanConfigService } from './pelican-config.service';
import { jsonResponse, loadPelicanFixture } from './testing/pelican-fixtures';

const KEY = 'pacc_SECRETunitKEY123';
const URL_OK = 'https://panel.example.test/';
const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose'] as const;

function fakeSettings(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
}

async function build(seed: Record<string, string> = {}) {
  const settings = fakeSettings(seed);
  const mod = await Test.createTestingModule({
    providers: [
      PelicanConfigService,
      PelicanClientFactory,
      { provide: SettingsService, useValue: settings },
    ],
  }).compile();
  return { svc: mod.get(PelicanConfigService), settings };
}

const configured = {
  [SETTING_KEYS.PELICAN_PANEL_URL]: 'https://panel.example.test',
  [SETTING_KEYS.PELICAN_CLIENT_API_KEY]: KEY,
};

let logSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  logSpies = LOG_METHODS.map((m) =>
    jest.spyOn(Logger.prototype, m).mockImplementation(() => {}),
  );
});
afterEach(() => jest.restoreAllMocks());

function loggedText(): string {
  return JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
}

describe('PelicanConfigService.getConfig', () => {
  it('reports apiKeySet without the key and parses strictly', async () => {
    const { svc } = await build(configured);
    const cfg = await svc.getConfig();
    expect(PelicanConfigSchema.safeParse(cfg).success).toBe(true);
    expect(cfg.apiKeySet).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain(KEY);
  });

  it('inherits the community timezone when none is stored', async () => {
    const { svc } = await build({
      [SETTING_KEYS.DEFAULT_TIMEZONE]: 'Europe/Berlin',
    });
    const cfg = await svc.getConfig();
    expect(cfg).toMatchObject({
      defaultTimezone: 'Europe/Berlin',
      timezoneInherited: true,
      panelUrl: null,
      apiKeySet: false,
    });
  });

  it('falls back to UTC when the community timezone is missing or invalid', async () => {
    const { svc } = await build({
      [SETTING_KEYS.DEFAULT_TIMEZONE]: 'Not/AZone',
    });
    expect((await svc.getConfig()).defaultTimezone).toBe('UTC');
  });

  it('uses the stored Pelican timezone over the community one', async () => {
    const { svc } = await build({
      [SETTING_KEYS.DEFAULT_TIMEZONE]: 'Europe/Berlin',
      [SETTING_KEYS.PELICAN_DEFAULT_TIMEZONE]: 'America/Chicago',
    });
    expect(await svc.getConfig()).toMatchObject({
      defaultTimezone: 'America/Chicago',
      timezoneInherited: false,
    });
  });
});

describe('PelicanConfigService.updateConfig', () => {
  it('leaves omitted fields unchanged', async () => {
    const { svc, settings } = await build(configured);
    await svc.updateConfig({ defaultTimezone: 'Asia/Tokyo' });
    expect(settings.set).toHaveBeenCalledTimes(1);
    expect(settings.delete).not.toHaveBeenCalled();
    expect(settings.store.get(SETTING_KEYS.PELICAN_CLIENT_API_KEY)).toBe(KEY);
  });

  it("clears a field sent as ''", async () => {
    const { svc, settings } = await build(configured);
    const cfg = await svc.updateConfig({ apiKey: '' });
    expect(settings.delete).toHaveBeenCalledWith(
      SETTING_KEYS.PELICAN_CLIENT_API_KEY,
    );
    expect(cfg.apiKeySet).toBe(false);
  });

  it('stores the URL normalised and never returns or logs the key', async () => {
    const { svc, settings } = await build();
    const cfg = await svc.updateConfig({ panelUrl: URL_OK, apiKey: KEY });
    expect(settings.store.get(SETTING_KEYS.PELICAN_PANEL_URL)).toBe(
      'https://panel.example.test',
    );
    expect(cfg.apiKeySet).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain(KEY);
    expect(loggedText()).not.toContain(KEY);
  });

  it('rejects a non-http(s) URL with a 400', async () => {
    const { svc } = await build();
    await expect(svc.updateConfig({ panelUrl: 'ftp://x' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

const redirectErr = () =>
  new TypeError('fetch failed', { cause: new Error('unexpected redirect') });

describe('PelicanConfigService.testConnection', () => {
  it('returns not_configured without a fetch when nothing is stored', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { svc } = await build();
    expect((await svc.testConnection()).code).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports the visible server count on success', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(loadPelicanFixture('servers-page')));
    const { svc } = await build(configured);
    const res = await svc.testConnection();
    expect(res).toMatchObject({ success: true, code: 'ok', serverCount: 2 });
    expect(res.message).toContain('2 server(s)');
  });

  it.each([
    ['unauthorized', () => Promise.resolve(jsonResponse({}, 401))],
    ['http', () => Promise.resolve(jsonResponse({}, 500))],
    ['timeout', () => Promise.reject(new DOMException('t', 'TimeoutError'))],
    ['redirect', () => Promise.reject(redirectErr())],
    ['network', () => Promise.reject(new TypeError('fetch failed'))],
    ['bad_response', () => Promise.resolve(jsonResponse({ nope: 1 }))],
  ] as const)('maps a %s failure to its own code', async (code, impl) => {
    jest.spyOn(global, 'fetch').mockImplementation(impl);
    const { svc } = await build(configured);
    const res = await svc.testConnection();
    expect(res).toMatchObject({ success: false, code });
    expect(JSON.stringify(res)).not.toContain(KEY);
    expect(loggedText()).not.toContain(KEY);
  });

  it('tells the IP-allowlist 403 apart from a generic 403', async () => {
    const body = loadPelicanFixture('error-ip-not-allowed');
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(body, 403));
    const { svc } = await build(configured);
    const ip = await svc.testConnection();
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 403));
    const generic = await svc.testConnection();
    expect(ip.code).toBe('forbidden');
    expect(ip.message).toContain('Allowed IPs');
    expect(generic.message).toBe('Pelican refused the request (HTTP 403).');
  });

  it('rejects a papp_ application key before any fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { svc } = await build({
      ...configured,
      [SETTING_KEYS.PELICAN_CLIENT_API_KEY]: 'papp_SECRETappKEY',
    });
    const res = await svc.testConnection();
    expect(res.code).toBe('application_key');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain('papp_SECRETappKEY');
  });
});
