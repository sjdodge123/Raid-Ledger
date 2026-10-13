import { classifyApiKey, normalisePanelUrl } from './pelican-url.helpers';

describe('normalisePanelUrl', () => {
  it.each([
    ['https://panel.example.test', 'https://panel.example.test'],
    ['https://panel.example.test/', 'https://panel.example.test'],
    ['  http://10.0.0.5:8080//  ', 'http://10.0.0.5:8080'],
    ['https://example.test/panel/', 'https://example.test/panel'],
  ])('accepts %p as %p', (raw, expected) => {
    expect(normalisePanelUrl(raw)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ['ftp://panel.example.test'],
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['https://user:pass@panel.example.test'],
    ['https://panel.example.test/?a=1'],
    ['https://panel.example.test/#frag'],
    ['panel.example.test'],
    [''],
    [`https://example.test/${'a'.repeat(2050)}`],
  ])('rejects %p', (raw) => {
    const result = normalisePanelUrl(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Panel URL/);
  });
});

describe('classifyApiKey', () => {
  it.each([
    ['papp_abc', 'application'],
    [' papp_abc ', 'application'],
    ['pacc_abc', 'client'],
    ['legacykeywithoutprefix', 'unknown'],
    ['', 'unknown'],
  ])('classifies %p as %p', (key, kind) => {
    expect(classifyApiKey(key)).toBe(kind);
  });
});
