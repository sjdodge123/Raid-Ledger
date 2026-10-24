import { HubMediaBytesController } from './hub-media-bytes.controller';

/** ROK-1942: the bytes route must not inherit the global 60 req/min throttle. */
describe('HubMediaBytesController throttle', () => {
  it('overrides the default throttler with the media tier (600/min)', () => {
    const handler = Object.getOwnPropertyDescriptor(
      HubMediaBytesController.prototype,
      'bytes',
    )?.value as object;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(600);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
