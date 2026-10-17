import { execFileSync } from 'child_process';
import type { CanaryRunReport } from './canary.interface.js';

const CANARY_LABEL = 'canary-alert';

/**
 * Report canary results to GitHub Issues using the `gh` CLI.
 *
 * - Failed integration: create a labeled issue (or comment on existing)
 * - Recovered integration: auto-close the open issue
 *
 * Deduplication: one issue per integration, identified by label + title.
 */
export function reportToGitHub(report: CanaryRunReport): void {
  for (const entry of report.results) {
    if (entry.result.status === 'SKIP') continue;

    const title = `Canary: ${entry.name} integration is down`;

    if (entry.result.status === 'FAIL') {
      handleFailure(
        title,
        entry.name,
        entry.result.reason,
        entry.result.details,
      );
    } else if (entry.result.status === 'PASS') {
      handleRecovery(title, entry.name);
    }
  }
}

function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`gh CLI error: ${message}`);
    return '';
  }
}

/**
 * Find an open issue with the canary-alert label matching the given title.
 * Returns the issue number, or null if none found.
 */
function findOpenIssue(title: string): number | null {
  const output = gh([
    'issue',
    'list',
    '--label',
    CANARY_LABEL,
    '--search',
    `"${title}" in:title`,
    '--state',
    'open',
    '--json',
    'number,title',
    '--limit',
    '5',
  ]);

  if (!output) return null;

  try {
    const issues = JSON.parse(output) as Array<{
      number: number;
      title: string;
    }>;
    const match = issues.find((i) => i.title === title);
    return match?.number ?? null;
  } catch {
    return null;
  }
}

function handleFailure(
  title: string,
  name: string,
  reason?: string,
  details?: string,
): void {
  const body = buildFailureBody(name, reason, details);
  const existingIssue = findOpenIssue(title);
  if (existingIssue) {
    commentOnExisting(existingIssue, title, reason);
  } else {
    createNewIssue(title, body);
  }
}

function buildFailureBody(
  name: string,
  reason?: string,
  details?: string,
): string {
  return [
    `## ${name} Canary Failure`,
    '',
    `**Reason:** ${reason ?? 'Unknown'}`,
    details ? `\n**Details:**\n\`\`\`\n${details}\n\`\`\`` : '',
    '',
    `**Detected at:** ${new Date().toISOString()}`,
    '',
    'This issue was auto-created by the canary test system.',
    'It will be auto-closed when the integration recovers.',
  ]
    .filter(Boolean)
    .join('\n');
}

function commentOnExisting(
  issueNum: number,
  title: string,
  reason?: string,
): void {
  const comment = `Still failing at ${new Date().toISOString()}.\n\n**Reason:** ${reason ?? 'Unknown'}`;
  gh(['issue', 'comment', String(issueNum), '--body', comment]);
  console.log(`Commented on existing issue #${issueNum}: ${title}`);
}

function createNewIssue(title: string, body: string): void {
  gh([
    'issue',
    'create',
    '--title',
    title,
    '--body',
    body,
    '--label',
    CANARY_LABEL,
  ]);
  console.log(`Created issue: ${title}`);
}

function handleRecovery(title: string, name: string): void {
  const existingIssue = findOpenIssue(title);

  if (existingIssue) {
    const comment = `${name} has recovered as of ${new Date().toISOString()}. Auto-closing.`;
    gh(['issue', 'comment', String(existingIssue), '--body', comment]);
    gh(['issue', 'close', String(existingIssue)]);
    console.log(`Closed recovered issue #${existingIssue}: ${title}`);
  }
}
