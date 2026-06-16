#!/usr/bin/env bash
# Fail-fast smoke test — run after every deploy.
#   BASE_URL=https://api.example.in bash scripts/smoke.sh
set -uo pipefail
BASE_URL="${BASE_URL:-http://localhost:8001}"

fail() { echo "✗ $1"; exit 1; }
check() {
  local name="$1" path="$2" expect="${3:-}" body code
  body=$(curl -fsS -m 10 -w $'\n%{http_code}' "$BASE_URL$path" 2>/dev/null) || fail "$name — request failed ($path)"
  code=$(printf '%s' "$body" | tail -n1)
  [ "$code" = "200" ] || fail "$name — HTTP $code"
  if [ -n "$expect" ] && ! printf '%s' "$body" | grep -q "$expect"; then fail "$name — missing '$expect'"; fi
  echo "✓ $name (200)"
}

echo "Smoke test → $BASE_URL"
check "liveness"       "/health"                          '"status":"ok"'
check "readiness (DB)" "/ready"                           '"status":"ready"'
check "catalog list"   "/v1/catalog/internships?limit=1"  '"success":true'
check "categories"     "/v1/catalog/categories"           '"success":true'
echo "All smoke checks passed."
