import type { HubDb } from '../drizzle/drizzle.module';

/** The Drizzle transaction `HubDb.transaction` hands its callback. */
export type HubTx = Parameters<Parameters<HubDb['transaction']>[0]>[0];
