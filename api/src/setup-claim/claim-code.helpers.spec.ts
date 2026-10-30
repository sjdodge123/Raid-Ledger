import { createHash } from 'node:crypto';
import {
  base32Encode,
  CLAIM_CODE_PATTERN,
  CLAIM_WINDOW_MS,
  claimExpiryFrom,
  generateClaimCode,
  hashClaimCode,
  isClaimExpired,
  normaliseClaimCode,
  planClaimArm,
  verifyClaimCode,
} from './claim-code.helpers';

const NOW = new Date('2026-10-30T05:00:00.000Z');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('base32Encode (RFC 4648, no padding)', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes %j as %j', (input, expected) => {
    expect(base32Encode(Buffer.from(input, 'utf8'))).toBe(expected);
  });
});

describe('generateClaimCode', () => {
  it('draws exactly 10 bytes (80 bits) and groups 16 base32 chars', () => {
    const random = jest.fn((size: number) => Buffer.alloc(size, 0xff));
    expect(generateClaimCode(random)).toBe('7777-7777-7777-7777');
    expect(random).toHaveBeenCalledWith(10);
  });

  it('1000 samples all match XXXX-XXXX-XXXX-XXXX and are distinct', () => {
    const codes = Array.from({ length: 1000 }, () => generateClaimCode());
    for (const code of codes) expect(code).toMatch(CLAIM_CODE_PATTERN);
    expect(new Set(codes).size).toBe(1000);
  });
});

describe('normaliseClaimCode', () => {
  it('strips dashes and upper-cases a base32-shaped code', () => {
    expect(normaliseClaimCode(' abcd-efgh-ijkl-mnop ')).toBe(
      'ABCDEFGHIJKLMNOP',
    );
    expect(normaliseClaimCode('ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKLMNOP');
    expect(normaliseClaimCode('abcdEFGH-ijklmnop')).toBe('ABCDEFGHIJKLMNOP');
  });

  it('keeps any other value verbatim (only trimmed)', () => {
    const render = 'xY9-k2_Lq-8Z0a-RENDERGEN-01';
    expect(normaliseClaimCode(`  ${render}\n`)).toBe(render);
    // 0/1/8/9 are outside the base32 alphabet → verbatim, case kept.
    expect(normaliseClaimCode('abcd-efgh-ijkl-mno1')).toBe(
      'abcd-efgh-ijkl-mno1',
    );
  });
});

describe('hashClaimCode', () => {
  it('is sha256 hex of the normalised code and stable across paste forms', () => {
    const h = hashClaimCode('ABCD-EFGH-IJKL-MNOP');
    expect(h).toBe(sha('ABCDEFGHIJKLMNOP'));
    expect(hashClaimCode('abcdefghijklmnop')).toBe(h);
    expect(hashClaimCode('Hunter2-render')).toBe(sha('Hunter2-render'));
  });
});

describe('verifyClaimCode', () => {
  const code = 'QWER-TYUI-OPAS-DFGH';
  const stored = hashClaimCode(code);

  it('accepts the code in any paste form', () => {
    expect(verifyClaimCode(code, stored)).toBe(true);
    expect(verifyClaimCode(' qwertyuiopasdfgh ', stored)).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(verifyClaimCode('QWER-TYUI-OPAS-DFGG', stored)).toBe(false);
  });

  it('rejects everything once consumed (hash null)', () => {
    expect(verifyClaimCode(code, null)).toBe(false);
  });

  it('never throws on odd input or a malformed stored hash', () => {
    expect(verifyClaimCode('x'.repeat(5000), stored)).toBe(false);
    expect(verifyClaimCode('', stored)).toBe(false);
    expect(verifyClaimCode(code, 'abc')).toBe(false);
    expect(verifyClaimCode(code, stored.toUpperCase())).toBe(false);
  });

  it('compares with crypto.timingSafeEqual', () => {
    const crypto =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    verifyClaimCode(code, stored);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('expiry', () => {
  it('a code armed now expires 72 h later', () => {
    expect(CLAIM_WINDOW_MS).toBe(259_200_000);
    expect(claimExpiryFrom(NOW).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('is live 1 ms before, expired exactly at and after the instant', () => {
    const exp = claimExpiryFrom(NOW);
    expect(isClaimExpired(exp, new Date(exp.getTime() - 1))).toBe(false);
    expect(isClaimExpired(exp, exp)).toBe(true);
    expect(isClaimExpired(exp, new Date(exp.getTime() + 1))).toBe(true);
  });
});

const later = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);

describe('planClaimArm (OQ-8a) — claimed and env code', () => {
  it('never re-arms a claimed instance, even with an unchanged SETUP_CODE', () => {
    const plan = planClaimArm({
      claimedAt: NOW,
      envCode: 'same-env-code-value',
      now: later,
    });
    expect(plan).toEqual({ kind: 'claimed' });
  });

  it('re-arms the SAME env code with a fresh 72 h window each boot', () => {
    const env = '  render-generated-long-value  ';
    const first = planClaimArm({ claimedAt: null, envCode: env, now: NOW });
    const second = planClaimArm({ claimedAt: null, envCode: env, now: later });
    if (first.kind !== 'env' || second.kind !== 'env')
      throw new Error('expected env plans');
    expect(second.codeHash).toBe(first.codeHash);
    expect(first.codeHash).toBe(sha('render-generated-long-value'));
    expect(first.expiresAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(second.expiresAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
    expect(first.isShort).toBe(false);
  });

  it('never carries the env plaintext in the plan', () => {
    const plan = planClaimArm({
      claimedAt: null,
      envCode: 'secret-env-value-123',
      now: NOW,
    });
    expect(JSON.stringify(plan)).not.toContain('secret-env-value-123');
  });

  it('flags a SETUP_CODE shorter than 16 chars', () => {
    const plan = planClaimArm({
      claimedAt: null,
      envCode: 'short-15-chars!',
      now: NOW,
    });
    expect(plan).toMatchObject({ kind: 'env', isShort: true });
    const ok = planClaimArm({
      claimedAt: null,
      envCode: 'exactly-16-chars',
      now: NOW,
    });
    expect(ok).toMatchObject({ kind: 'env', isShort: false });
  });
});

describe('planClaimArm (OQ-8a) — generated code', () => {
  it('generates a NEW code every boot when no env code (blank counts as none)', () => {
    const codes = ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'];
    const generate = jest.fn(() => codes.shift() ?? 'unexpected');
    const first = planClaimArm({
      claimedAt: null,
      envCode: '   ',
      now: NOW,
      generate,
    });
    const second = planClaimArm({
      claimedAt: null,
      envCode: undefined,
      now: later,
      generate,
    });
    if (first.kind !== 'generated' || second.kind !== 'generated')
      throw new Error('expected generated plans');
    expect(first.code).toBe('AAAA-BBBB-CCCC-DDDD');
    expect(second.code).toBe('EEEE-FFFF-GGGG-HHHH');
    expect(first.codeHash).toBe(hashClaimCode('AAAA-BBBB-CCCC-DDDD'));
    expect(second.codeHash).not.toBe(first.codeHash);
    expect(second.expiresAt.toISOString()).toBe('2026-11-02T10:00:00.000Z');
  });

  it('defaults to a real generated code', () => {
    const plan = planClaimArm({
      claimedAt: null,
      envCode: undefined,
      now: NOW,
    });
    if (plan.kind !== 'generated') throw new Error('expected generated plan');
    expect(plan.code).toMatch(CLAIM_CODE_PATTERN);
    expect(verifyClaimCode(plan.code, plan.codeHash)).toBe(true);
  });
});
