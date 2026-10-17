import { Logger } from '@nestjs/common';
import {
  PARSE_WEIGHT_MAX,
  PARSE_WEIGHT_MIN,
  parseWeight,
  resolveCommonGroundWeights,
} from './common-ground-weights.helpers';
import {
  INTENSITY_WEIGHT,
  SOCIAL_WEIGHT,
  TASTE_WEIGHT,
} from '../lineups/common-ground-scoring.constants';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

describe('parseWeight', () => {
  const FALLBACK = 1.5;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns fallback when raw is null', () => {
    expect(parseWeight(null, FALLBACK)).toBe(FALLBACK);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns fallback when raw is not a finite number (NaN)', () => {
    expect(parseWeight('not-a-number', FALLBACK)).toBe(FALLBACK);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns fallback when raw parses to Infinity', () => {
    expect(parseWeight('Infinity', FALLBACK)).toBe(FALLBACK);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns fallback when raw parses to -Infinity', () => {
    expect(parseWeight('-Infinity', FALLBACK)).toBe(FALLBACK);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns the parsed value when inside range', () => {
    expect(parseWeight('2.5', FALLBACK)).toBe(2.5);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts value exactly at the minimum bound without clamping or warning', () => {
    expect(parseWeight(String(PARSE_WEIGHT_MIN), FALLBACK)).toBe(
      PARSE_WEIGHT_MIN,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts value exactly at the maximum bound without clamping or warning', () => {
    expect(parseWeight(String(PARSE_WEIGHT_MAX), FALLBACK)).toBe(
      PARSE_WEIGHT_MAX,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('clamps negative values to the minimum and warns', () => {
    expect(parseWeight('-5', FALLBACK)).toBe(PARSE_WEIGHT_MIN);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('below minimum');
  });

  it('clamps values above the maximum and warns', () => {
    expect(parseWeight('1e9', FALLBACK)).toBe(PARSE_WEIGHT_MAX);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('above maximum');
  });

  it('logs only once per clamp call (no spam)', () => {
    parseWeight('1e9', FALLBACK);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCommonGroundWeights', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns defaults when no settings are configured', async () => {
    const weights = await resolveCommonGroundWeights(() =>
      Promise.resolve(null),
    );
    expect(weights.tasteWeight).toBe(TASTE_WEIGHT);
    expect(weights.socialWeight).toBe(SOCIAL_WEIGHT);
    expect(weights.intensityWeight).toBe(INTENSITY_WEIGHT);
  });

  it('clamps configured weights above the maximum', async () => {
    const values: Record<string, string> = {
      [SETTING_KEYS.COMMON_GROUND_TASTE_WEIGHT]: '1000000000',
    };
    const weights = await resolveCommonGroundWeights((key) =>
      Promise.resolve(values[key] ?? null),
    );
    expect(weights.tasteWeight).toBe(PARSE_WEIGHT_MAX);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
