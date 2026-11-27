#!/usr/bin/env bash
# Formats every changed or new TypeScript/JavaScript file with the project's Prettier settings, so the CI ESLint check
# (which enforces Prettier) stays green. Run before committing. Read-only towards git: it only lists files.
set -euo pipefail
cd "$(dirname "$0")/../.."
files=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u | grep -E '\.(ts|tsx|js|mjs|cjs)$' || true)
[ -z "$files" ] && { echo "No changed source files."; exit 0; }
existing=$(for f in $files; do [ -f "$f" ] && echo "$f"; done)
# Twice: Prettier is not always idempotent on long JSX/ternaries in one pass.
echo "$existing" | xargs ./node_modules/.bin/prettier --write --ignore-unknown --log-level warn
echo "$existing" | xargs ./node_modules/.bin/prettier --write --ignore-unknown --log-level warn
echo "$existing" | xargs ./node_modules/.bin/prettier --check --ignore-unknown
