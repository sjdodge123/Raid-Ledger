import { loadHubConfig } from './hub-config';

describe('loadHubConfig', () => {
  it('applies the defaults when nothing is set', () => {
    expect(loadHubConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'production',
    });
  });

  it('reads PORT, HOST and NODE_ENV from the env', () => {
    expect(
      loadHubConfig({ PORT: '8081', HOST: '127.0.0.1', NODE_ENV: 'test' }),
    ).toEqual({
      port: 8081,
      host: '127.0.0.1',
      nodeEnv: 'test',
    });
  });

  it.each(['0', '65536', '30.5', 'abc'])('rejects PORT=%s', (port) => {
    expect(() => loadHubConfig({ PORT: port })).toThrow(
      'Invalid relay-hub config: PORT',
    );
  });

  it('accepts the PORT bounds 1 and 65535', () => {
    expect(loadHubConfig({ PORT: '1' }).port).toBe(1);
    expect(loadHubConfig({ PORT: '65535' }).port).toBe(65535);
  });

  it('names every bad key in one error and echoes no value', () => {
    let message = '';
    try {
      loadHubConfig({
        PORT: 'secret-port-99',
        HOST: '',
        NODE_ENV: 'secret-env',
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toBe('Invalid relay-hub config: PORT, HOST, NODE_ENV');
    expect(message).not.toContain('secret');
  });
});
