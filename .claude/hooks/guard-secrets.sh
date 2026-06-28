#!/usr/bin/env bash
# PreToolUse(Bash) — BLOCKING safety guard for marketing-harness.
# Blocks: staging/committing .env*, destructive Postgres/Docker ops against the
# dev database, and echoing/exporting raw secret values inline. Exit 2 => Claude
# is told why.
set -euo pipefail

cmd="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

block() { echo "BLOCKED by guard-secrets: $1" >&2; exit 2; }

# 1. Never stage/commit env files.
if printf '%s' "$cmd" | grep -Eiq '\bgit\s+add\b.*\.env'; then
  block "refusing to 'git add' a .env file. Secrets must not enter git."
fi
if printf '%s' "$cmd" | grep -Eiq '\.env(\.[a-z]+)?\b' && printf '%s' "$cmd" | grep -Eiq '\bgit\s+(commit|add)\b'; then
  block "this git command references a .env file. Keep secrets out of version control."
fi

# 2. Destructive database / container ops on the dev stack.
if printf '%s' "$cmd" | grep -Eiq '\bdrop\s+database\b|\btruncate\b'; then
  block "destructive SQL (DROP DATABASE / TRUNCATE). Run a reversible migration instead, or confirm explicitly outside the agent."
fi
if printf '%s' "$cmd" | grep -Eiq 'docker\s+(rm|stop)\b.*marketing-harness-postgres'; then
  block "this removes/stops the dev Postgres container. Confirm explicitly — data only survives in the volume."
fi
if printf '%s' "$cmd" | grep -Eiq 'docker\s+volume\s+rm\b.*marketing-harness-pgdata'; then
  block "this deletes the Postgres data volume — irreversible loss of the dev database."
fi

# 3. Don't echo/export raw secret values inline.
if printf '%s' "$cmd" | grep -Eiq '\b(export\s+)?(ANTHROPIC_API_KEY|RESEND_API_KEY|IG_CLIENT_SECRET|APP_ENCRYPTION_KEY|S3_[A-Z_]*KEY|.*_API_KEY|.*_SECRET|DATABASE_URL[A-Z_]*)\s*=\s*["'"'"'a-zA-Z0-9]'; then
  block "this command assigns a real secret value inline. Source it from the environment / .env instead."
fi

exit 0
