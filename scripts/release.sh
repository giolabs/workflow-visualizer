#!/usr/bin/env bash
# Cut a release: bump the version, commit, tag and push. The tag triggers
# .github/workflows/release.yml, which validates, tests and publishes the
# GitHub release (a pre-release when the version has a suffix).
#
#   scripts/release.sh 0.4.0-beta.1        # beta: pre-release
#   scripts/release.sh 0.4.0               # stable
#
# Requirements: a clean tree on main, a `## [<version>] - <date>` section in
# CHANGELOG.md, and `gh` signed in (only used to print the release URL).
set -euo pipefail

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
  echo "usage: scripts/release.sh <major.minor.patch[-beta.N|-rc.N|-alpha.N]>" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

branch="$(git branch --show-current)"
[ "$branch" = "main" ] || { echo "release from main, not $branch" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main" >&2; exit 1; }
grep -q "^## \[$version\] - " CHANGELOG.md || { echo "CHANGELOG.md has no '## [$version] - <date>' section" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "tag v$version already exists" >&2; exit 1; }

node -e '
  const fs = require("node:fs")
  const p = ".claude-plugin/plugin.json"
  const m = JSON.parse(fs.readFileSync(p, "utf8"))
  m.version = process.argv[1]
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n")
' "$version"

claude plugin validate . >/dev/null
claude plugin test . | tail -2

git add .claude-plugin/plugin.json
git commit -q -m "release: v$version"
git tag -a "v$version" -m "workflow-visualizer v$version"
git push -q origin main "v$version"

echo "pushed v$version; the release workflow publishes it at:"
echo "  https://github.com/giolabs/workflow-visualizer/releases/tag/v$version"
echo "install this exact version with:"
echo "  /plugin install workflow-visualizer@$version --marketplace giolabs/workflow-visualizer"
