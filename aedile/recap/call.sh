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

curl -sL --max-time 120 "$URL" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-binary @"$FORM"
echo
