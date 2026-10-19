/**
 * ROK-1837 L3 (review NIT) — the rendered base map is cached, but a
 * failed render must not be: the next call renders again.
 */
import { renderDemoBaseMap } from './valheim-armory-map-demo-seed.helpers';

describe('renderDemoBaseMap cache', () => {
  it('does not cache a rejected render', async () => {
    const boom = new Error('encoder failed');
    await expect(renderDemoBaseMap(() => Promise.reject(boom))).rejects.toBe(
      boom,
    );
    const png = Buffer.from('png');
    await expect(renderDemoBaseMap(() => Promise.resolve(png))).resolves.toBe(
      png,
    );
  });
});
