#!/bin/bash
set -e

REPO="sjdodge123/Raid-Ledger"

echo "🔒 Configuring branch protection for main..."

# Create JSON payload for main branch protection
# Note: restrictions (users/teams) only work for org repos, omitted for personal repos
cat > /tmp/main-protection.json << 'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build-lint-test", "merge"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

gh api repos/$REPO/branches/main/protection \
  --method PUT \
  --input /tmp/main-protection.json

# Cleanup temp files
rm /tmp/main-protection.json

echo "🔄 Enabling auto-merge on repository..."

gh api repos/$REPO --method PATCH -f allow_auto_merge=true --silent

echo "✅ Repository configured successfully"
echo ""
echo "Main branch protection:"
echo "  - Requires status checks: build-lint-test, merge"
echo "  - Requires conversation resolution"
echo "  - Blocks force pushes and deletions"
echo ""
echo "Repository settings:"
echo "  - Auto-merge enabled (use 'gh pr merge --auto --squash' after creating PRs)"
