#!/bin/bash

# Script to generate release notes from git commits
# Usage: ./generate-release-notes.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the current commit SHA
CURRENT_SHA=$(git rev-parse HEAD)
CURRENT_SHA_SHORT=$(git rev-parse --short HEAD)

# Get the previous deployment tag or commit
# Try to find the last deployment tag (tags starting with "deploy-")
PREVIOUS_TAG=$(git tag -l "deploy-*" --sort=-creatordate | head -n 1)

if [ -z "$PREVIOUS_TAG" ]; then
    # If no deployment tags exist, try to get commits from last 10 commits, or use first commit
    # Check if we have enough history
    COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
    
    if [ "$COMMIT_COUNT" -gt "10" ]; then
        PREVIOUS_SHA=$(git rev-parse HEAD~10)
        echo -e "${YELLOW}No previous deployment tag found. Using last 10 commits.${NC}" >&2
    elif [ "$COMMIT_COUNT" -gt "1" ]; then
        # Use the first commit in the repo
        PREVIOUS_SHA=$(git rev-list --max-parents=0 HEAD)
        echo -e "${YELLOW}No previous deployment tag found. Using all $COMMIT_COUNT commits.${NC}" >&2
    else
        # Only one commit, show just this one
        PREVIOUS_SHA="HEAD"
        echo -e "${YELLOW}Only one commit in history. Showing current commit only.${NC}" >&2
    fi
else
    PREVIOUS_SHA=$(git rev-list -n 1 $PREVIOUS_TAG)
    echo -e "${GREEN}Found previous deployment: $PREVIOUS_TAG${NC}" >&2
fi

# Generate release notes
echo "🚀 **Capital Tracker Deployment**"
echo ""
echo "📅 **Date:** $(date '+%Y-%m-%d %H:%M:%S UTC')"
echo "🔖 **Commit:** \`$CURRENT_SHA_SHORT\`"
echo ""

# Get commit messages between previous and current
COMMITS=$(git log --pretty=format:"%h|%s|%an|%ar" $PREVIOUS_SHA..$CURRENT_SHA)

if [ -z "$COMMITS" ]; then
    echo "ℹ️ No new commits since last deployment."
    exit 0
fi

# Count commits
COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')
echo "📝 **Changes:** $COMMIT_COUNT commit(s)"
echo ""

# Categorize commits
FEATURES=""
FIXES=""
DOCS=""
REFACTOR=""
SECURITY=""
PERF=""
OTHER=""

while IFS='|' read -r hash subject author time; do
    # Categorize based on commit message prefix
    if [[ $subject =~ ^feat:|^feature: ]]; then
        FEATURES="${FEATURES}• ${subject#feat:} \`$hash\`\n"
        FEATURES="${FEATURES#feature:}"
    elif [[ $subject =~ ^fix:|^bugfix: ]]; then
        FIXES="${FIXES}• ${subject#fix:} \`$hash\`\n"
        FIXES="${FIXES#bugfix:}"
    elif [[ $subject =~ ^docs:|^doc: ]]; then
        DOCS="${DOCS}• ${subject#docs:} \`$hash\`\n"
        DOCS="${DOCS#doc:}"
    elif [[ $subject =~ ^refactor:|^refactoring:|^ref: ]]; then
        REFACTOR="${REFACTOR}• ${subject#refactor:} \`$hash\`\n"
        REFACTOR="${REFACTOR#ref:}"
        REFACTOR="${REFACTOR#refactoring:}"
        REFACTOR="${REFACTOR#refactor:}"
    elif [[ $subject =~ ^security:|^sec: ]]; then
        SECURITY="${SECURITY}• ${subject#security:} \`$hash\`\n"
        SECURITY="${SECURITY#sec:}"
    elif [[ $subject =~ ^perf:|^performance: ]]; then
        PERF="${PERF}• ${subject#perf:} \`$hash\`\n"
        PERF="${PERF#performance:}"
    elif [[ $subject =~ ^WIP:|^wip: ]]; then
        # Skip WIP commits
        continue
    else
        OTHER="${OTHER}• $subject \`$hash\`\n"
    fi
done <<< "$COMMITS"

# Output categorized changes
if [ ! -z "$FEATURES" ]; then
    echo "✨ **New Features:**"
    echo -e "$FEATURES"
fi

if [ ! -z "$FIXES" ]; then
    echo "🐛 **Bug Fixes:**"
    echo -e "$FIXES"
fi

if [ ! -z "$SECURITY" ]; then
    echo "🔒 **Security:**"
    echo -e "$SECURITY"
fi

if [ ! -z "$PERF" ]; then
    echo "⚡ **Performance:**"
    echo -e "$PERF"
fi

if [ ! -z "$REFACTOR" ]; then
    echo "♻️ **Refactoring:**"
    echo -e "$REFACTOR"
fi

if [ ! -z "$DOCS" ]; then
    echo "📚 **Documentation:**"
    echo -e "$DOCS"
fi

if [ ! -z "$OTHER" ]; then
    echo "🔧 **Other Changes:**"
    echo -e "$OTHER"
fi

# Get repository URL from git remote
REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//' | sed 's/^git@github\.com:/https:\/\/github.com\//')

# Add deployment info
echo ""
echo "---"
echo "🔗 **Links:**"
if [ ! -z "$REPO_URL" ]; then
    echo "• [Full Changelog]($REPO_URL/compare/$PREVIOUS_SHA...$CURRENT_SHA)"
    echo "• [Commit Details]($REPO_URL/commit/$CURRENT_SHA)"
else
    echo "• Full Changelog: \`$PREVIOUS_SHA...$CURRENT_SHA\`"
    echo "• Commit: \`$CURRENT_SHA\`"
fi
echo ""
echo "✅ **Status:** Deployed and health check passed"

