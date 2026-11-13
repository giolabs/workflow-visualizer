#!/usr/bin/env bash
# Prepare a release as a pull request: bump the version, stamp the CHANGELOG
# section, commit on a release branch, push and open the PR. Nothing is tagged
# here. Once the PR is merged, `scripts/tag-release.sh <version>` creates the
# tag on main, and .github/workflows/release.yml publishes the GitHub release
# (a pre-release when the version has a suffix).
#
#   scripts/release.sh 0.4.0-beta.2        # beta: pre-release after merge + tag
#   scripts/release.sh 0.4.0               # stable
#
# Requirements: a clean tree on an up-to-date `main`, a `## [Unreleased]` section
# in CHANGELOG.md with the notes to ship (it becomes `## [<version>] - <date>`),
# and `gh` signed in (used to open the PR). Every change to main goes through a
# PR, this one included; the `main` ruleset refuses direct pushes.
set -euo pipefail

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
  echo "usage: scripts/release.sh <major.minor.patch[-beta.N|-rc.N|-alpha.N]>" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

branch="$(git branch --show-current)"
[ "$branch" = "main" ] || { echo "start from main, not $branch" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean" >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "tag v$version already exists" >&2; exit 1; }
grep -q "^## \[Unreleased\]" CHANGELOG.md || { echo "CHANGELOG.md has no '## [Unreleased]' section" >&2; exit 1; }
grep -q "^## \[$version\] - " CHANGELOG.md && { echo "CHANGELOG.md already has a section for $version" >&2; exit 1; }

release_branch="release/v$version"
git checkout -q -b "$release_branch"

# Version bump.
node -e '
  const fs = require("node:fs")
  const p = ".claude-plugin/plugin.json"
  const m = JSON.parse(fs.readFileSync(p, "utf8"))
  m.version = process.argv[1]
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n")
  const v = "hooks/version.ts"
  const q = String.fromCharCode(39)
  fs.writeFileSync(v, fs.readFileSync(v, "utf8").replace(new RegExp("VERSION = " + q + "[^" + q + "]*" + q), "VERSION = " + q + process.argv[1] + q))
' "$version"

# CHANGELOG: the Unreleased notes become this version's section; a fresh Unreleased stays on top.
node -e '
  const fs = require("node:fs")
  const [version, date] = process.argv.slice(1)
  const text = fs.readFileSync("CHANGELOG.md", "utf8")
  const head = "## [Unreleased]\n"
  const at = text.indexOf(head)
  if (at < 0) throw new Error("no Unreleased section")
  const after = text.slice(at + head.length)
  const next = after.search(/\n## \[/)
  const notes = (next < 0 ? after : after.slice(0, next)).trim()
  if (!notes) throw new Error("the Unreleased section is empty: write the notes first")
  const rest = next < 0 ? "" : after.slice(next)
  fs.writeFileSync("CHANGELOG.md", text.slice(0, at) + head + "\n## [" + version + "] - " + date + "\n\n" + notes + "\n" + rest)
' "$version" "$(date -u +%Y-%m-%d)"

claude plugin validate . >/dev/null
claude plugin test . | tail -2

git add .claude-plugin/plugin.json hooks/version.ts CHANGELOG.md
git commit -q -m "release: v$version"
git push -q -u origin "$release_branch"

pr_url="$(gh pr create --base main --head "$release_branch" --title "release: v$version" --body "$(cat <<EOF
Release $version.

- bumps \`.claude-plugin/plugin.json\` to \`$version\`
- moves the \`[Unreleased]\` CHANGELOG notes into \`## [$version]\`

After merging, run \`scripts/tag-release.sh $version\` on an up-to-date \`main\`; the \`release\` workflow then publishes the GitHub release.
EOF
)")"

echo "release PR opened: $pr_url"
echo "after it merges:  git checkout main && git pull && scripts/tag-release.sh $version"
