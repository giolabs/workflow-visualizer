#!/usr/bin/env bash
# Tag a release that was prepared with scripts/release.sh and merged to main.
# Pushing the tag triggers .github/workflows/release.yml, which verifies the
# tag against plugin.json and main and publishes the GitHub release.
#
#   scripts/tag-release.sh 0.4.0-beta.2
#
# Requirements: a clean, up-to-date `main` whose plugin.json already carries
# <version> and whose CHANGELOG.md has the `## [<version>] - <date>` section.
set -euo pipefail

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
  echo "usage: scripts/tag-release.sh <major.minor.patch[-beta.N|-rc.N|-alpha.N]>" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

branch="$(git branch --show-current)"
[ "$branch" = "main" ] || { echo "tag from main, not $branch" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "tag v$version already exists" >&2; exit 1; }

current="$(node -p "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).version")"
[ "$current" = "$version" ] || { echo "plugin.json is at $current, not $version: merge the release PR first" >&2; exit 1; }
grep -q "^## \[$version\] - " CHANGELOG.md || { echo "CHANGELOG.md has no '## [$version] - <date>' section" >&2; exit 1; }

git tag -a "v$version" -m "workflow-visualizer v$version"
git push -q origin "v$version"

echo "pushed v$version; the release workflow publishes it at:"
echo "  https://github.com/giolabs/workflow-visualizer/releases/tag/v$version"
echo "install this exact version with:"
echo "  /plugin install workflow-visualizer@$version --marketplace giolabs/workflow-visualizer"
