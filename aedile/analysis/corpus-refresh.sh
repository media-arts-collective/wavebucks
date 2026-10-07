#!/usr/bin/env bash
# corpus-refresh.sh -- the whole path from the Google Group to the vault, one command.
#
#   aedile/analysis/corpus-refresh.sh              # scrape what is left, merge, gate, install
#   aedile/analysis/corpus-refresh.sh --no-scrape  # merge, gate and install what is banked
#
# Scrapes in chunks of $CHUNK topics, $GAP seconds apart: Google revokes a long continuous run.
# Status lands in $STATE/status as one line (OK / BLOCKED / FAILED, date, reason).
#
# Exit: 0 installed, 3 needs a human sign-in, 4 gate refused, 1 anything else.

set -uo pipefail
cd "$(dirname "$0")/../.."

VAULT=${KREWE_VAULT:-/srv/vaporwave-reports/obsidian-vault/mailing-list-archive}
CACHE=${KREWE_SCRAPE_CACHE:-/srv/vaporwave-reports/aedile/scrape-2026-09-27}
COOKIES=/srv/vaporwave-reports/aedile/.groups-cookies.txt
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/krewe/corpus-refresh
MBOX=$CACHE/krewe-topics.mbox
MERGED=$CACHE/merged.jsonl
LEGACY=$VAULT/messages.legacy.jsonl
LIVE=$VAULT/messages.jsonl
LEDGER=aedile/analysis/.scrape-used.json
CHUNK=${CHUNK:-40}
GAP=${GAP:-600}

mkdir -p "$STATE"
status() { echo "$1 $(date -Is) $2" > "$STATE/status"; echo "=== $1: $2"; }
banked() { python3 -c "import json;print(len(json.load(open('$LEDGER'))))" 2>/dev/null || echo 0; }
topics() { python3 - "$1" <<'PY'
import importlib.util, sys
from pathlib import Path
s = importlib.util.spec_from_file_location('st', 'aedile/analysis/scrape-topics.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
print(len(m.topic_ids(Path(sys.argv[1]))))
PY
}
session_ok() {
  local url
  url=$(curl -s -b "$COOKIES" -o /dev/null -w '%{url_effective}' -L \
        https://groups.google.com/g/kreweofvaporwave)
  [[ $url != *access-error* && $url != *accounts.google.com* ]]
}
# audit <file> <label>: one number out of ingest.py --audit's report.
audit() { python3 aedile/analysis/ingest.py --audit "$1" | grep "^$2 " | sed "s/^$2 *//" | grep -o '^[0-9]*'; }

SOURCE=$LIVE; [ -f "$LEGACY" ] && SOURCE=$LEGACY
TOTAL=$(topics "$SOURCE")

if [ "${1:-}" != --no-scrape ]; then
  if ! session_ok; then
    python3 aedile/analysis/container-cookies.py >/dev/null
    if ! session_ok; then
      status BLOCKED "session dead after re-export at $(banked)/$TOTAL topics: sign the kreweofvaporwave Firefox container back in, then re-run"
      exit 3
    fi
  fi
  barren=0
  while [ "$(banked)" -lt "$TOTAL" ] && [ "$barren" -lt 2 ]; do
    before=$(banked)
    echo "=== chunk start  ledger=$before/$TOTAL  $(date +%H:%M:%S)"
    python3 aedile/analysis/scrape-topics.py --limit "$CHUNK" --verbose --out "$MBOX"
    after=$(banked)
    echo "=== chunk done   ledger=$after/$TOTAL (+$((after - before)))"
    if [ "$after" -le "$before" ]; then
      barren=$((barren + 1))
      if ! session_ok; then
        status BLOCKED "session revoked mid-run at $after/$TOTAL topics: sign the kreweofvaporwave Firefox container back in, then re-run"
        exit 3
      fi
    else
      barren=0
    fi
    [ "$after" -lt "$TOTAL" ] && [ "$barren" -lt 2 ] && sleep "$GAP"
  done
fi

# /exec is flaky, so ingest.py caches each thread read and a retry reads only what is missing.
export INGEST_GMAIL_CACHE=$CACHE/gmail-threads
merged=no
for try in 1 2 3 4 5 6 7 8; do
  python3 aedile/analysis/ingest.py --mbox "$MBOX" --jsonl "$SOURCE" \
    --gmail --years 2025:2026 --unmask --mark-aedile -o "$MERGED" && { merged=yes; break; }
  echo "=== merge attempt $try failed"; [ "$try" -lt 8 ] && sleep 60
done
[ "$merged" = yes ] || { status FAILED "merge failed eight times; vault untouched"; exit 1; }

python3 aedile/analysis/ingest.py --audit "$SOURCE" > "$STATE/audit-before.txt"
python3 aedile/analysis/ingest.py --audit "$MERGED" > "$STATE/audit-after.txt"
paste -d'|' "$STATE/audit-before.txt" "$STATE/audit-after.txt" | column -t -s'|'

refuse() { status FAILED "gate refused: $1; vault untouched, merged file at $MERGED"; exit 4; }
[ "$(audit "$MERGED" 'rows')" -ge "$(audit "$SOURCE" 'rows')" ] || refuse "merged has fewer rows"
[ "$(audit "$MERGED" 'subject present')" -ge "$(audit "$SOURCE" 'subject present')" ] || refuse "merged has fewer subjects"
[ "$(audit "$MERGED" 'bodies 80-101 chars')" -le "$(audit "$SOURCE" 'bodies 80-101 chars')" ] || refuse "merged has more preview snippets"
[ "$(audit "$MERGED" 'merge-key collisions')" -eq 0 ] || refuse "merge-key collisions"
[ "$(topics "$MERGED")" -ge "$TOTAL" ] || refuse "merged lost topic URLs, so the next scrape could not enumerate"

[ -f "$LEGACY" ] || cp -p "$LIVE" "$LEGACY"
cp "$MERGED" "$LIVE.new" && chmod 660 "$LIVE.new" && mv "$LIVE.new" "$LIVE"
status OK "installed $(audit "$LIVE" 'rows') rows, $(banked)/$TOTAL topics scraped, $(audit "$LIVE" 'bodies 80-101 chars') preview snippets left"
