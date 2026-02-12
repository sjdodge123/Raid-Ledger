import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

/** Label mapping from feedback category to GitHub issue label */
const CATEGORY_LABELS: Record<string, string> = {
  bug: 'bug',
  feature: 'enhancement',
  improvement: 'improvement',
  other: 'feedback',
};

/** Title prefix per category */
const CATEGORY_PREFIX: Record<string, string> = {
  bug: '[Bug]',
  feature: '[Feature Request]',
  improvement: '[Improvement]',
  other: '[Feedback]',
};

const GITHUB_REPO = 'sjdodge123/Raid-Ledger';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/issues`;

export interface GitHubIssueResult {
  success: boolean;
  issueUrl: string | null;
  error?: string;
}

/**
 * Service for creating GitHub issues from user feedback.
 * ROK-186: Forward feedback to GitHub Issues.
 */
@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Create a GitHub issue from feedback submission.
   * Returns the issue URL on success, or null if GitHub is not configured.
   */
  async createFeedbackIssue(params: {
    category: string;
    message: string;
    username: string;
    pageUrl: string | null;
    feedbackId: number;
  }): Promise<GitHubIssueResult> {
    const token = await this.settingsService.getGitHubPat();
    if (!token) {
      this.logger.warn(
        'GitHub PAT not configured — feedback saved locally only',
      );
      return {
        success: false,
        issueUrl: null,
        error: 'GitHub PAT not configured',
      };
    }

    const { category, message, username, pageUrl, feedbackId } = params;

    const prefix = CATEGORY_PREFIX[category] ?? '[Feedback]';
    // Use first 80 chars of message as title
    const titleBody =
      message.length > 80 ? `${message.substring(0, 77)}...` : message;
    const title = `${prefix} ${titleBody}`;

    const bodyParts = [
      `**Category:** ${category}`,
      `**Submitted by:** ${username}`,
      `**Feedback ID:** #${feedbackId}`,
    ];
    if (pageUrl) {
      bodyParts.push(`**Page:** ${pageUrl}`);
    }
    bodyParts.push('', '---', '', message);

    const body = bodyParts.join('\n');

    const labels = [CATEGORY_LABELS[category] ?? 'feedback', 'user-feedback'];

    try {
      const response = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'RaidLedger/1.0',
        },
        body: JSON.stringify({ title, body, labels }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `GitHub issue creation failed: ${response.status} ${errorText}`,
        );
        return {
          success: false,
          issueUrl: null,
          error: `GitHub API returned ${response.status}`,
        };
      }

      const data = (await response.json()) as { html_url: string };
      this.logger.log(`GitHub issue created: ${data.html_url}`);

      return { success: true, issueUrl: data.html_url };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to create GitHub issue: ${errorMessage}`);
      return { success: false, issueUrl: null, error: errorMessage };
    }
  }

  /**
   * Test the GitHub PAT by fetching the repo.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const token = await this.settingsService.getGitHubPat();
    if (!token) {
      return { success: false, message: 'GitHub PAT is not configured' };
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'RaidLedger/1.0',
          },
        },
      );

      if (response.status === 401) {
        return { success: false, message: 'Invalid GitHub token' };
      }

      if (response.status === 403) {
        return {
          success: false,
          message: 'Token lacks permission to access the repository',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          message: 'Repository not found or token lacks access',
        };
      }

      if (!response.ok) {
        return {
          success: false,
          message: `GitHub API returned ${response.status}`,
        };
      }

      // Check if we can create issues by verifying permissions
      const data = (await response.json()) as {
        permissions?: { push?: boolean; issues?: boolean };
        has_issues?: boolean;
      };

      if (data.has_issues === false) {
        return {
          success: false,
          message: 'Issues are disabled on this repository',
        };
      }

      return {
        success: true,
        message: 'GitHub connection verified! Feedback will create issues.',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        message: `Failed to connect to GitHub: ${errorMessage}`,
      };
    }
  }
}
