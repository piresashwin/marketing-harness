#!/usr/bin/env bash
# PostToolUse(Edit|Write) — WARN-ONLY quality feedback for marketing-harness.
# Type-checks the workspace the edited file belongs to (root API vs web/) and
# reminds about migrations on db changes. Never blocks: always exits 0.
set -uo pipefail

file="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-/Users/ashwin/dev/marketing-harness}"
warn() { echo "⚠️  quality(${file##*/}): $1" >&2; }

case "$file" in
  *.ts|*.tsx)
    # Pick the owning TS project: web/ has its own tsconfig; everything else is root.
    case "$file" in
      "$root"/web/*) proj=web; cmd="npm run --silent typecheck --prefix \"$root/web\"" ;;
      *)             proj=api; cmd="npm run --silent typecheck --prefix \"$root\"" ;;
    esac
    if command -v npm >/dev/null 2>&1; then
      out="$(cd "$root" && eval "$cmd" 2>&1)" || warn "typecheck ($proj) failed:\n$(printf '%s' "$out" | grep -E 'error TS' | head -10)"
    fi
    ;;
  */src/db/migrations.ts)
    warn "migrations changed — they run on next server boot. Verify against the dev DB and keep them additive/reversible."
    ;;
esac

exit 0
