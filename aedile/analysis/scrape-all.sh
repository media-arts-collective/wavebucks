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
