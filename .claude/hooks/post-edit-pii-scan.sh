#!/usr/bin/env bash
# PostToolUse(Edit|Write) — WARN-ONLY scan for user-PII/secret-token leaks.
# marketing-harness stores user emails/profiles and per-brand OAuth tokens +
# connector API keys. Never blocks: always exits 0. Warnings go to stderr.
set -uo pipefail

file="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

warn() { echo "⚠️  pii-scan(${file##*/}): $1" >&2; }

case "$file" in
  *.ts|*.tsx|*.js|*.jsx)
    # Logging likely-PII or secret tokens by name.
    if grep -Eni '(console\.(log|info|debug|warn|error)|logger\.(log|info|debug|warn|error))[^)]*(email|profile|access_?token|refresh_?token|client_?secret|api_?key|password|caption)' "$file" >/dev/null 2>&1; then
      warn "a log statement references user-PII or a secret token — log ids/counts, not contents or credentials."
    fi
    # Whole-object logging that can sweep PII/tokens in.
    if grep -Eni 'JSON\.stringify\((profile|account|user|token|connector|secrets)' "$file" >/dev/null 2>&1; then
      warn "JSON.stringify of a profile/account/token object near logging can leak PII or credentials — serialize a redacted view."
    fi
    # Raw error message returned in a response / persisted — can embed user data.
    if grep -Eni 'error\s*:\s*[^,}]*\.message\b' "$file" >/dev/null 2>&1; then
      warn "an error '.message' is being put into an 'error' field returned to the client — prefer a safe enumerated message; log the raw error server-side only."
    fi
    # Storing a connector token / secret without going through the crypto helper.
    if grep -Eni '(access_token|refresh_token|client_secret|secrets)\s*[:=]' "$file" >/dev/null 2>&1 \
       && ! grep -Eqi 'encrypt|seal|crypto' "$file"; then
      warn "writing a token/secret — confirm it goes through the encryption-at-rest helper before hitting Postgres (multi-tenant: a leaked token is another workspace's account)."
    fi
    # Inline hard-coded secret.
    if grep -Eni '(ANTHROPIC_API_KEY|RESEND_API_KEY|IG_CLIENT_SECRET|APP_ENCRYPTION_KEY|[A-Z_]*_SECRET|[A-Z_]*_API_KEY)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{12,}' "$file" >/dev/null 2>&1; then
      warn "looks like a hard-coded secret — read it from process.env / env config instead."
    fi
    ;;
esac

exit 0
