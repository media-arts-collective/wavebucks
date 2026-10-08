#!/bin/bash
# call.sh <action> [field=value ...]     -- call aedile's WriteApi (doPost).
# call.sh get <scope> [field=value ...]  -- read aedile's ReadApi (doGet).
#
# The token never goes on argv, and there is no `curl -X POST`: it pins the
# method across /exec's 302 and Google answers with a sign-in page.
#
#   ./call.sh get messages limit=5
#   ./call.sh get log limit=20
#
# Not pushed to Apps Script: aedile/.claspignore excludes recap/**.
set -euo pipefail

# The deployment redige.mjs posts to. Read and write tokens differ so they
# revoke independently.
URL="${AEDILE_EXEC_URL:-https://script.google.com/macros/s/AKfycbyyx1N_0hMP2-GG3z1gM_EgNL0RXFB83yvrY57JOKPQ026a2y2hOARKjGc-lKF-qj7s5w/exec}"

# Environment first, like redige.mjs.
SECRETS="${AEDILE_SECRETS:-}"
for f in "$HOME/.config/aedile/api-secrets" /srv/vaporwave-reports/aedile/.aedile-api-secrets; do
  [ -z "$SECRETS" ] && [ -r "$f" ] && SECRETS=$f
done

[ $# -ge 1 ] || { echo "usage: call.sh <action|get <scope>> [field=value ...]" >&2; exit 2; }

if [ "$1" = get ]; then
  MODE=get; KEY=AEDILE_READ_API_TOKEN; TOKEN="${READ_API_TOKEN:-}"; FIRST=scope
  shift
  [ $# -ge 1 ] || { echo "usage: call.sh get <scope> [field=value ...]" >&2; exit 2; }
else
  MODE=post; KEY=AEDILE_WRITE_API_TOKEN; TOKEN="${WRITE_API_TOKEN:-}"; FIRST=action
fi

if [ -z "$TOKEN" ] && [ -r "$SECRETS" ]; then
  TOKEN=$(grep -oP "(?<=^$KEY=).*" "$SECRETS" | tr -d "\"'\r")
fi
[ -n "$TOKEN" ] || { echo "call.sh: no $KEY in the environment and none readable at $SECRETS" >&2; exit 5; }

FORM=$(mktemp); trap 'rm -f "$FORM"' EXIT
TOKEN="$TOKEN" python3 -c "
import urllib.parse, os, sys
d = {'token': os.environ['TOKEN'], sys.argv[2]: sys.argv[3]}
for kv in sys.argv[4:]:
    k, sep, v = kv.partition('=')
    if not sep: sys.exit('call.sh: \"%s\" is not field=value' % kv)
    d[k] = v
open(sys.argv[1], 'w').write(urllib.parse.urlencode(d))
" "$FORM" "$FIRST" "$@"

if [ "$MODE" = get ]; then
  # Query on stdin as a curl config file, not on argv, for the same reason
  # the POST body is a file: the token is in it.
  printf 'url = "%s?%s"\n' "$URL" "$(cat "$FORM")" | curl -sLK - --max-time 120
else
  curl -sL --max-time 120 "$URL" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-binary @"$FORM"
fi
echo
