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
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF

gh api repos/$REPO/branches/main/protection \
  --method PUT \
  --input /tmp/main-protection.json

echo "🧪 Configuring branch protection for staging..."

# Create JSON payload for staging branch protection
cat > /tmp/staging-protection.json << 'EOF'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_conversation_resolution": false,
  "allow_force_pushes": true,
  "allow_deletions": false
}
EOF

gh api repos/$REPO/branches/staging/protection \
  --method PUT \
  --input /tmp/staging-protection.json

# Cleanup temp files
rm /tmp/main-protection.json /tmp/staging-protection.json

echo "✅ Branch protection rules configured successfully"
echo ""
echo "Main branch protection:"
echo "  - Requires 1 PR approval"
echo "  - Requires status checks: build-lint-test, merge"
echo "  - Dismisses stale reviews on new commits"
echo "  - Requires conversation resolution"
echo "  - Blocks force pushes and deletions"
echo ""
echo "Staging branch protection:"
echo "  - Allows force pushes (for reset during dispatch)"
echo "  - Blocks deletions"
echo "  - No required reviews or status checks"
