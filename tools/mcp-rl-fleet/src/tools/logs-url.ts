// rl_logs_url — generate a Grafana Explore URL pre-filled with a Loki query.
export const TOOL_NAME = 'rl_logs_url';
export const TOOL_DESCRIPTION =
  'Generate a Grafana Explore URL pre-filled with a Loki LogQL query for the rl-infra stack. Use to point the operator at the right log view (per-slot, per-env, per-role, or arbitrary substring). Login at grafana.rl.lan with admin / $RL_INFRA_GRAFANA_ADMIN_PASSWORD.';

export interface LogsUrlParams {
  /** LogQL filter. Defaults to all runner logs. Examples:
   *    '{rl_role="runner"}'
   *    '{rl_slot="1"}'
   *    '{rl_env="my-test"} |= "error"'
   *    '{container="rl-env-foo-allinone"} |= "ECONNRESET"'
   */
  query?: string;
  /** Lookback window. Defaults to '1h'. Valid: '15m', '1h', '6h', '24h', '7d'. */
  since?: string;
}

export interface LogsUrlResult {
  ok: boolean;
  url: string;
  query: string;
  since: string;
}

export async function execute(params: LogsUrlParams): Promise<LogsUrlResult> {
  const query = params.query ?? '{rl_role="runner"}';
  const since = params.since ?? '1h';
  const fromExpr = `now-${since}`;
  // Grafana Explore URL with a pre-filled Loki panel.
  const left = JSON.stringify([
    fromExpr,
    'now',
    'Loki',
    { expr: query, refId: 'A' },
  ]);
  const url =
    `http://grafana.rl.lan/explore?left=${encodeURIComponent(left)}`;
  return { ok: true, url, query, since };
}
