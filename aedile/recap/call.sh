#!/bin/bash
# call.sh <action> [field=value ...] -- call aedile's WriteApi from mandark.
#
# Exists because the two things that make this call awkward by hand are the
# ones you get wrong silently:
#
#   - the token must not go on argv, where /proc exposes it to any local
#     account for as long as curl runs;
#   - `curl -X POST` pins the method across /exec's 302 to
#     googleusercontent.com, so curl re-POSTs with no body and Google answers
#     with a sign-in PAGE at HTTP 200 -- which reads exactly like a missing
#     version cut and is not one. --data-binary already means POST.
#
# /exec's 302 also occasionally echoes Google's "unable to open the file"
# HTML instead of the action JSON (#54) -- a flake in what the far end
# serves, not in the redirect-following above. Retries the whole request
# (AEDILE_EXEC_ATTEMPTS, default 8) rather than trying to distinguish it from
# a real failure; a JSON-looking body, even one with ok:false, is returned
# on the first attempt that produces one. Same policy and env var name as
# execClient.mjs's postExec, which redige.mjs uses, so both callers share one
# knob.
#
#   ./call.sh setRecapEnabled enabled=false
#   ./call.sh setRecapEnabled enabled=true dryRun=true
#   ./call.sh scanInbox dryRun=true
#
# Not pushed to Apps Script: aedile/.claspignore excludes recap/**.
set -euo pipefail

# Same deployment redige.mjs posts to -- the one the anonymous URL serves.
URL="${AEDILE_EXEC_URL:-https://script.google.com/macros/s/AKfycbyyx1N_0hMP2-GG3z1gM_EgNL0RXFB83yvrY57JOKPQ026a2y2hOARKjGc-lKF-qj7s5w/exec}"

# Environment first, like redige.mjs, because the file below lives under
# /srv/vaporwave-reports and that tree is being retired.
TOKEN="${WRITE_API_TOKEN:-}"
SECRETS="${AEDILE_SECRETS:-/srv/vaporwave-reports/aedile/.aedile-api-secrets}"
if [ -z "$TOKEN" ] && [ -r "$SECRETS" ]; then
  TOKEN=$(grep -oP '(?<=^AEDILE_WRITE_API_TOKEN=).*' "$SECRETS" | tr -d "\"'\r")
fi
[ -n "$TOKEN" ] || { echo "call.sh: no WRITE_API_TOKEN in the environment and none readable at $SECRETS" >&2; exit 5; }
[ $# -ge 1 ] || { echo "usage: call.sh <action> [field=value ...]" >&2; exit 2; }

FORM=$(mktemp); trap 'rm -f "$FORM"' EXIT
TOKEN="$TOKEN" python3 -c "
import urllib.parse, os, sys
d = {'token': os.environ['TOKEN'], 'action': sys.argv[2]}
for kv in sys.argv[3:]:
    k, sep, v = kv.partition('=')
    if not sep: sys.exit('call.sh: \"%s\" is not field=value' % kv)
    d[k] = v
open(sys.argv[1], 'w').write(urllib.parse.urlencode(d))
" "$FORM" "$@"

ATTEMPTS="${AEDILE_EXEC_ATTEMPTS:-8}"
attempt=1
while :; do
  # The `if` guards the assignment from `set -e`: a transport failure (curl's
  # own exit code, since no -f here) falls through to the retry below instead
  # of aborting the script outright.
  if RESPONSE=$(curl -sL --max-time 120 "$URL" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-binary @"$FORM"); then
    case "$RESPONSE" in
      '{'*|'['*) echo "$RESPONSE"; exit 0 ;;
    esac
  fi
  [ "$attempt" -lt "$ATTEMPTS" ] || {
    echo "call.sh: /exec did not return JSON after ${ATTEMPTS}x -- last response:" >&2
    printf '%s' "${RESPONSE:-<curl failed>}" | head -c 300 >&2
    echo >&2
    exit 7
  }
  sleep "$attempt"
  attempt=$((attempt + 1))
done
