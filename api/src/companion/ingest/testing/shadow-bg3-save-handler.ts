/**
 * ROK-1957: the `bg3` plugin's real `Bg3SaveHandler` owns `bg3-save` v1 in
 * the shared AppModule, and the registry (rightly) refuses a second owner of
 * a `(contract, version)`. Generic-pipeline specs that need a STUB handler
 * for the only shipped contract therefore drive the REAL registration and
 * shadow its behaviour onto the instance: each own getter reads the stub's
 * member live (so a case may reassign `stub.sources`), and a member the stub
 * omits reads `undefined` (no `blobRefs` → no ref checks, no `cadence` → the
 * default), exactly as if the stub were the registered handler. The owner
 * plugin is `bg3`. Call the returned function in `afterAll` to restore.
 */
import type { INestApplication } from '@nestjs/common';
import type { Bg3SaveMessage } from '@raid-ledger/contract';
import { Bg3SaveHandler } from '../../../plugins/bg3/ingest/bg3-save.handler';
import type { CompanionContractHandler } from '../companion-handler.registry';

const SHADOWED = [
  'sources',
  'cadence',
  'latestWins',
  'blobRefs',
  'handle',
] as const;

export function shadowBg3SaveHandler(
  app: INestApplication,
  stub: CompanionContractHandler<Bg3SaveMessage>,
): () => void {
  const real = app.get(Bg3SaveHandler, { strict: false });
  const saved = SHADOWED.map(
    (k) => [k, Object.getOwnPropertyDescriptor(real, k)] as const,
  );
  for (const k of SHADOWED) {
    // Reflect.get: a live, unbound read (the registry calls it on `real`).
    const get = (): unknown => Reflect.get(stub, k);
    Object.defineProperty(real, k, { configurable: true, get });
  }
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(real, k, d);
      else Reflect.deleteProperty(real, k);
    }
  };
}
