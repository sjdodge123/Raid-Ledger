// ROK-1537 AC4 — who lands as admin on a fleet env, as reported by env-spin's
// `operator_admin` field. Kept out of env-spin.ts so callers that mock the
// env-spin module (env-deploy-steps' spec) still get the real formatter.

export type OperatorAdminMode = 'configured' | 'first-login' | 'none';

/** ROK-1537 AC4: one sentence telling the agent who will be admin on the env. */
export function describeOperatorAdmin(mode: OperatorAdminMode | undefined): string {
  switch (mode) {
    case 'configured':
      return 'Operator admin: the VM-configured RL_OPERATOR_DISCORD_ID is admin from its first Discord login.';
    case 'first-login':
      return 'Operator admin: RL_OPERATOR_DISCORD_ID is unset — the FIRST real Discord login on this env becomes admin.';
    case 'none':
      return 'Operator admin: none — this env predates the first-login marker; destroy + fresh spin so the operator lands as admin.';
    default:
      return '';
  }
}
