/**
 * The WoW: Forever probes' Nest classes, spread into `WowCommonModule`
 * (keeps that module under the 300-line limit): the namespace discovery
 * probe (ROK-1716) and the DEMO_MODE Battle.net account-link probe
 * (ROK-2129 — admin routes + the public OAuth callback).
 */
import { BnetAccountProbeCallbackController } from './bnet-account-probe-callback.controller';
import { BnetAccountProbeController } from './bnet-account-probe.controller';
import { BnetAccountProbeService } from './bnet-account-probe.service';
import { ForeverNamespaceProbeController } from './forever-namespace-probe.controller';
import { ForeverNamespaceProbeService } from './forever-namespace-probe.service';

/** Both probes' services. */
export const PROVIDERS = [
  ForeverNamespaceProbeService,
  BnetAccountProbeService,
];

/** `admin/plugins/blizzard/forever-probe`, `…/bnet-account-probe` + callback. */
export const CONTROLLERS = [
  ForeverNamespaceProbeController,
  BnetAccountProbeController,
  BnetAccountProbeCallbackController,
];
