#!/usr/bin/env bash
# test.sh -- every local suite under aedile/, one exit code. deploy.sh runs this first.
set -uo pipefail
cd "$(dirname "$0")"
rc=0
run() { echo "=== $*"; "$@" > /tmp/aedile-test.$$ 2>&1 || { rc=1; cat /tmp/aedile-test.$$; echo "=== FAILED: $*"; }; rm -f /tmp/aedile-test.$$; }
run node TestsLocal.js
for t in recap/*.test.mjs brain/*.test.mjs; do run node "$t"; done
for t in analysis/*.test.py; do run python3 "$t"; done
for f in *.js; do run node --check "$f"; done
[ "$rc" = 0 ] && echo "=== all suites pass" || echo "=== SUITES FAILED"
exit "$rc"
