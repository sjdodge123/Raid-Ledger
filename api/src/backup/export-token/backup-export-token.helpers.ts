/**
 * ROK-2263: the `rlbx_` backup-export token kit. Named `…Kit` so it never
 * shadows the `backupExportTokens` table export. The kit (generate / shape-check /
 * sha256 hash / timing-safe verify / 4-char hint). Only the hash and hint are
 * ever stored. NEVER log a token, its hash or its hint.
 */
import { BACKUP_EXPORT_TOKEN_PATTERN } from '@raid-ledger/contract';
import {
  createPrefixedTokenKit,
  type PrefixedTokenKit,
} from '../../common/tokens/prefixed-token.helpers';

export const backupExportTokenKit: PrefixedTokenKit = createPrefixedTokenKit(
  'rlbx_',
  BACKUP_EXPORT_TOKEN_PATTERN,
);
