import { buildStartResponse } from './companion-device-link-start.helpers';

describe('buildStartResponse (ROK-1955)', () => {
  const res = buildStartResponse(
    'https://raid.example/',
    'rlcd_device',
    'BCDF-GHJK',
    600,
    5,
  );

  it('carries the user code in the fragment, never the query (Codex P2)', () => {
    const url = new URL(res.verificationUriComplete);
    expect(url.search).toBe('');
    expect(url.hash).toBe('#code=BCDF-GHJK');
    expect(res.verificationUriComplete).toBe(
      'https://raid.example/link#code=BCDF-GHJK',
    );
  });

  it('keeps the bare verification URI and RFC 8628 fields', () => {
    expect(res).toMatchObject({
      deviceCode: 'rlcd_device',
      userCode: 'BCDF-GHJK',
      verificationUri: 'https://raid.example/link',
      expiresIn: 600,
      interval: 5,
    });
  });
});
