#!/bin/bash
# ends.sh -- the krewe's due loops as logical lines for potato's tube
# (hf7y-estate/crt#455): a heading, then one line per loop due today or
# overdue, then a count of the rest. No indent, wrapping or colour: crt does
# those. A Sensitive row is counted, never printed: the tube is in a room.
set -euo pipefail
"$(dirname "$0")/call.sh" get loops open=true | python3 -c "
import json, sys, datetime, zoneinfo
d = json.load(sys.stdin)
if not d.get('ok'): sys.exit('ends.sh: ' + json.dumps(d))
tz = zoneinfo.ZoneInfo('America/Chicago')
today = datetime.datetime.now(tz).date()
def due(r):
    s = str(r['Due'])
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(tz).date() if s else None
day = lambda x: '%s %d/%d' % (x.strftime('%a'), x.month, x.day)
rows = sorted(d['rows'], key=lambda r: due(r) or datetime.date.max)
now = [r for r in rows if due(r) and due(r) <= today]
later = [r for r in rows if r not in now]
show = [r for r in now if not r['Sensitive']]
if not rows: sys.exit(0)
print('krewe, ' + day(today))
for r in show:
    print('%s %s: %s' % (r['Id'], 'TODAY' if due(r) == today else 'OVERDUE ' + day(due(r)), r['Ask']))
if len(now) > len(show): print('%d withheld' % (len(now) - len(show)))
if not now: print('nothing due today')
nxt = [due(r) for r in later if due(r)]
if later: print('+%d later%s' % (len(later), ', next ' + day(nxt[0]) if nxt else ''))
"
