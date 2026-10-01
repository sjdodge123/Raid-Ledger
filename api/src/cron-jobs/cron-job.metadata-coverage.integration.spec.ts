/**
 * Every live core cron job has a CORE_JOB_METADATA entry.
 *
 * A core job without one makes `extractRegistryJobMeta` log `Core cron job
 * "<name>" is missing CORE_JOB_METADATA entry.` on every boot, and the job
 * renders undescribed under "Other" in Admin -> Scheduled Jobs. The unit spec
 * pins named entries; this reads the REAL SchedulerRegistry of a booted app, so
 * a new @Cron that ships without metadata fails here instead of surfacing as a
 * boot WARN in production logs.
 *
 * No job list is hard-coded: plugin (`slug:job`) and auto-generated UUID names
 * are classified by `extractRegistryJobMeta` itself, exactly as at boot.
 */
import type { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { extractRegistryJobMeta } from './cron-job.helpers';

/** Registry names whose metadata lookup logged the missing-entry warning. */
function findJobsMissingMetadata(registry: SchedulerRegistry): string[] {
  const missing: string[] = [];
  for (const [name, job] of registry.getCronJobs()) {
    const warn = jest.fn();
    const logger = { warn, error: jest.fn() } as unknown as Logger;
    extractRegistryJobMeta(name, job, logger);
    if (warn.mock.calls.length > 0) missing.push(name);
  }
  return missing;
}

function describeMetadataCoverage() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  it('reads a populated registry (the guard itself is alive)', () => {
    const jobs = testApp.app.get(SchedulerRegistry).getCronJobs();

    expect(jobs.size).toBeGreaterThan(10);
    expect(jobs.has('SchedulingPollExpiryService_runSweep')).toBe(true);
  });

  it('every core cron job in the registry has a CORE_JOB_METADATA entry', () => {
    const registry = testApp.app.get(SchedulerRegistry);

    expect(findJobsMissingMetadata(registry)).toEqual([]);
  });
}
describe('Cron-job metadata coverage (integration)', () =>
  describeMetadataCoverage());
