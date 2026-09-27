#!/usr/bin/env bash
# scrape-all.sh -- run the topic scrape to completion, unattended.
#
#   aedile/analysis/scrape-all.sh /path/out.mbox [max_passes]
#
# WHY PASSES AND NOT ONE LONG RUN. Measured 2026-09-27 over 136 topics: ~14% fail
# transiently -- a conversation pane that had not rendered when the readiness predicate
# fired, a click that lost a race. Retried immediately, 4 of 6 such topics succeeded. The
# ledger only records topics that produced output, so a failed topic returns to the pool
# and a later pass picks it up; nothing is scraped twice and nothing needs tracking.
#
# A fresh browser per pass also caps memory: one Playwright Firefox held ~600MB after a
# couple of hundred page loads in a single process.
#
# Stops when a pass banks nothing, which means the remainder is failing DETERMINISTICALLY
# and another identical pass would only burn the session. Those topics are named in the
# log; they are a finding, not something to loop on.
# CHECK THE SESSION BEFORE A LONG RUN. One request, no browser:
#
#   curl -s -b /srv/vaporwave-reports/aedile/.groups-cookies.txt -o /dev/null \
#        -w '%{url_effective}\n' -L https://groups.google.com/g/kreweofvaporwave
#
# A URL ending `/access-error` means the credential is not usable: re-export it
# (container-cookies.py), and if it still says that, the container itself needs signing
# back in. Doing this first costs one request instead of a pass of 15-second timeouts.
#
# IF IT GETS REVOKED AGAIN. On 2026-09-27 Google invalidated the exported session after
# ~250 page loads in 90 minutes -- every Google property bounced to the account chooser
# with all five auth cookies present and freshly re-exported. The CAUSE IS NOT ESTABLISHED:
# that page rate is about 2.8/minute, which is not obviously abusive, so this may be a
# device or fingerprint check on a copied session rather than a rate limit. No pacing knob
# is added here because there is nothing measured to set it from. What IS known to work:
# the ledger makes chunking free, so
#
#   bash aedile/analysis/scrape-all.sh out.mbox 1     # one pass, then stop
#
# run a few times with gaps costs nothing and rules the rate explanation in or out. If a
# chunked run survives where a continuous one did not, that is the finding -- record it.

set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:?usage: scrape-all.sh <out.mbox> [max_passes]}
MAX=${2:-12}
LEDGER=aedile/analysis/.scrape-used.json
count() { python3 -c "import json;print(len(json.load(open('$LEDGER'))))" 2>/dev/null || echo 0; }

for p in $(seq 1 "$MAX"); do
  before=$(count)
  echo "=== pass $p start  ledger=$before  $(date +%H:%M:%S)"
  # Exit 1 means "banked nothing this pass", which the loop below reads from the ledger
  # instead -- so a non-zero exit here is not fatal and must not abort the run.
  python3 aedile/analysis/scrape-topics.py --verbose --out "$OUT"
  after=$(count)
  echo "=== pass $p done   ledger=$after (+$((after - before)))  $(date +%H:%M:%S)"
  if [ "$after" -le "$before" ]; then
    echo "=== no progress in pass $p -- the remainder fails deterministically. stopping."
    break
  fi
done
echo "=== final ledger=$(count) of $(python3 -c "
import sys; sys.path.insert(0,'aedile/analysis')
import importlib.util
s=importlib.util.spec_from_file_location('st','aedile/analysis/scrape-topics.py')
m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(len(m.topic_ids()))")"
