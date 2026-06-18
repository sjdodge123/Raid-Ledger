/**
 * Failing-first contract tests for ROK-1352 (ephemeral voice channels).
 *
 * Validates the additive Discord-bot config schemas the dev will add to
 * `packages/contract/src/discord-bot.schema.ts` and re-export from the
 * package index:
 *   - `EphemeralVoiceConfigSchema` — { enabled, categoryId, createBufferMinutes,
 *     idleMinutes } with buffer/idle defaulting to 30 and >= 0 validation.
 *   - `SetEphemeralVoiceConfigSchema` — a partial of the above for PUT.
 *
 * These are colocated under `api/src` (rather than packages/contract/src/__tests__,
 * which no configured runner picks up) so `npm run test -w api` exercises them via
 * the jest `@raid-ledger/contract` module mapper. They MUST fail today: neither
 * schema exists yet, so the import throws at module load.
 */
import {
  EphemeralVoiceConfigSchema,
  SetEphemeralVoiceConfigSchema,
} from '@raid-ledger/contract';

describe('EphemeralVoiceConfigSchema (ROK-1352)', () => {
  /** A fully-specified, valid config. */
  function baseConfig() {
    return {
      enabled: true,
      categoryId: '123456789012345678',
      createBufferMinutes: 45,
      idleMinutes: 20,
    };
  }

  it('accepts a fully-specified valid config', () => {
    const parsed = EphemeralVoiceConfigSchema.parse(baseConfig());
    expect(parsed).toEqual(baseConfig());
  });

  it('accepts a null categoryId (no category configured)', () => {
    const parsed = EphemeralVoiceConfigSchema.parse({
      ...baseConfig(),
      categoryId: null,
    });
    expect(parsed.categoryId).toBeNull();
  });

  it('defaults createBufferMinutes and idleMinutes to 30 when omitted', () => {
    // AC1/AC3/AC4: buffer + idle default to 30 minutes.
    const parsed = EphemeralVoiceConfigSchema.parse({
      enabled: false,
      categoryId: null,
    });
    expect(parsed.createBufferMinutes).toBe(30);
    expect(parsed.idleMinutes).toBe(30);
  });

  it('rejects a negative createBufferMinutes', () => {
    // safeParse (not .toThrow()) so the test fails for the RIGHT reason while
    // the schema is still undefined — otherwise `undefined.parse()` throwing
    // would satisfy a `.toThrow()` assertion spuriously.
    const result = EphemeralVoiceConfigSchema.safeParse({
      ...baseConfig(),
      createBufferMinutes: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative idleMinutes', () => {
    const result = EphemeralVoiceConfigSchema.safeParse({
      ...baseConfig(),
      idleMinutes: -5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-boolean enabled', () => {
    const result = EphemeralVoiceConfigSchema.safeParse({
      ...baseConfig(),
      enabled: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

describe('SetEphemeralVoiceConfigSchema (ROK-1352)', () => {
  it('accepts a partial update touching only the toggle', () => {
    const parsed = SetEphemeralVoiceConfigSchema.parse({ enabled: true });
    expect(parsed.enabled).toBe(true);
  });

  it('accepts an empty object (no fields)', () => {
    expect(() => SetEphemeralVoiceConfigSchema.parse({})).not.toThrow();
  });

  it('still rejects an out-of-range minute value on partial update', () => {
    const result = SetEphemeralVoiceConfigSchema.safeParse({ idleMinutes: -10 });
    expect(result.success).toBe(false);
  });
});
