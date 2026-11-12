/// <reference types="jest" />
/**
 * ROK-2179: the companion path finalises the addon-import audit AFTER the
 * 202, so a message's audit row may still be PENDING when the response
 * arrives. Integration specs wait for none before reading results or
 * truncating, so no late write races the next test or the pool close.
 * (`*.test-fixtures.ts`: excluded from `nest build`.)
 */
import { waitFor } from '../../../../common/testing/integration-helpers';
import type { TestApp } from '../../../../common/testing/test-app';
import * as schema from '../../../../drizzle/schema';
import { ADDON_IMPORT_PENDING } from '../addon-import.audit';

/** Every audit row's `result`, oldest first. */
export async function auditResults(db: TestApp['db']): Promise<string[]> {
  const rows = await db
    .select({ result: schema.addonImportAudit.result })
    .from(schema.addonImportAudit)
    .orderBy(schema.addonImportAudit.id);
  return rows.map((r) => r.result);
}

/** Polls (10 s deadline, no sleep) until no audit row is PENDING. */
export async function settledAudit(db: TestApp['db']): Promise<string[]> {
  let results: string[] = [];
  await waitFor(async () => {
    results = await auditResults(db);
    expect(results).not.toContain(ADDON_IMPORT_PENDING);
  }, 10_000);
  return results;
}
