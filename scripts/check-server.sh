#!/usr/bin/env bash
# Checks a running BILLFORCE server the way the website's Mac & Linux steps leave it:
# it answers, serves the screens, and a business can be registered and signed in to.
# Usage: scripts/check-server.sh [base URL] [business name]   (used by .github/workflows/server.yml)
set -euo pipefail
BASE="${1:-http://localhost:3000}"
NAME="${2:-Check Stores}"

for _ in $(seq 1 60); do curl -sf "$BASE/api/health" > /dev/null && break; sleep 1; done
curl -sf "$BASE/api/health"; echo
curl -sf "$BASE/" | grep -q "<title>BILLFORCE" || { echo "The screens were not served"; exit 1; }

invoke() { curl -sf -X POST "$BASE/api/invoke" -H 'content-type: application/json' -d "$1"; }
if [ "${3:-register}" = "register" ]; then
  invoke "{\"name\":\"business.register\",\"input\":{\"business\":{\"name\":\"$NAME\"},\"owner\":{\"fullName\":\"Owner\",\"username\":\"owner\",\"password\":\"secret1\"}}}" | grep -q '"ok":true' || { echo "Registering failed"; exit 1; }
fi
invoke "{\"name\":\"auth.login\",\"input\":{\"businessName\":\"$NAME\",\"username\":\"owner\",\"password\":\"secret1\"}}" | grep -q '"ok":true' || { echo "Signing in failed"; exit 1; }
echo "BILLFORCE server OK at $BASE"
