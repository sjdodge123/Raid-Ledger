// A3-B P4 — the credential redactor at the MCP return boundary.
import { describe, it, expect } from 'vitest';
import { redactAdminPassword, ADMIN_PASSWORD_WITHHELD_HINT } from '../credentials.js';

describe('redactAdminPassword', () => {
  it('removes the value from a result the caller did not ask credentials for', () => {
    const r = redactAdminPassword({ ok: true, url: 'https://slot-1.test', admin_password: 'hunter2' });
    expect(
      (r as { admin_password?: unknown }).admin_password,
      `admin_password must be ABSENT from a default (include_credentials unset) result — ` +
        `expected undefined, got ${JSON.stringify((r as { admin_password?: unknown }).admin_password)}`,
    ).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(r, 'admin_password'),
      'the admin_password KEY must be deleted, not set to undefined — expected hasOwnProperty false, got true',
    ).toBe(false);
    expect(
      JSON.stringify(r).includes('hunter2'),
      `the secret must not survive anywhere in the serialised result — expected false, got true for ${JSON.stringify(r)}`,
    ).toBe(false);
  });

  it('keeps the non-credential fields intact while redacting', () => {
    const r = redactAdminPassword({ ok: true, url: 'https://slot-1.test', admin_email: 'admin@local', admin_password: 'hunter2' });
    expect(r.ok, 'ok must survive redaction — expected true').toBe(true);
    expect(r.url, 'url must survive redaction — expected https://slot-1.test').toBe('https://slot-1.test');
    expect(r.admin_email, 'admin_email is not a credential and must survive — expected admin@local').toBe('admin@local');
  });

  it('replaces the value with a presence marker + a how-to-get-it hint', () => {
    const r = redactAdminPassword({ ok: true, admin_password: 'hunter2' }) as {
      admin_password_available?: boolean;
      admin_password_hint?: string;
    };
    expect(
      r.admin_password_available,
      `a redacted result must still say a password EXISTS — expected true, got ${JSON.stringify(r.admin_password_available)}`,
    ).toBe(true);
    expect(
      r.admin_password_hint,
      `the hint must tell the caller how to opt in — expected the include_credentials hint, got ${JSON.stringify(r.admin_password_hint)}`,
    ).toBe(ADMIN_PASSWORD_WITHHELD_HINT);
    expect(
      ADMIN_PASSWORD_WITHHELD_HINT.includes('include_credentials:true'),
      'the hint text must name the opt-in flag — expected it to contain "include_credentials:true"',
    ).toBe(true);
  });

  it('preserves the null-means-bootstrap-failed signal as available:false with no hint', () => {
    const r = redactAdminPassword({ ok: true, admin_password: null }) as {
      admin_password_available?: boolean;
      admin_password_hint?: string;
    };
    expect(
      r.admin_password_available,
      `admin_password:null (bootstrap-admin failed) must redact to available:false, not true — got ${JSON.stringify(r.admin_password_available)}`,
    ).toBe(false);
    expect(
      r.admin_password_hint,
      `no opt-in hint when there is no password to opt into — expected undefined, got ${JSON.stringify(r.admin_password_hint)}`,
    ).toBeUndefined();
  });

  it('returns the value verbatim when the caller explicitly opts in', () => {
    const r = redactAdminPassword({ ok: true, admin_password: 'hunter2' }, true);
    expect(
      r.admin_password,
      `include_credentials:true must return the value — expected "hunter2", got ${JSON.stringify(r.admin_password)}`,
    ).toBe('hunter2');
    expect(
      (r as { admin_password_available?: boolean }).admin_password_available,
      'an opted-in result must NOT be decorated with the presence marker — expected undefined',
    ).toBeUndefined();
  });

  it('only true opts in — false/undefined both redact', () => {
    for (const include of [false, undefined] as const) {
      const r = redactAdminPassword({ ok: true, admin_password: 'hunter2' }, include);
      expect(
        (r as { admin_password?: unknown }).admin_password,
        `include=${String(include)} must still redact — expected undefined, got ${JSON.stringify((r as { admin_password?: unknown }).admin_password)}`,
      ).toBeUndefined();
    }
  });

  it('leaves a result that never carried the key byte-identical (no invented marker)', () => {
    const input = { ok: true, task_id: 'local-abc123def456', steps: [] };
    const r = redactAdminPassword(input);
    expect(
      JSON.stringify(r),
      `a non-credential result must pass through untouched — expected ${JSON.stringify(input)}, got ${JSON.stringify(r)}`,
    ).toBe(JSON.stringify(input));
    expect(
      Object.prototype.hasOwnProperty.call(r, 'admin_password_available'),
      'must not invent a presence marker on a result that never had the key — expected hasOwnProperty false, got true',
    ).toBe(false);
  });
});
