#!/usr/bin/env bash
# End-to-end check of `/wv objectives` against real repositories, headless.
#
#   tests/e2e/objectives.sh [repo ...]
#
# For each repo it starts `claude -p` with this plugin loaded from disk, runs
# `/wv objectives`, and compares the ADR count the plugin reports with the
# markdown files under docs/adr (or docs/decisions). Spends a few tokens per
# repo: run it by hand before publishing, not on every edit.
set -euo pipefail

PLUGIN="$(cd "$(dirname "$0")/../.." && pwd)"
REPOS=("$@")
if [ ${#REPOS[@]} -eq 0 ]; then
  echo "usage: tests/e2e/objectives.sh <repo> [repo ...]   (paths to repositories with docs/adr or similar)" >&2
  exit 2
fi

fail=0
for repo in "${REPOS[@]}"; do
  if [ ! -d "$repo" ]; then
    echo "skip  $repo (missing)"
    continue
  fi
  adr_dir=""
  for d in docs/adr docs/decisions adr conclave/product/adr; do
    [ -d "$repo/$d" ] && adr_dir="$d" && break
  done
  expected=0
  if [ -n "$adr_dir" ]; then
    expected=$(find "$repo/$adr_dir" -maxdepth 1 -name '*.md' ! -iname 'readme.md' ! -iname 'index.md' ! -iname 'template.md' | wc -l | tr -d ' ')
  fi

  out=$(cd "$repo" && claude -p --plugin-dir "$PLUGIN" --permission-mode dontAsk --max-turns 1 "/wv objectives rescan" 2>&1 || true)
  got=$(printf '%s\n' "$out" | awk '/^adr[[:space:]]/ { print $2; exit }')
  got=${got:-0}

  if [ "$got" = "$expected" ]; then
    echo "ok    $repo  adr=$got"
  else
    echo "FAIL  $repo  adr reported=$got expected=$expected"
    printf '%s\n' "$out" | head -40 | sed 's/^/      /'
    fail=1
  fi
done

exit $fail
